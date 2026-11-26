# Agy fork

Maintainer notes for the `agy` fork of T3 Code, published as **Swarmcode**, an unofficial fork that is not affiliated with T3 Tools, Inc. `main` mirrors `pingdotgg/t3code`; `agy` is `main` plus the fork.

## What the fork adds

- Antigravity-style slash commands (`/plan`, `/boost`, `/swarm`, and more) that become prompt instructions on providers that lack them.
- A swarm board: a shared board where agents in a thread talk, with MCP tools, a WebSocket subscription, and a right-panel tab. Member threads carry `lineage.swarmMember` with the swarm's thread as parent, so thread lists leave them out and they open from the board. As in Antigravity, a post that names a member rings it once, and only while it is idle: a member mid-turn is rung when that turn ends, with what it has not read, so its thread never stacks queued wake messages.

Each member's pixel-art bee flaps its wings while that member is working, as in Antigravity. That loop is a deliberate, owner-approved exception to the no-repainting-animation rule in `AGENTS.md`. It stays a 2-frame step at about 4 fps, only in the roster and graph, and stops when the member stops, when the panel unmounts, or under reduced motion. Do not add other loops.

## Native-first rule

If upstream ships the same feature natively, upstream wins and the fork copy is deleted. A command the provider or upstream T3 already offers under the same name is already hidden by the fork. The board commands (`AGY_BOARD_COMMANDS`: `/swarm`, `/boost`, `/teamwork`) are the exception: a provider's own swarm runs where T3 cannot show it (Antigravity's runs in its app pane), so the fork's version runs on every provider, Antigravity included, and the provider's same-named command is hidden. `node scripts/agy/check-hooks.ts` prints a warning when upstream code mentions one of the fork's command names (read from `AGY_PROMPT_COMMANDS` and `AGY_UI_COMMANDS` in `packages/contracts/src/agy.ts`). A warning is a prompt to look, not proof: `/goal` already appears in the Codex provider, and the fork handles it through `nativeGoals`.

## Layout

Fork-only files (no upstream conflicts possible): `packages/contracts/src/agy.ts`, `apps/server/src/agy/**`, `apps/server/src/mcp/toolkits/swarm/**`, the web swarm components, and `scripts/agy/**`.

Hook lines in upstream files are kept to one to a few lines each, so merges stay small. The list of files and the literal text each must contain is `scripts/agy/hooks.json`. Add an entry there whenever you add a hook line. `node scripts/agy/check-hooks.ts` fails when a hook is missing.

## Syncing

`.github/workflows/agy-sync.yml` runs every 6 hours and on demand:

1. Stops right there, successfully, when `agy` already contains `upstream/main` and `main` already matches it.
2. Fast-forwards `main` to `upstream/main` and pushes it.
3. Merges `upstream/main` into `agy`. Conflicts in `pnpm-lock.yaml` and the web and mobile i18n catalogs take upstream's side; any other conflict fails the run.
4. Reinstalls (refreshing the lockfile if it was taken from upstream), runs `vp run -r i18n:generate`, and commits what changed.
5. Runs the hook check, typechecks contracts, client-runtime, server, web (and mobile when it has fork files), and runs the fork's tests.
6. Pushes `agy` only if every step passed.

On failure it opens an issue labeled `agy-sync` (or comments on the open one) with the failing step and a log excerpt, and closes it on the next success.

To resolve a failed sync locally:

```sh
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout agy && git merge upstream/main
# fix conflicts, keep the fork's hook lines, prefer upstream where it did the same thing
vp install && vp run -r i18n:generate
node scripts/agy/check-hooks.ts
vp run check:changed
git push origin agy
```

If a hook line is gone, re-add it from `hooks.json` (or from `git log -p` on the file) rather than reshaping the upstream code around it.

## Releases and versioning

`.github/workflows/agy-release.yml` runs on pushes to `agy`, after a successful sync, or by hand (with a `force` option) and skips commits that already have a release. It builds an unsigned Windows NSIS installer on Linux the way upstream does (`cargo xwin` for the resource monitor, `vp run build:desktop:bundle`, then `build-desktop-artifact.ts --platform win --target nsis --arch x64 --skip-build`) and publishes a prerelease with the installer, blockmap and `nightly.yml`. Do not move it to a Windows runner: a Windows host also writes a server compile cache into the payload, which exceeds its file limit.

The version is `<upstream base>-nightly.<YYYYMMDD>.<N>`, from `scripts/resolve-nightly-release.ts`. The base is the next patch after `apps/desktop/package.json`, as for upstream nightlies. `N` is `100000 + the fork's run number`, far above upstream's own run numbers (a few thousand), so the fork build sorts after any upstream nightly from the same day and after the fork's earlier builds. Revisit the offset if upstream's run numbers approach 100000.

`T3CODE_DESKTOP_UPDATE_REPOSITORY` is set to this repository, so the installed app updates from the fork's releases.

## Branding

[TRADEMARK.md](../TRADEMARK.md) requires a published fork to replace T3 Code's name, wordmark and icons and to say it is unofficial. The source stays upstream's so merges stay clean; `scripts/agy/apply-brand.ts` rebrands only the release checkout, right before the build:

- Product name `Swarmcode (Nightly)`, app id `io.github.daniloskyrim.swarmcode`, installer `Swarmcode-<version>-x64.exe`, and the startup-recovery releases link pointing at this repository.
- The bee icons in `scripts/agy/brand/` over every file in `assets/nightly`, `assets/prod` and `apps/web/public`, a bee mark in place of the `T3Wordmark` artwork, and the sidebar and page titles.
- The update channel is pinned to nightly in `DesktopUpdates.ts`, since the fork publishes nothing else and `desktop-settings.json` is shared with the official app, leaving the official app's saved channel untouched.
- "T3 Code" becomes "Swarmcode" in web, desktop and client-runtime copy. Catalog keys hash the English text, so the script runs each app's `gt generate` and carries every existing translation over to its new key.

`--check` only verifies that each spot still exists; the sync runs it, so an upstream change that moves one fails the sync instead of the next release. When it fails, update the strings in `apply-brand.ts`. Never commit the script's output.

Swarmcode installs next to the official app, not over it. Both still use `~/.t3`, so they share projects and threads, and only one can run at a time.

Differences from an upstream nightly: unsigned (SmartScreen warns on first install), no WSL runtime bundled (that needs the Linux CLI archive), no `update-feed` pointer release (the updater falls back to the releases feed, which is fine while the fork's releases are the newest tags), and telemetry reports `dev`.

## Installing

Download the `.exe` from the latest prerelease and run it. After that the app follows the fork's releases on its own.

## Repository settings

- Default branch: `agy` (scheduled workflows run from the default branch, and the workflow files exist only on `agy`).
- Settings, Actions, General, Workflow permissions: read and write, so `GITHUB_TOKEN` gets `contents: write` and `issues: write` (both workflows request them explicitly).
- Secret `AGY_SYNC_TOKEN`: a personal access token with `repo` and `workflow` scopes (fine-grained: Contents and Workflows, read and write). Needed whenever upstream changes files under `.github/workflows`, because `GITHUB_TOKEN` cannot push those. Pushes made with the token also trigger other workflows.
- Disable the inherited upstream workflows (Actions tab, or Settings, Actions, General) apart from the two `Agy` ones. They target Blacksmith runners and upstream-only secrets and would only queue.
- `main` must stay an untouched mirror, or the fast-forward step fails.
