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

const SwarmWorkerSpec = Schema.Struct({
  name: Schema.String,
  brief: Schema.String,
  model: Schema.optional(Schema.String),
  reasoningEffort: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.Literals(["inherit", "worktree"])),
  channels: Schema.optional(Schema.Array(Schema.String)),
  fork: Schema.optional(Schema.String),
  owns: Schema.optional(Schema.Array(Schema.String)),
  readOnly: Schema.optional(Schema.Boolean),
  manager: Schema.optional(Schema.Boolean),
});

const SwarmPlanTaskEntry = Schema.Struct({
  worker: Schema.String,
  summary: Schema.String,
});

const SwarmTool = Tool.make("t3_swarm", {
  description:
    "Run a T3 Code swarm of named worker threads on a shared board (always use this tool, never a provider's native swarm tool). " +
    "Keep coordinator turns short: delegate exploration and edits to workers. First caller becomes coordinator. " +
    "Actions: status, models (all:true for legacy), add (name+brief, pool via n/workerTasks, or batch via workers), " +
    "kill (force:true for dirty worktree), model (omit name for self; resume:true wakes idle), title (optional kind), " +
    "plan (goal required first; omitted fields kept), channel (op: create|join|leave|archive|list).",
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
      description:
        "Worker name (add/kill/model; omit on model for self) or channel join/leave member.",
    }),
    brief: Schema.optional(Schema.String).annotate({
      description: "add: worker's first prompt (goal, owned scope, constraints, done criteria).",
    }),
    model: Schema.optional(Schema.String).annotate({
      description: 'add/model: "<instance>/<model>" or "<model>"; omit on add to inherit.',
    }),
    reasoningEffort: Schema.optional(Schema.String).annotate({
      description: 'add/model: reasoning effort (e.g. "low", "medium", "high").',
    }),
    n: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16 }))).annotate({
      description: "add: numbered pool size (name-1..name-n).",
    }),
    workerTasks: Schema.optional(Schema.Array(Schema.String)).annotate({
      description: "add: per-worker task slices for a numbered pool.",
    }),
    workers: Schema.optional(Schema.Array(SwarmWorkerSpec)).annotate({
      description: "add: launch multiple distinct workers in parallel.",
    }),
    fork: Schema.optional(Schema.String).annotate({
      description: "add: member name to fork conversation from.",
    }),
    workspace: Schema.optional(Schema.Literals(["inherit", "worktree"])),
    channels: Schema.optional(Schema.Array(Schema.String)),
    owns: Schema.optional(Schema.Array(Schema.String)).annotate({
      description: "add: owned paths (warns on shared-workspace overlap).",
    }),
    readOnly: Schema.optional(Schema.Boolean).annotate({
      description: "add: read-only worker (explorers, critics, auditors).",
    }),
    manager: Schema.optional(Schema.Boolean).annotate({
      description: "add: delegated swarm manager privileges.",
    }),
    force: Schema.optional(Schema.Boolean).annotate({
      description: "kill: discard uncommitted worktree changes.",
    }),
    resume: Schema.optional(Schema.Boolean).annotate({
      description: "model: nudge idle worker after switching.",
    }),
    all: Schema.optional(Schema.Boolean).annotate({
      description: "models: include legacy models.",
    }),
    title: Schema.optional(Schema.String),
    kind: Schema.optional(AgySwarmKind),
    goal: Schema.optional(AgySwarmPlan.fields.goal).annotate({
      description: "plan: {title, line} overview goal (required on first plan call).",
    }),
    planTasks: Schema.optional(Schema.Array(SwarmPlanTaskEntry)).annotate({
      description: "plan: [{worker, summary}] worker pieces.",
    }),
    threads: Schema.optional(AgySwarmPlan.fields.threads).annotate({
      description: "plan: work groups ([] clears).",
    }),
    mode: Schema.optional(AgySwarmPlan.fields.mode),
    integrityMode: Schema.optional(AgySwarmPlan.fields.integrityMode),
    projectDir: Schema.optional(AgySwarmPlan.fields.projectDir),
    artifacts: Schema.optional(AgySwarmPlan.fields.artifacts),
    milestones: Schema.optional(AgySwarmPlan.fields.milestones),
    rounds: Schema.optional(AgySwarmPlan.fields.rounds),
    finalAudit: Schema.optional(AgySwarmPlan.fields.finalAudit),
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
      description: "Defaults to your own channel (coordinator defaults to main).",
    }),
  }),
  success: Schema.Struct({
    seq: Schema.Int,
    mentions: Schema.Array(Schema.String),
    note: Schema.optional(Schema.String),
  }),
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
    'Read your swarm\'s board after post #since (default: what you last read), or fetch cited `#seq` posts directly via `seqs`. channel:"*" reads every channel you can see.',
  parameters: Schema.Struct({
    since: Schema.optional(Schema.Int),
    channel: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 300 }))),
    seqs: Schema.optional(
      Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))).check(
        Schema.isMaxLength(50),
      ),
    ),
    includeBriefs: Schema.optional(Schema.Boolean),
    includeSystem: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({ posts: Schema.String, head: Schema.Int }),
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
    "Short in-turn wait (<=45s) for board posts after #since that mention you (mentions_only, the default) or any post you can see. " +
    "Returns with timedOut if nothing arrives. Do NOT call in a loop after timedOut: true; end your turn instead to sleep for free and wake automatically on mention.",
  parameters: Schema.Struct({
    since: Schema.optional(Schema.Int),
    mentions_only: Schema.optional(Schema.Boolean),
    timeout: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 45 })),
    ).annotate({ description: "Seconds, at most 45." }),
  }),
  success: Schema.Struct({ posts: Schema.String, head: Schema.Int, timedOut: Schema.Boolean }),
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
