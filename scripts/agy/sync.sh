#!/usr/bin/env bash
# The agy sync's stages (see docs/agy-fork.md), shared by its workflow, its repair agent
# and a maintainer syncing by hand.
#   bash scripts/agy/sync.sh merge <upstream-ref>   merge; leaves unresolved conflicts in place
#   bash scripts/agy/sync.sh regen                  regenerate i18n catalogs and commit them
#   bash scripts/agy/sync.sh check [all|hooks|brand|typecheck|tests]
# Logs go to $LOG_DIR. When a check fails, `check all` still runs the rest, then writes
# the failed names to $LOG_DIR/failed-checks and the first failed log's name to $LOG_DIR/failure-log.
set -uo pipefail

LOG_DIR="${LOG_DIR:-$(mktemp -d)}"
mkdir -p "$LOG_DIR"

# Generated files that always take upstream's side in a conflict and are regenerated after.
CATALOGS=(apps/web/src/i18n/translations apps/mobile/src/i18n/translations apps/desktop/src/i18n/translations)

merge() {
  local ref="$1" lock_resolved=false conflicts remaining=()
  if git merge --no-edit -m "Merge upstream/main into agy" "$ref"; then
    echo "lock_resolved=false"
    return 0
  fi
  mapfile -t conflicts < <(git diff --name-only --diff-filter=U)
  if (( ${#conflicts[@]} == 0 )); then
    echo "The merge failed without conflicts."
    return 1
  fi
  for file in "${conflicts[@]}"; do
    case "$file" in
      pnpm-lock.yaml | apps/web/src/i18n/translations/* | apps/mobile/src/i18n/translations/* | \
        apps/desktop/src/i18n/translations/*)
        echo "Taking upstream for $file"
        if [[ "$file" == pnpm-lock.yaml ]]; then lock_resolved=true; fi
        git checkout --theirs -- "$file" || git rm -f -- "$file"
        git add -- "$file" 2>/dev/null || true
        ;;
      *) remaining+=("$file") ;;
    esac
  done
  echo "lock_resolved=$lock_resolved"
  if (( ${#remaining[@]} > 0 )); then
    echo "Unresolved merge conflicts:"
    printf '  %s\n' "${remaining[@]}"
    return 1
  fi
  git commit --no-edit
}

regen() {
  vp run -r i18n:generate || return 1
  git add -A pnpm-lock.yaml "${CATALOGS[@]}"
  if git diff --cached --quiet; then
    echo "Nothing regenerated."
  else
    git commit -m "chore(agy): regenerate lockfile and i18n catalogs after upstream sync"
  fi
}

check_hooks() { node scripts/agy/check-hooks.ts; }

check_brand() { node scripts/agy/apply-brand.ts --check; }

check_typecheck() {
  local packages=(@t3tools/contracts @t3tools/client-runtime t3 @t3tools/web)
  if [[ -n "$(find apps/mobile/src -iname '*agy*' -o -iname '*swarm*' 2>/dev/null | head -n 1)" ]]; then
    packages+=(@t3tools/mobile)
  fi
  local raw="$LOG_DIR/typecheck-raw.log" failed=()
  : > "$raw"
  # One package at a time so a failure in one still reports every other package's errors.
  for package in "${packages[@]}"; do
    echo "== typecheck $package"
    vp run --filter "$package" typecheck 2>&1 | tee -a "$raw"
    (( PIPESTATUS[0] == 0 )) || failed+=("$package")
  done
  if (( ${#failed[@]} > 0 )); then
    # Effect's suggestions bury the errors, and readers of the log often see only its tail.
    printf 'Typecheck failed in: %s\n' "${failed[*]}"
    grep -E "error TS" "$raw" || true
    return 1
  fi
}

check_tests() {
  # Fork tests, plus upstream's tests for every upstream file the fork edits: an upstream
  # change can break the fork's edit there without any merge conflict. The diff is against
  # the working tree, so it holds mid-merge and before the repair is committed.
  local tests
  mapfile -t tests < <(
    {
      find apps packages -path '*/node_modules' -prune -o -type f \
        \( -name '*.test.ts' -o -name '*.test.tsx' \) \
        \( -path '*/agy/*' -o -path '*/toolkits/swarm/*' -o -path '*/components/swarm/*' \
           -o -iname '*agy*' -o -iname '*swarm*' \) -print
      git diff --name-only upstream/main -- apps packages | grep -E '\.tsx?$' |
        while read -r file; do
          [[ -f "$file" ]] || continue
          case "$file" in *.test.ts | *.test.tsx) echo "$file"; continue ;; esac
          for candidate in "${file%.*}.test.ts" "${file%.*}.test.tsx" "${file%.*}.browser.test.tsx"; do
            if [[ -f "$candidate" ]]; then echo "$candidate"; fi
          done
        done
    } | sort -u
  )
  echo "Fork tests: ${#tests[@]}"
  if (( ${#tests[@]} == 0 )); then return 0; fi
  printf '  %s\n' "${tests[@]}"
  vp test run --passWithNoTests "${tests[@]}"
}

run_check() {
  local name="$1" log="$LOG_DIR/check-$1.log"
  [[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::group::$name"
  "check_$name" 2>&1 | tee "$log"
  local status=${PIPESTATUS[0]}
  [[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::endgroup::"
  return "$status"
}

check() {
  local target="${1:-all}" failed=()
  case "$target" in
    hooks | brand | typecheck | tests) run_check "$target"; return ;;
    all) ;;
    *) usage ;;
  esac
  rm -f "$LOG_DIR/failed-checks"
  for name in hooks brand typecheck tests; do
    run_check "$name" || failed+=("$name")
  done
  if (( ${#failed[@]} > 0 )); then
    printf '%s\n' "${failed[@]}" > "$LOG_DIR/failed-checks"
    echo "check-${failed[0]}.log" > "$LOG_DIR/failure-log"
    echo "Failed checks: ${failed[*]}"
    return 1
  fi
  echo "All sync checks passed."
}

usage() {
  echo "Usage: bash scripts/agy/sync.sh merge <upstream-ref> | regen | check [all|hooks|brand|typecheck|tests]" >&2
  exit 2
}

case "${1:-}" in
  merge) [[ -n "${2:-}" ]] || usage; merge "$2" ;;
  regen) regen ;;
  check) check "${2:-all}" ;;
  *) usage ;;
esac
