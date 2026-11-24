<p align="center"><img src="../scripts/agy/brand/swarmcode-192.png" width="96" height="96" alt="Swarmcode"></p>

<h1 align="center">Swarmcode</h1>

> **Swarmcode is an unofficial fork based on the T3 Code source code.** It is not affiliated with, endorsed by, or maintained by T3 Tools, Inc. For the official app, go to [github.com/pingdotgg/t3code](https://github.com/pingdotgg/t3code).

Swarmcode is a desktop GUI for coding agents that keeps up with T3 Code's upstream source and adds Antigravity-style commands:

- **Slash commands** such as `/plan`, `/boost` and `/swarm`, on every provider. A provider that lacks one gets it as prompt instructions; one that has it natively keeps its own.
- **Swarms**: `/swarm` starts a team of agents that work in their own threads and talk on a shared board. The Swarm panel beside the chat shows the board live, with members, a graph of who talks to whom, and an overview.

## Install

Download the latest `Swarmcode-*.exe` from [Releases](https://github.com/DaniloSkyrim/swarmcode/releases) and run it. The builds are unsigned, so Windows SmartScreen warns on the first install. After that the app updates itself from this repository's releases.

Swarmcode stores its data in `~/.t3`, the same place as T3 Code. It installs next to the official app, sees the same projects and threads, and only one of the two can run at a time.

## How it stays current

Every 6 hours a workflow merges upstream into the `agy` branch, checks that the fork's hooks and branding still apply, runs the fork's tests, and publishes a new nightly. When upstream ships one of these features natively, the native version wins and the fork's copy is removed. Maintainer notes are in [docs/agy-fork.md](../docs/agy-fork.md).

## License

The source code is MIT licensed, like upstream ([LICENSE](../LICENSE)). The MIT license does not cover T3 Tools' trademarks; see [TRADEMARK.md](../TRADEMARK.md).
