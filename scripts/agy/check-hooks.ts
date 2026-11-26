#!/usr/bin/env node
// Fork maintenance: verifies the small hook edits the agy fork keeps in upstream files, and
// warns when upstream ships a slash command under a name the fork also adds.
// Usage: node scripts/agy/check-hooks.ts [--no-collisions]
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const Manifest = Schema.Struct({
  forkFiles: Schema.Array(Schema.String),
  hooks: Schema.Array(
    Schema.Struct({ file: Schema.String, snippets: Schema.Array(Schema.String) }),
  ),
});
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));

class AgyHookCheckFailed extends Schema.TaggedError<AgyHookCheckFailed>()("AgyHookCheckFailed", {
  problems: Schema.Array(Schema.String),
}) {
  override get message() {
    return [
      `agy hook check failed (${this.problems.length}):`,
      ...this.problems.map((problem) => `  - ${problem}`),
      "See docs/agy-fork.md for how to restore a hook after a merge.",
    ].join("\n");
  }
}

const SKIPPED_DIRS = new Set(["node_modules", "dist", "dist-electron", ".git", ".repos"]);

const quotedList = (source: string, name: string) => {
  const match = new RegExp(String.raw`export const ${name} = \[([^\]]*)\]`).exec(source);
  return match ? [...match[1]!.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]!) : [];
};

const checkHooks = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "..", "..");
  const read = (file: string) =>
    fs.readFileString(path.join(root, file)).pipe(Effect.option, Effect.map(Option.getOrUndefined));

  const manifest = yield* decodeManifest(
    yield* fs.readFileString(path.join(root, "scripts/agy/hooks.json")),
  );
  const problems: string[] = [];

  for (const file of manifest.forkFiles) {
    if ((yield* read(file)) === undefined) problems.push(`missing fork file: ${file}`);
  }
  for (const hook of manifest.hooks) {
    const source = yield* read(hook.file);
    if (source === undefined) {
      problems.push(`missing upstream file: ${hook.file}`);
      continue;
    }
    // A snippet listed N times marks N hook sites, so it must appear at least N times.
    const expected = new Map<string, number>();
    for (const snippet of hook.snippets) expected.set(snippet, (expected.get(snippet) ?? 0) + 1);
    for (const [snippet, count] of expected) {
      const found = source.split(snippet).length - 1;
      if (found < count) {
        const sites = count > 1 ? ` (expected ${count} sites, found ${found})` : "";
        problems.push(`hook missing in ${hook.file}: ${snippet}${sites}`);
      }
    }
  }

  const walk = (dir: string) =>
    fs
      .readDirectory(path.join(root, dir), { recursive: true })
      .pipe(
        Effect.map((entries) =>
          entries
            .map((entry) => `${dir}/${entry.replaceAll("\\", "/")}`)
            .filter(
              (rel) =>
                /\.tsx?$/.test(rel) &&
                !/\.test\.tsx?$/.test(rel) &&
                !rel.split("/").some((segment) => SKIPPED_DIRS.has(segment)),
            ),
        ),
      );

  const agy = yield* read("packages/contracts/src/agy.ts");
  if (!process.argv.includes("--no-collisions") && agy !== undefined) {
    const names = [
      ...new Set([
        ...quotedList(agy, "AGY_PROMPT_COMMANDS"),
        ...quotedList(agy, "AGY_UI_COMMANDS"),
      ]),
    ];
    const sources: Array<readonly [string, string]> = [];
    for (const dir of ["apps/web/src", "packages/contracts/src", "apps/server/src"]) {
      for (const file of yield* walk(dir)) {
        if (!/agy|swarm/i.test(file)) sources.push([file, (yield* read(file)) ?? ""]);
      }
    }
    for (const name of names) {
      const slug = name.replaceAll(" ", "-");
      const patterns = [
        `command: "${slug}"`,
        `"slash:${slug}"`,
        `label: "/${name}"`,
        `name: "${slug}"`,
      ];
      const hit = sources.find(([, text]) => patterns.some((pattern) => text.includes(pattern)));
      if (hit) {
        yield* Effect.logWarning(
          `upstream may now offer /${name} natively (${hit[0]}). Native wins: ` +
            `drop it from the fork lists in packages/contracts/src/agy.ts if it behaves the same.`,
        );
      }
    }
  }

  if (problems.length > 0) return yield* new AgyHookCheckFailed({ problems });
  yield* Effect.log(
    `agy hooks ok (${manifest.hooks.length} files, ${manifest.forkFiles.length} fork files).`,
  );
});

if (import.meta.main) {
  checkHooks.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
