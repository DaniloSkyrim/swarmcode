You are repairing the automated upstream sync of the `agy` fork (Swarmcode) on a CI runner. `agy` is upstream T3 Code (`upstream/main`) plus the fork. The workflow merged `upstream/main` into `agy` and a stage failed. The failure and its log are at the end of this message: start from them instead of rediscovering the problem.

Read `docs/agy-fork.md` first, then fix only what the failure needs:

- Merge conflicts (the merge is still in progress): resolve every conflicted file. Keep the fork's hook lines (`scripts/agy/hooks.json` lists them) and prefer upstream's code wherever upstream now does the same thing (the native-first rule). Do not reshape upstream code around a hook. `git add` each resolved file.
- Install, type and test failures: change the fork's code to fit upstream's new shapes. Touch upstream code only at the fork's existing hook lines.
- Never delete, skip or weaken a test to make it pass, and never edit files under `.github` or `scripts/agy/sync.sh` (the push refuses both).
- Dependencies are not installed yet when the merge conflicted: once the conflicts (and any `package.json`) are resolved, run `vp install --no-frozen-lockfile`. Run it again after changing a `package.json`.

Then run `bash scripts/agy/sync.sh check all` and fix what it reports until it passes. Read all the files you need in one go and batch independent commands; do not explore beyond the failure.

Do not commit, push, reset, rebase, stash or abort the merge: the workflow commits your changes and pushes only if its own run of the same checks passes. Keep scratch files under `$RUNNER_TEMP`, never in the repository.

If you cannot fix it, stop and say why. End with a short report: what failed, what you changed and why, as a few lines with file paths and no diffs.

## Failure
