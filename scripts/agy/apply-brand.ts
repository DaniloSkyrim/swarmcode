#!/usr/bin/env node
// Release only: rebrands the checkout as Swarmcode, as TRADEMARK.md requires of a published
// fork. Never commit its output. See docs/agy-fork.md#branding.
// Usage: node scripts/agy/apply-brand.ts [--check]  (--check only verifies the targets)
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const NAME = "Swarmcode";
const APP_ID = "io.github.daniloskyrim.swarmcode";
const rebrand = (text: string) => text.replaceAll("T3 Code", NAME);

// UI copy that names the app. These files hold identifiers instead (legacy profile names,
// the CLI shim marker), so they keep the upstream name.
const COPY_ROOTS = ["apps/web/src", "apps/desktop/src", "packages/client-runtime/src"];
const COPY_KEEP = new Set([
  "apps/desktop/src/app/DesktopUserData.ts",
  "apps/desktop/src/app/DesktopLegacyLocalStorage.ts",
  "apps/desktop/src/app/DesktopCliShim.ts",
]);
// Catalog keys hash the English text, so renamed copy gets new keys; the old translations
// are carried over to them after each app's own generator runs.
const CATALOGS = [
  { app: "apps/web", generator: ["node_modules/gt/bin/main.js", "generate"] },
  { app: "apps/desktop", generator: ["scripts/i18n-generate.mjs"] },
];
const Catalog = Schema.Record(Schema.String, Schema.Unknown);
const decodeCatalog = Schema.decodeUnknownEffect(Schema.fromJsonString(Catalog));
const encodeCatalog = Schema.encodeEffect(Schema.fromJsonString(Catalog, { space: 2 }));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const WORDMARK_FILE = "apps/web/src/components/T3Wordmark.tsx";
const BEE_MARK = `import type { SVGProps } from "react";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="6.6" cy="9.2" rx="3.6" ry="2.5" transform="rotate(-30 6.6 9.2)" />
        <ellipse cx="17.4" cy="9.2" rx="3.6" ry="2.5" transform="rotate(30 17.4 9.2)" />
        <ellipse cx="12" cy="14.6" rx="4" ry="5.6" />
        <path d="M8.2 13h7.6M8.4 16.4h7.2M10.6 4.6 9.4 2.4M13.4 4.6l1.2-2.2" />
      </g>
      <circle cx="12" cy="6.6" r="2.3" fill="currentColor" />
      <path d="M11 20.3h2L12 22.2z" fill="currentColor" />
    </svg>
  );
}
`;

const ICONS: ReadonlyArray<readonly [source: string, targets: ReadonlyArray<string>]> = [
  [
    "swarmcode-1024.png",
    [
      "assets/nightly/nightly-macos-1024.png",
      "assets/nightly/nightly-universal-1024.png",
      "assets/prod/black-macos-1024.png",
      "assets/prod/black-universal-1024.png",
    ],
  ],
  [
    "swarmcode-ios-1024.png",
    ["assets/nightly/nightly-ios-1024.png", "assets/prod/black-ios-1024.png"],
  ],
  [
    "swarmcode-512.png",
    [
      "assets/nightly/nightly-web-icon-512x512.png",
      "assets/prod/t3-black-web-icon-512x512.png",
      "apps/web/public/icon-512x512.png",
    ],
  ],
  [
    "swarmcode-192.png",
    [
      "assets/nightly/nightly-web-icon-192x192.png",
      "assets/prod/t3-black-web-icon-192x192.png",
      "apps/web/public/icon-192x192.png",
    ],
  ],
  [
    "swarmcode-apple-touch-180.png",
    [
      "assets/nightly/nightly-web-apple-touch-180.png",
      "assets/prod/t3-black-web-apple-touch-180.png",
      "apps/web/public/apple-touch-icon.png",
    ],
  ],
  [
    "swarmcode-favicon-32.png",
    [
      "assets/nightly/nightly-web-favicon-32x32.png",
      "assets/prod/t3-black-web-favicon-32x32.png",
      "apps/web/public/favicon-32x32.png",
    ],
  ],
  [
    "swarmcode-favicon-16.png",
    [
      "assets/nightly/nightly-web-favicon-16x16.png",
      "assets/prod/t3-black-web-favicon-16x16.png",
      "apps/web/public/favicon-16x16.png",
    ],
  ],
  [
    "swarmcode-favicon.ico",
    [
      "assets/nightly/nightly-web-favicon.ico",
      "assets/prod/t3-black-web-favicon.ico",
      "apps/web/public/favicon.ico",
    ],
  ],
  [
    "swarmcode-windows.ico",
    ["assets/nightly/nightly-windows.ico", "assets/prod/t3-black-windows.ico"],
  ],
];

const edits = (
  repository: string,
): ReadonlyArray<{
  readonly file: string;
  readonly replace: ReadonlyArray<readonly [from: string, to: string]>;
}> => [
  {
    file: "scripts/build-desktop-artifact.ts",
    replace: [
      [`const DESKTOP_APP_ID = "com.t3tools.t3code";`, `const DESKTOP_APP_ID = "${APP_ID}";`],
      [`? "T3 Code (Nightly)"`, `? "${NAME} (Nightly)"`],
      [`(desktopPackageJson.productName ?? "T3 Code")`, `"${NAME}"`],
      [
        `artifactName: "T3-Code-\${version}-\${arch}.\${ext}"`,
        `artifactName: "${NAME}-\${version}-\${arch}.\${ext}"`,
      ],
      [
        `"T3 Code is an open-source desktop app for coding agents.`,
        `"${NAME} is an unofficial fork of T3 Code, not affiliated with T3 Tools, Inc. It is an open-source desktop app for coding agents.`,
      ],
      [`homepage: "https://t3.codes"`, `homepage: "https://github.com/${repository}"`],
      [`author: "T3 Tools"`, `author: "${NAME} contributors"`],
    ],
  },
  {
    file: "apps/desktop/src/app/DesktopEnvironment.ts",
    replace: [
      [`const APP_BASE_NAME = "T3 Code";`, `const APP_BASE_NAME = "${NAME}";`],
      [
        `isDevelopment ? "com.t3tools.t3code.dev" : "com.t3tools.t3code"`,
        `isDevelopment ? "${APP_ID}.dev" : "${APP_ID}"`,
      ],
    ],
  },
  {
    file: "apps/desktop/src/app/DesktopStartupRecovery.ts",
    replace: [
      [
        `const RELEASES_URL = "https://github.com/pingdotgg/t3code/releases";`,
        `const RELEASES_URL = "https://github.com/${repository}/releases";`,
      ],
    ],
  },
  {
    file: "apps/web/src/branding.ts",
    replace: [[`?.baseName ?? "T3 Code";`, `?.baseName ?? "${NAME}";`]],
  },
  {
    file: "apps/web/index.html",
    replace: [
      ["<title>T3 Code</title>", `<title>${NAME}</title>`],
      [`aria-label="T3 Code splash screen"`, `aria-label="${NAME} splash screen"`],
      [`alt="T3 Code"`, `alt="${NAME}"`],
    ],
  },
  {
    file: "apps/web/public/manifest.webmanifest",
    replace: [
      [`"name": "T3 Code"`, `"name": "${NAME}"`],
      [`"short_name": "T3 Code"`, `"short_name": "${NAME}"`],
    ],
  },
  {
    file: "apps/web/src/components/sidebar/SidebarChrome.tsx",
    replace: [
      [`import { T3Wordmark } from "../T3Wordmark";`, `import { T3AppIcon } from "../T3AppIcon";`],
      [
        `<T3Wordmark aria-label="T3" className="h-[1cap] w-auto shrink-0" />`,
        `<T3AppIcon className="size-4 shrink-0 self-center rounded-[4px]" />`,
      ],
      [`{"Code"}`, `{"${NAME}"}`],
    ],
  },
  {
    file: "apps/web/src/components/ui/standalone-page.tsx",
    replace: [
      [
        `<span className="text-lg font-medium tracking-tight">Code</span>`,
        `<span className="text-lg font-medium tracking-tight">${NAME}</span>`,
      ],
    ],
  },
];

class AgyBrandCheckFailed extends Schema.TaggedError<AgyBrandCheckFailed>()("AgyBrandCheckFailed", {
  problems: Schema.Array(Schema.String),
}) {
  override get message() {
    return [
      `Swarmcode rebrand cannot apply (${this.problems.length}):`,
      ...this.problems.map((problem) => `  - ${problem}`),
      "Upstream moved a branded spot; update scripts/agy/apply-brand.ts to match.",
    ].join("\n");
  }
}

const applyBrand = Effect.fn("applyBrand")(function* (checkOnly: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repository = yield* Config.String("GITHUB_REPOSITORY").pipe(
    Config.withDefault("DaniloSkyrim/swarmcode"),
  );
  const root = path.resolve(import.meta.dirname, "..", "..");
  const problems: string[] = [];
  const rewrites: Array<readonly [string, string]> = [];

  for (const { file, replace } of edits(repository)) {
    const source = yield* fs.readFileString(path.join(root, file)).pipe(Effect.option);
    if (source._tag === "None") {
      problems.push(`missing file: ${file}`);
      continue;
    }
    let next = source.value;
    for (const [from, to] of replace) {
      if (next.includes(from)) next = next.replaceAll(from, to);
      else if (!next.includes(to)) problems.push(`${file}: no longer contains ${from}`);
    }
    if (next !== source.value) rewrites.push([file, next]);
  }
  for (const [source, targets] of ICONS) {
    for (const file of [`scripts/agy/brand/${source}`, ...targets]) {
      if (!(yield* fs.exists(path.join(root, file)))) problems.push(`missing icon file: ${file}`);
    }
  }
  const wordmark = yield* fs.readFileString(path.join(root, WORDMARK_FILE)).pipe(Effect.option);
  if (wordmark._tag === "None" || !wordmark.value.includes("export function T3Wordmark(")) {
    problems.push(`${WORDMARK_FILE} no longer exports T3Wordmark`);
  }
  for (const file of [
    ...COPY_ROOTS,
    ...CATALOGS.flatMap(({ app, generator }) => [
      `${app}/src/i18n/translations/en.json`,
      `${app}/${generator[0]}`,
    ]),
  ]) {
    if (!(yield* fs.exists(path.join(root, file)))) problems.push(`missing: ${file}`);
  }

  if (problems.length > 0) return yield* new AgyBrandCheckFailed({ problems });
  if (checkOnly) return yield* Effect.log("Swarmcode rebrand targets ok.");

  const catalogDir = (app: string) => path.join(root, app, "src/i18n/translations");
  const readCatalogs = Effect.fn("readCatalogs")(function* (app: string) {
    const catalogs = new Map<string, Record<string, unknown>>();
    for (const file of yield* fs.readDirectory(catalogDir(app))) {
      if (!file.endsWith(".json")) continue;
      const text = yield* fs.readFileString(path.join(catalogDir(app), file));
      catalogs.set(file, { ...(yield* decodeCatalog(text)) });
    }
    return catalogs;
  });
  const before = new Map<string, Map<string, Record<string, unknown>>>();
  for (const { app } of CATALOGS) before.set(app, yield* readCatalogs(app));

  for (const [file, text] of rewrites) {
    yield* fs.writeFileString(path.join(root, file), text);
  }
  for (const [source, targets] of ICONS) {
    for (const target of targets) {
      yield* fs.copyFile(path.join(root, "scripts/agy/brand", source), path.join(root, target));
    }
  }
  yield* fs.writeFileString(path.join(root, WORDMARK_FILE), BEE_MARK);

  let copyFiles = 0;
  for (const dir of COPY_ROOTS) {
    for (const entry of yield* fs.readDirectory(path.join(root, dir), { recursive: true })) {
      const file = `${dir}/${entry.replaceAll("\\", "/")}`;
      if (
        !/\.tsx?$/.test(file) ||
        /\.(test|browser)\.tsx?$/.test(file) ||
        file.includes("/node_modules/") ||
        COPY_KEEP.has(file)
      ) {
        continue;
      }
      const text = yield* fs.readFileString(path.join(root, file));
      if (!text.includes("T3 Code")) continue;
      yield* fs.writeFileString(path.join(root, file), rebrand(text));
      copyFiles += 1;
    }
  }

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  let carried = 0;
  let untranslated = 0;
  for (const { app, generator } of CATALOGS) {
    const exitCode = yield* spawner
      .spawn(
        ChildProcess.make("node", generator, {
          cwd: path.join(root, app),
          stdout: "inherit",
          stderr: "inherit",
        }),
      )
      .pipe(
        Effect.flatMap((child) => child.exitCode),
        Effect.map(Number),
        Effect.scoped,
      );
    if (exitCode !== 0) {
      return yield* new AgyBrandCheckFailed({
        problems: [`${app}: i18n generator exited with ${exitCode}`],
      });
    }

    const old = before.get(app) ?? new Map<string, Record<string, unknown>>();
    const after = yield* readCatalogs(app);
    const oldEn = old.get("en.json") ?? {};
    const newEn = after.get("en.json") ?? {};
    const oldKeyByText = new Map<string, string>();
    for (const [key, value] of Object.entries(oldEn)) {
      if (!(key in newEn)) oldKeyByText.set(rebrand(yield* encodeJson(value)), key);
    }
    for (const [file, catalog] of after) {
      const previous = old.get(file) ?? {};
      if (file !== "en.json") {
        for (const key of Object.keys(catalog)) {
          if (key in previous) continue;
          const oldKey = oldKeyByText.get(yield* encodeJson(newEn[key]));
          if (oldKey !== undefined && oldKey in previous) {
            catalog[key] = previous[oldKey];
            carried += 1;
          } else {
            untranslated += 1;
          }
        }
      }
      yield* fs.writeFileString(
        path.join(catalogDir(app), file),
        rebrand(`${yield* encodeCatalog(catalog)}\n`),
      );
    }
  }

  yield* Effect.log(
    `Rebranded as ${NAME}: ${rewrites.length} branded files, ${copyFiles} copy files, ` +
      `${carried} translations carried to new keys (${untranslated} left in English), ` +
      `links to ${repository}.`,
  );
});

if (import.meta.main) {
  applyBrand(process.argv.includes("--check")).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
