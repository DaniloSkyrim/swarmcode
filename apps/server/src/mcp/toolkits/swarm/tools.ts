// Fork: the swarm board tools. Registered outside layerTools so upstream's tool budget test
// measures only upstream tools.
import { AgySwarmKind, AgySwarmPlan, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as AgySwarm from "../../../agy/swarm/AgySwarm.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  AgySwarm.AgySwarm,
];

const SwarmTool = Tool.make("swarm", {
  description:
    "Run a swarm: named worker threads that coordinate on a shared message board the user watches live. " +
    "Always use this T3 Code MCP swarm tool (not a provider's native swarm tool). Keep coordinator turns short: delegate exploration and edits to workers. " +
    "Actions: status (members and states), models (models you can give workers), add (start workers: name, brief, " +
    'optional model, n + tasks for a numbered group, fork from a member\'s conversation, workspace:"worktree" for an own copy, channels), ' +
    "kill (stop a worker for good), model (switch a member's model), title (name the swarm), " +
    "plan (set/update the overview; goal is required on the first call, omitted fields keep their current values, provided fields replace theirs), " +
    "channel (op create|join|leave|archive|list). The thread that first calls it becomes the coordinator.",
  parameters: Schema.Struct({
    action: Schema.Literals([
      "status",
      "models",
      "add",
      "kill",
      "model",
      "title",
      "plan",
      "channel",
    ]),
    name: Schema.optional(Schema.String).annotate({
      description: "Worker name (add, kill, model), or the member to move (channel join/leave).",
    }),
    brief: Schema.optional(Schema.String).annotate({
      description:
        "add: concise first message for the worker (it has not seen this chat). State goal, owned files/scope, constraints, and done criteria; let the worker read files itself.",
    }),
    model: Schema.optional(Schema.String).annotate({
      description: 'add, model: "<instance>/<model>" or "<model>". Omit on add to use yours.',
    }),
    n: Schema.optional(Schema.Number).annotate({
      description: "add: start a numbered group name-1..name-n.",
    }),
    tasks: Schema.optional(
      Schema.Union([Schema.Array(Schema.String), Schema.Record(Schema.String, Schema.String)]),
    ).annotate({
      description:
        "add: one task per numbered worker, appended to the shared brief. plan: {<worker>: <piece in a few words>} (omit to keep current).",
    }),
    fork: Schema.optional(Schema.String).annotate({
      description: "add: start from this member's conversation instead of a blank one.",
    }),
    workspace: Schema.optional(Schema.Literals(["inherit", "worktree"])),
    channels: Schema.optional(Schema.Array(Schema.String)),
    title: Schema.optional(Schema.String),
    kind: Schema.optional(AgySwarmKind),
    goal: Schema.optional(AgySwarmPlan.fields.goal).annotate({
      description:
        "plan: {title, line} for the overview (required on first plan call; omit to keep current).",
    }),
    threads: Schema.optional(AgySwarmPlan.fields.threads).annotate({
      description:
        "plan: work groups [{id, title, goal, tasks:[worker...]}] (omit to keep current; pass [] to clear).",
    }),
    op: Schema.optional(Schema.Literals(["create", "join", "leave", "archive", "list"])),
    channel: Schema.optional(Schema.String),
    topic: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ result: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Swarm")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const PostMessageTool = Tool.make("post_message", {
  description:
    "Post on your swarm's board. @name, @group, @#channel and @all wake those members; a post naming nobody wakes nobody. " +
    "Refer to earlier posts as #<seq>.",
  parameters: Schema.Struct({
    text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000)),
    channel: Schema.optional(Schema.String).annotate({
      description: "Defaults to your own channel, else main.",
    }),
  }),
  success: Schema.Struct({ seq: Schema.Number, mentions: Schema.Array(Schema.String) }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Post on the swarm board")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const ReadBoardTool = Tool.make("read_board", {
  description:
    'Read your swarm\'s board after post #since (default: what you last read). channel:"*" reads every channel you can see.',
  parameters: Schema.Struct({
    since: Schema.optional(Schema.Number),
    channel: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Struct({ posts: Schema.String, head: Schema.Number }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read the swarm board")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const SwarmWaitTool = Tool.make("swarm_wait", {
  description:
    "Wait inside your turn for board posts after #since that mention you (mentions_only, the default) or any post you can see. " +
    "Returns at most 45 seconds later with timedOut. To wait longer, end your turn: a mention wakes you.",
  parameters: Schema.Struct({
    since: Schema.optional(Schema.Number),
    mentions_only: Schema.optional(Schema.Boolean),
    timeout: Schema.optional(Schema.Number).annotate({ description: "Seconds, at most 45." }),
  }),
  success: Schema.Struct({ posts: Schema.String, head: Schema.Number, timedOut: Schema.Boolean }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Wait for the swarm board")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const SwarmToolkit = Toolkit.make(SwarmTool, PostMessageTool, ReadBoardTool, SwarmWaitTool);
