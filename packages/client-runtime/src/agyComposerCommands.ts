// Fork: composer-side handling of the Antigravity slash commands, shared by web and mobile.
// Native-first: a command the provider or upstream T3 already offers under the same name wins,
// so the fork's entry is hidden and its text reaches the provider untouched.
import {
  AGY_COMMANDS,
  AGY_PROMPT_COMMANDS,
  AGY_UI_COMMANDS,
  parseAgyPromptCommands,
  type AgyCommandInfo,
  type ProviderInteractionMode,
} from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

/** Slash commands upstream T3 already implements in the composer. */
const UPSTREAM_SLASH_COMMANDS = ["model", "side", "btw", "clear", "compact", "usage-limits"];

const AGY_COMMAND_DESCRIPTIONS: Readonly<Record<string, string>> = {
  plan: msg("Explore, clarify, and draft a reviewable implementation plan before editing"),
  "grill-me": msg("Get interviewed one question at a time, with a recommended answer each"),
  boost: msg("Multi-agent deep reasoning: solve, challenge, fix, and verify in rounds"),
  swarm: msg("Named workers and a verifier coordinating on a shared message board"),
  teamwork: msg("Scoping interview, then a team with milestone review gates"),
  goal: msg("Work autonomously until the goal is verified complete"),
  learn: msg("Turn this session's corrections into a rule or skill you approve"),
  browser: msg("Hand browsing, UI checks, and screenshots to a browser subagent"),
  schedule: msg("Wake the agent later in this thread, once or on a schedule"),
  "run-workflow": msg("Write and run a workflow that orchestrates many agents"),
  "swarm board": msg("Open the live swarm board"),
  diff: msg("Open the diff viewer"),
  rename: msg("Rename this thread"),
  fork: msg("Fork this thread"),
  rewind: msg("Roll the conversation back to an earlier message"),
  settings: msg("Open settings"),
  keybindings: msg("Edit keyboard shortcuts"),
  mcp: msg("Manage MCP servers"),
  skills: msg("Browse skills"),
  usage: msg("Show model usage limits"),
  context: msg("Show context window usage"),
  effort: msg("Set reasoning effort"),
  new: msg("Start a new thread"),
  resume: msg("Find and reopen a thread"),
  copy: msg("Copy the last response"),
  help: msg("List the available commands"),
};

export interface AgyMenuCommand {
  readonly name: string;
  readonly description: string;
  readonly argumentHint: string | null;
  readonly kind: AgyCommandInfo["kind"];
}

/** Lowercased names the fork must yield to: the provider's own commands plus upstream's. */
export function agyNativeCommandNames(
  providerCommands: ReadonlyArray<{ readonly name: string }>,
): ReadonlySet<string> {
  return new Set([
    ...UPSTREAM_SLASH_COMMANDS,
    ...providerCommands.map((command) => command.name.toLowerCase()),
  ]);
}

function isYielded(name: string, nativeNames: ReadonlySet<string>): boolean {
  return nativeNames.has(name) || nativeNames.has(name.split(" ")[0] ?? name);
}

/**
 * True when everything before the cursor is only fork prompt commands (`/plan /grill-me `), so a
 * further command can stack on them.
 */
export function agyCommandsMayStack(textBeforeTrigger: string): boolean {
  const tokens = textBeforeTrigger.trim().split(/\s+/u).filter(Boolean);
  return tokens.every((token) => AGY_PROMPT_COMMANDS.some((command) => token === `/${command}`));
}

/**
 * The fork's commands for the `/` menu. Prompt commands may stack after earlier prompt commands;
 * UI commands appear only at the start of an empty prompt and only when `uiAvailable` has them.
 */
export function agyMenuCommands(input: {
  readonly textBeforeTrigger: string;
  readonly nativeNames: ReadonlySet<string>;
  readonly uiAvailable: ReadonlySet<string>;
  readonly resolve?: MFunctionType;
}): AgyMenuCommand[] {
  const resolve = input.resolve ?? mFallback;
  const atStart = input.textBeforeTrigger.trim() === "";
  if (!atStart && !agyCommandsMayStack(input.textBeforeTrigger)) return [];
  const used = new Set(input.textBeforeTrigger.trim().split(/\s+/u));
  return AGY_COMMANDS.filter((command) => {
    if (isYielded(command.name, input.nativeNames)) return false;
    if (command.kind === "ui") return atStart && input.uiAvailable.has(command.name);
    return !used.has(`/${command.name}`);
  }).map((command) => ({
    name: command.name,
    argumentHint: command.argumentHint,
    kind: command.kind,
    description: resolve(AGY_COMMAND_DESCRIPTIONS[command.name] ?? command.description),
  }));
}

/** `/plan` at the start of a message, alone or stacked, sends the turn in plan mode. */
export function agyInteractionModeForText(text: string): ProviderInteractionMode {
  return parseAgyPromptCommands(text)?.commands.includes("plan") ? "plan" : "default";
}

export interface AgyUiCommandCall {
  readonly name: (typeof AGY_UI_COMMANDS)[number];
  readonly argument: string;
}

/**
 * A message that is exactly one UI command, such as `/diff` or `/rename New title`. Returns
 * null for anything else, for commands that are unavailable, and for ones a native command owns.
 */
export function parseAgyUiCommand(
  text: string,
  nativeNames: ReadonlySet<string>,
  uiAvailable: ReadonlySet<string>,
): AgyUiCommandCall | null {
  const match = /^\/(swarm\s+board|[a-z][a-z-]*)(?:\s+([\s\S]*))?$/u.exec(text.trim());
  const rawName = match?.[1]?.replace(/\s+/u, " ");
  const name = AGY_UI_COMMANDS.find((candidate) => candidate === rawName);
  if (name === undefined || !uiAvailable.has(name) || isYielded(name, nativeNames)) return null;
  const argument = (match?.[2] ?? "").trim();
  if (name === "rename" ? argument.length === 0 : argument.length > 0) return null;
  return { name, argument };
}

/** Whether picking this command from the menu runs it at once instead of inserting `/name `. */
export function agyUiCommandRunsOnSelect(name: string): boolean {
  return AGY_UI_COMMANDS.some((command) => command === name) && name !== "rename";
}

/** `/name` for every command the fork offers right now, for a `/help` listing. */
export function agyHelpCommandNames(
  nativeNames: ReadonlySet<string>,
  uiAvailable: ReadonlySet<string>,
): string[] {
  return agyMenuCommands({ textBeforeTrigger: "", nativeNames, uiAvailable }).map(
    (command) => `/${command.name}`,
  );
}
