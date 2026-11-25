// Fork: Antigravity-style commands and the swarm board. Kept in one file so upstream merges
// touch only the `export *` line in index.ts.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const AgySwarmMemberName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(40),
  Schema.makeFilter((value) =>
    /^[a-z0-9][a-z0-9_-]*$/u.test(value)
      ? true
      : "A swarm member name is lowercase letters, digits, '-' and '_', starting with a letter or digit.",
  ),
);
export type AgySwarmMemberName = typeof AgySwarmMemberName.Type;

export const AgySwarmMemberRole = Schema.Literals(["coordinator", "worker"]);
export type AgySwarmMemberRole = typeof AgySwarmMemberRole.Type;

/** Live state, derived from the member's thread when a snapshot is read. */
export const AgySwarmMemberState = Schema.Literals([
  "working",
  "waiting",
  "needs-input",
  "stopped",
  "killed",
]);
export type AgySwarmMemberState = typeof AgySwarmMemberState.Type;

export const AgySwarmMetrics = Schema.Struct({
  turns: NonNegativeInt,
  inputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
  totalTokens: NonNegativeInt,
});
export type AgySwarmMetrics = typeof AgySwarmMetrics.Type;

export const AgySwarmMember = Schema.Struct({
  name: Schema.String,
  threadId: ThreadId,
  role: AgySwarmMemberRole,
  addedBy: Schema.String,
  instanceId: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  workspace: Schema.Literals(["inherit", "worktree"]),
  worktreePath: Schema.optional(Schema.NullOr(Schema.String)),
  branch: Schema.optional(Schema.NullOr(Schema.String)),
  owns: Schema.optional(Schema.Array(Schema.String)),
  canManage: Schema.optional(Schema.Boolean),
  readOnly: Schema.optional(Schema.Boolean),
  scratchDir: Schema.optional(Schema.NullOr(Schema.String)),
  channels: Schema.Array(Schema.String),
  brief: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  killedAt: Schema.NullOr(Schema.String),
  lastReadSeq: NonNegativeInt,
  lastPostSeq: Schema.NullOr(NonNegativeInt),
  state: AgySwarmMemberState,
  activity: Schema.NullOr(Schema.String),
  metrics: Schema.optional(AgySwarmMetrics),
});
export type AgySwarmMember = typeof AgySwarmMember.Type;

export const AgySwarmPostKind = Schema.Literals(["post", "brief", "system", "stall"]);
export type AgySwarmPostKind = typeof AgySwarmPostKind.Type;

export const AgySwarmPost = Schema.Struct({
  seq: NonNegativeInt,
  from: Schema.String,
  text: Schema.String,
  mentions: Schema.Array(Schema.String),
  channel: Schema.String,
  kind: AgySwarmPostKind,
  createdAt: Schema.String,
});
export type AgySwarmPost = typeof AgySwarmPost.Type;

export const AgySwarmChannel = Schema.Struct({
  name: Schema.String,
  topic: Schema.String,
  createdBy: Schema.String,
  archived: Schema.Boolean,
});
export type AgySwarmChannel = typeof AgySwarmChannel.Type;

export const AgySwarmGateStatus = Schema.Literals(["pending", "running", "passed", "failed"]);
export type AgySwarmGateStatus = typeof AgySwarmGateStatus.Type;

export const AgySwarmIntegrityMode = Schema.Literals(["development", "demo", "benchmark"]);
export type AgySwarmIntegrityMode = typeof AgySwarmIntegrityMode.Type;

export const AgySwarmMilestoneStatus = Schema.Literals([
  "pending",
  "in_progress",
  "verifying",
  "passed",
  "blocked",
]);
export type AgySwarmMilestoneStatus = typeof AgySwarmMilestoneStatus.Type;

export const AgySwarmMilestoneGates = Schema.Struct({
  critic: Schema.optional(AgySwarmGateStatus),
  challenger: Schema.optional(AgySwarmGateStatus),
  auditor: Schema.optional(AgySwarmGateStatus),
});
export type AgySwarmMilestoneGates = typeof AgySwarmMilestoneGates.Type;

export const AgySwarmMilestone = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: AgySwarmMilestoneStatus,
  summary: Schema.optional(Schema.String),
  gates: Schema.optional(AgySwarmMilestoneGates),
});
export type AgySwarmMilestone = typeof AgySwarmMilestone.Type;

export const AgySwarmBoostRoundStatus = Schema.Literals(["running", "fixed", "clean", "blocked"]);
export type AgySwarmBoostRoundStatus = typeof AgySwarmBoostRoundStatus.Type;

export const AgySwarmBoostRound = Schema.Struct({
  round: NonNegativeInt,
  worker: Schema.String,
  status: AgySwarmBoostRoundStatus,
  summary: Schema.optional(Schema.String),
});
export type AgySwarmBoostRound = typeof AgySwarmBoostRound.Type;

export const AgySwarmArtifactRef = Schema.Struct({
  label: Schema.String,
  path: Schema.String,
});
export type AgySwarmArtifactRef = typeof AgySwarmArtifactRef.Type;

export const AgySwarmFinalAudit = Schema.Struct({
  status: AgySwarmGateStatus,
  summary: Schema.optional(Schema.String),
});
export type AgySwarmFinalAudit = typeof AgySwarmFinalAudit.Type;

export const AgySwarmPlan = Schema.Struct({
  goal: Schema.Struct({ title: Schema.String, line: Schema.String }),
  tasks: Schema.Record(Schema.String, Schema.String),
  threads: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      goal: Schema.String,
      tasks: Schema.Array(Schema.String),
    }),
  ),
  mode: Schema.optional(Schema.String),
  integrityMode: Schema.optional(AgySwarmIntegrityMode),
  projectDir: Schema.optional(Schema.String),
  artifacts: Schema.optional(Schema.Array(AgySwarmArtifactRef)),
  milestones: Schema.optional(Schema.Array(AgySwarmMilestone)),
  rounds: Schema.optional(Schema.Array(AgySwarmBoostRound)),
  finalAudit: Schema.optional(AgySwarmFinalAudit),
});
export type AgySwarmPlan = typeof AgySwarmPlan.Type;

export const AgySwarmKind = Schema.Literals(["swarm", "boost", "teamwork"]);
export type AgySwarmKind = typeof AgySwarmKind.Type;

export const AgySwarmSnapshot = Schema.Struct({
  id: Schema.String,
  kind: AgySwarmKind,
  title: Schema.String,
  coordinatorThreadId: ThreadId,
  createdAt: Schema.String,
  doneAt: Schema.NullOr(Schema.String),
  plan: Schema.NullOr(AgySwarmPlan),
  channels: Schema.Array(AgySwarmChannel),
  members: Schema.Array(AgySwarmMember),
  posts: Schema.Array(AgySwarmPost),
  head: NonNegativeInt,
  totalPostCount: Schema.optional(NonNegativeInt),
  oldestIncludedSeq: Schema.optional(NonNegativeInt),
  metrics: Schema.optional(AgySwarmMetrics),
});
export type AgySwarmSnapshot = typeof AgySwarmSnapshot.Type;

export class AgySwarmRequestError extends Schema.TaggedError<AgySwarmRequestError>()(
  "AgySwarmRequestError",
  {
    message: Schema.String,
  },
) {}

export const AgySwarmGetInput = Schema.Struct({ threadId: ThreadId });
export type AgySwarmGetInput = typeof AgySwarmGetInput.Type;

/** Null when the thread belongs to no swarm. */
export const AgySwarmGetResult = Schema.NullOr(AgySwarmSnapshot);
export type AgySwarmGetResult = typeof AgySwarmGetResult.Type;

export const AgySwarmPostInput = Schema.Struct({
  threadId: ThreadId,
  text: TrimmedNonEmptyString,
  channel: Schema.optional(Schema.String),
});
export type AgySwarmPostInput = typeof AgySwarmPostInput.Type;

export const AgySwarmPostResult = Schema.Struct({
  seq: NonNegativeInt,
  mentions: Schema.Array(Schema.String),
  note: Schema.optional(Schema.String),
});
export type AgySwarmPostResult = typeof AgySwarmPostResult.Type;

export const AgySwarmKillInput = Schema.Struct({
  threadId: ThreadId,
  name: TrimmedNonEmptyString,
  force: Schema.optional(Schema.Boolean),
});
export type AgySwarmKillInput = typeof AgySwarmKillInput.Type;

export const AgySwarmRetryInput = Schema.Struct({
  threadId: ThreadId,
  name: TrimmedNonEmptyString,
  message: Schema.optional(Schema.String),
});
export type AgySwarmRetryInput = typeof AgySwarmRetryInput.Type;

export const AgySwarmAddInput = Schema.Struct({
  threadId: ThreadId,
  name: AgySwarmMemberName,
  brief: TrimmedNonEmptyString,
  model: Schema.optional(Schema.String),
  reasoningEffort: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.Literals(["inherit", "worktree"])),
  channels: Schema.optional(Schema.Array(Schema.String)),
  owns: Schema.optional(Schema.Array(Schema.String)),
  readOnly: Schema.optional(Schema.Boolean),
  manager: Schema.optional(Schema.Boolean),
});
export type AgySwarmAddInput = typeof AgySwarmAddInput.Type;

export const AgySwarmActionResult = Schema.Struct({
  message: Schema.String,
});
export type AgySwarmActionResult = typeof AgySwarmActionResult.Type;

export const AgySwarmLoadPostsInput = Schema.Struct({
  threadId: ThreadId,
  beforeSeq: NonNegativeInt,
  limit: Schema.optional(NonNegativeInt),
});
export type AgySwarmLoadPostsInput = typeof AgySwarmLoadPostsInput.Type;

export const AgySwarmLoadPostsResult = Schema.Struct({
  posts: Schema.Array(AgySwarmPost),
  hasMore: Schema.Boolean,
});
export type AgySwarmLoadPostsResult = typeof AgySwarmLoadPostsResult.Type;

/** Coordinator thread currently running an active swarm with at least one working worker. */
export const AgyActiveSwarm = Schema.Struct({
  threadId: ThreadId,
  startedAt: Schema.String,
});
export type AgyActiveSwarm = typeof AgyActiveSwarm.Type;

export const AgyActiveSwarmsSnapshot = Schema.Struct({
  active: Schema.Array(AgyActiveSwarm),
});
export type AgyActiveSwarmsSnapshot = typeof AgyActiveSwarmsSnapshot.Type;

export const AGY_WS_METHODS = {
  swarmSubscribe: "agy.swarm.subscribe",
  swarmActiveSubscribe: "agy.swarm.activeSubscribe",
  swarmPost: "agy.swarm.post",
  swarmKill: "agy.swarm.kill",
  swarmRetry: "agy.swarm.retry",
  swarmAdd: "agy.swarm.add",
  swarmLoadPosts: "agy.swarm.loadPosts",
} as const;

const AgySwarmRpcError = Schema.Union([AgySwarmRequestError, EnvironmentAuthorizationError]);

/** Emits the swarm of a thread (as coordinator or member) now and on every change. */
export const AgyWsSwarmSubscribeRpc = Rpc.make(AGY_WS_METHODS.swarmSubscribe, {
  payload: AgySwarmGetInput,
  success: AgySwarmGetResult,
  error: EnvironmentAuthorizationError,
  stream: true,
});

/** Emits active coordinator threads (with live working workers) across the environment. */
export const AgyWsSwarmActiveSubscribeRpc = Rpc.make(AGY_WS_METHODS.swarmActiveSubscribe, {
  payload: Schema.Struct({}),
  success: AgyActiveSwarmsSnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const AgyWsSwarmPostRpc = Rpc.make(AGY_WS_METHODS.swarmPost, {
  payload: AgySwarmPostInput,
  success: AgySwarmPostResult,
  error: AgySwarmRpcError,
});

export const AgyWsSwarmKillRpc = Rpc.make(AGY_WS_METHODS.swarmKill, {
  payload: AgySwarmKillInput,
  success: AgySwarmActionResult,
  error: AgySwarmRpcError,
});

export const AgyWsSwarmRetryRpc = Rpc.make(AGY_WS_METHODS.swarmRetry, {
  payload: AgySwarmRetryInput,
  success: AgySwarmActionResult,
  error: AgySwarmRpcError,
});

export const AgyWsSwarmAddRpc = Rpc.make(AGY_WS_METHODS.swarmAdd, {
  payload: AgySwarmAddInput,
  success: AgySwarmActionResult,
  error: AgySwarmRpcError,
});

export const AgyWsSwarmLoadPostsRpc = Rpc.make(AGY_WS_METHODS.swarmLoadPosts, {
  payload: AgySwarmLoadPostsInput,
  success: AgySwarmLoadPostsResult,
  error: AgySwarmRpcError,
});

// Slash commands the fork adds. A command a provider or upstream T3 already offers under the
// same name wins: the menu hides the fork's entry and the server leaves the text alone. The board
// commands are the exception (see AGY_BOARD_COMMANDS).
export const AGY_PROMPT_COMMANDS = [
  "plan",
  "grill-me",
  "boost",
  "swarm",
  "teamwork",
  "goal",
  "learn",
  "browser",
  "schedule",
  "run-workflow",
] as const;
export type AgyPromptCommand = (typeof AGY_PROMPT_COMMANDS)[number];

/**
 * Commands that run on the swarm board. A provider's own swarm runs where T3 cannot show it (in
 * Antigravity's app pane, say), so the fork's version runs on every provider and a provider
 * command with the same name is hidden.
 */
export const AGY_BOARD_COMMANDS: ReadonlyArray<AgyPromptCommand> = ["swarm", "boost", "teamwork"];

export const isAgyBoardCommandName = (name: string): boolean => {
  const first = name.trim().toLowerCase().split(/\s+/u)[0] ?? "";
  return AGY_BOARD_COMMANDS.some((command) => command === first);
};

export const AGY_UI_COMMANDS = [
  "swarm board",
  "diff",
  "rename",
  "fork",
  "rewind",
  "settings",
  "keybindings",
  "mcp",
  "skills",
  "usage",
  "context",
  "effort",
  "new",
  "resume",
  "copy",
  "help",
] as const;
export type AgyUiCommand = (typeof AGY_UI_COMMANDS)[number];

export interface AgyCommandInfo {
  readonly name: string;
  readonly argumentHint: string | null;
  readonly description: string;
  readonly kind: "prompt" | "ui";
}

export const AGY_COMMANDS: ReadonlyArray<AgyCommandInfo> = [
  {
    name: "plan",
    argumentHint: "[task]",
    kind: "prompt",
    description: "Explore, clarify, and draft a reviewable implementation plan before editing",
  },
  {
    name: "grill-me",
    argumentHint: "[task]",
    kind: "prompt",
    description: "Get interviewed one question at a time, with a recommended answer each",
  },
  {
    name: "boost",
    argumentHint: "<task>",
    kind: "prompt",
    description: "Multi-agent deep reasoning: solve, challenge, fix, and verify in rounds",
  },
  {
    name: "swarm",
    argumentHint: "<task>",
    kind: "prompt",
    description: "Named workers and a verifier coordinating on a shared message board",
  },
  {
    name: "teamwork",
    argumentHint: "<goal>",
    kind: "prompt",
    description: "Scoping interview, then a team with milestone review gates",
  },
  {
    name: "goal",
    argumentHint: "<objective>",
    kind: "prompt",
    description: "Work autonomously until the goal is verified complete",
  },
  {
    name: "learn",
    argumentHint: "[instruction]",
    kind: "prompt",
    description: "Turn this session's corrections into a rule or skill you approve",
  },
  {
    name: "browser",
    argumentHint: "<task>",
    kind: "prompt",
    description: "Hand browsing, UI checks, and screenshots to a browser subagent",
  },
  {
    name: "schedule",
    argumentHint: "<when> <task>",
    kind: "prompt",
    description: "Wake the agent later in this thread, once or on a schedule",
  },
  {
    name: "run-workflow",
    argumentHint: "<task>",
    kind: "prompt",
    description: "Write and run a workflow that orchestrates many agents",
  },
  {
    name: "swarm board",
    argumentHint: null,
    kind: "ui",
    description: "Open the live swarm board",
  },
  { name: "diff", argumentHint: null, kind: "ui", description: "Open the diff viewer" },
  { name: "rename", argumentHint: "<name>", kind: "ui", description: "Rename this thread" },
  { name: "fork", argumentHint: null, kind: "ui", description: "Fork this thread" },
  {
    name: "rewind",
    argumentHint: null,
    kind: "ui",
    description: "Roll the conversation back to an earlier message",
  },
  { name: "settings", argumentHint: null, kind: "ui", description: "Open settings" },
  { name: "keybindings", argumentHint: null, kind: "ui", description: "Edit keyboard shortcuts" },
  { name: "mcp", argumentHint: null, kind: "ui", description: "Manage MCP servers" },
  { name: "skills", argumentHint: null, kind: "ui", description: "Browse skills" },
  { name: "usage", argumentHint: null, kind: "ui", description: "Show model usage limits" },
  { name: "context", argumentHint: null, kind: "ui", description: "Show context window usage" },
  { name: "effort", argumentHint: null, kind: "ui", description: "Set reasoning effort" },
  { name: "new", argumentHint: null, kind: "ui", description: "Start a new thread" },
  { name: "resume", argumentHint: null, kind: "ui", description: "Find and reopen a thread" },
  { name: "copy", argumentHint: null, kind: "ui", description: "Copy the last response" },
  { name: "help", argumentHint: null, kind: "ui", description: "List the available commands" },
];

/**
 * Leading prompt commands of a message, in order: `/plan /grill-me task` gives
 * `["plan", "grill-me"]` and the task text. Returns null when the message starts with none.
 */
export function parseAgyPromptCommands(
  text: string,
  isAvailable: (command: AgyPromptCommand) => boolean = () => true,
): { readonly commands: ReadonlyArray<AgyPromptCommand>; readonly task: string } | null {
  const commands: AgyPromptCommand[] = [];
  let rest = text.trimStart();
  while (rest.startsWith("/")) {
    const match = /^\/([a-z][a-z-]*)(?=\s|$)/u.exec(rest);
    const name = match?.[1];
    if (name === undefined) break;
    const command = AGY_PROMPT_COMMANDS.find((candidate) => candidate === name);
    if (command === undefined || !isAvailable(command)) break;
    // `/swarm board` is a UI command, not a swarm task.
    if (command === "swarm" && /^\/swarm\s+board\s*$/u.test(rest)) break;
    if (!commands.includes(command)) commands.push(command);
    rest = rest.slice(name.length + 1).trimStart();
  }
  return commands.length === 0 ? null : { commands, task: rest.trim() };
}
