// Fork: the swarm runtime. Members are ordinary T3 threads; the board, membership, and
// wakeups live here and persist as JSON next to the state database, so upstream migrations
// never see them.
import {
  type AgyActiveSwarm,
  type AgyActiveSwarmsSnapshot,
  type AgySwarmKind,
  type AgySwarmMemberState,
  type AgySwarmPlan,
  type AgySwarmPost,
  type AgySwarmSnapshot,
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  type SelectProviderOptionDescriptor,
  type ServerProviderModel,
  ThreadId,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import { modelSelectionCommandType } from "@t3tools/shared/model";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import { forkParked } from "../../serverActivation.ts";
import { SWARM_WORKER_PREAMBLE } from "../agyPrompts.ts";
import * as Board from "./swarmBoard.ts";

export class AgySwarmError extends Schema.TaggedError<AgySwarmError>()("AgySwarmError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

const refuse = (reason: string) => Effect.fail(new AgySwarmError({ reason }));

export interface AddWorkerSpec {
  readonly name: string;
  readonly brief: string;
  readonly model?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  readonly fork?: string | undefined;
  readonly workspace?: "inherit" | "worktree" | undefined;
  readonly channels?: ReadonlyArray<string> | undefined;
  readonly owns?: ReadonlyArray<string> | undefined;
  readonly readOnly?: boolean | undefined;
  readonly manager?: boolean | undefined;
}

export type AddInput =
  | {
      readonly name: string;
      readonly brief: string;
      readonly model?: string | undefined;
      readonly reasoningEffort?: string | undefined;
      readonly n?: number | undefined;
      readonly tasks?: ReadonlyArray<string> | undefined;
      readonly fork?: string | undefined;
      readonly workspace?: "inherit" | "worktree" | undefined;
      readonly channels?: ReadonlyArray<string> | undefined;
      readonly owns?: ReadonlyArray<string> | undefined;
      readonly readOnly?: boolean | undefined;
      readonly manager?: boolean | undefined;
      readonly workers?: undefined;
    }
  | {
      readonly workers: ReadonlyArray<AddWorkerSpec>;
    };

export interface SetModelInput {
  readonly name?: string | undefined;
  readonly model: string;
  readonly reasoningEffort?: string | undefined;
  readonly resume?: boolean | undefined;
}

export interface ChannelInput {
  readonly op: "create" | "join" | "leave" | "archive" | "list";
  readonly channel?: string | undefined;
  readonly topic?: string | undefined;
  readonly name?: string | undefined;
}

export interface PlanUpdateInput {
  readonly goal?: AgySwarmPlan["goal"] | undefined;
  readonly tasks?: AgySwarmPlan["tasks"] | undefined;
  readonly threads?: AgySwarmPlan["threads"] | undefined;
  readonly mode?: AgySwarmPlan["mode"] | undefined;
  readonly integrityMode?: AgySwarmPlan["integrityMode"] | undefined;
  readonly projectDir?: AgySwarmPlan["projectDir"] | undefined;
  readonly artifacts?: AgySwarmPlan["artifacts"] | undefined;
  readonly milestones?: AgySwarmPlan["milestones"] | undefined;
  readonly rounds?: AgySwarmPlan["rounds"] | undefined;
  readonly finalAudit?: AgySwarmPlan["finalAudit"] | undefined;
}

export interface AgySwarmShape {
  readonly status: (callerThreadId: ThreadId) => Effect.Effect<string, AgySwarmError>;
  readonly models: (
    callerThreadId: ThreadId,
    input?: { readonly all?: boolean | undefined },
  ) => Effect.Effect<string, AgySwarmError>;
  readonly add: (callerThreadId: ThreadId, input: AddInput) => Effect.Effect<string, AgySwarmError>;
  readonly kill: (
    callerThreadId: ThreadId,
    name: string,
    input?: { readonly force?: boolean | undefined },
  ) => Effect.Effect<string, AgySwarmError>;
  readonly setModel: (
    callerThreadId: ThreadId,
    input: SetModelInput,
  ) => Effect.Effect<string, AgySwarmError>;
  readonly setTitle: (
    callerThreadId: ThreadId,
    title: string,
    kind: AgySwarmKind | undefined,
  ) => Effect.Effect<string, AgySwarmError>;
  readonly setPlan: (
    callerThreadId: ThreadId,
    plan: PlanUpdateInput,
  ) => Effect.Effect<string, AgySwarmError>;
  readonly channel: (
    callerThreadId: ThreadId,
    input: ChannelInput,
  ) => Effect.Effect<string, AgySwarmError>;
  readonly post: (
    callerThreadId: ThreadId,
    input: { readonly text: string; readonly channel?: string | undefined },
  ) => Effect.Effect<
    {
      readonly seq: number;
      readonly mentions: ReadonlyArray<string>;
      readonly note?: string | undefined;
    },
    AgySwarmError
  >;
  readonly read: (
    callerThreadId: ThreadId,
    input: {
      readonly since?: number | undefined;
      readonly channel?: string | undefined;
      readonly limit?: number | undefined;
    },
  ) => Effect.Effect<{ readonly posts: string; readonly head: number }, AgySwarmError>;
  readonly wait: (
    callerThreadId: ThreadId,
    input: {
      readonly since?: number | undefined;
      readonly mentionsOnly?: boolean | undefined;
      readonly timeoutSeconds?: number | undefined;
    },
  ) => Effect.Effect<
    { readonly posts: string; readonly head: number; readonly timedOut: boolean },
    AgySwarmError
  >;
  readonly userPost: (
    threadId: ThreadId,
    input: { readonly text: string; readonly channel?: string | undefined },
  ) => Effect.Effect<
    {
      readonly seq: number;
      readonly mentions: ReadonlyArray<string>;
      readonly note?: string | undefined;
    },
    AgySwarmError
  >;
  readonly userKill: (
    threadId: ThreadId,
    input: { readonly name: string; readonly force?: boolean | undefined },
  ) => Effect.Effect<string, AgySwarmError>;
  readonly userRetry: (
    threadId: ThreadId,
    input: { readonly name: string; readonly message?: string | undefined },
  ) => Effect.Effect<string, AgySwarmError>;
  readonly userAdd: (
    threadId: ThreadId,
    input: AddWorkerSpec,
  ) => Effect.Effect<string, AgySwarmError>;
  readonly loadPosts: (
    threadId: ThreadId,
    input: { readonly beforeSeq: number; readonly limit?: number | undefined },
  ) => Effect.Effect<
    { readonly posts: ReadonlyArray<AgySwarmPost>; readonly hasMore: boolean },
    AgySwarmError
  >;
  readonly snapshot: (threadId: ThreadId) => Effect.Effect<AgySwarmSnapshot | null>;
  readonly changes: (threadId: ThreadId) => Stream.Stream<AgySwarmSnapshot | null>;
  readonly activeSnapshot: Effect.Effect<AgyActiveSwarmsSnapshot>;
  readonly activeChanges: Stream.Stream<AgyActiveSwarmsSnapshot>;
}

export class AgySwarm extends Context.Service<AgySwarm, AgySwarmShape>()("t3/agy/swarm/AgySwarm") {}

// Keyed by stateDir so ProviderTurnStartService can read coordinator state without a layer cycle.
const activeCoordinatorsByStateDir = new Map<string, Map<string, AgySwarmKind>>();
const pendingSwarmKindByStateDir = new Map<string, Map<string, AgySwarmKind>>();
const MAX_PENDING_KIND_ENTRIES = 512;

/** Whether `threadId` currently coordinates an open swarm with at least one live worker. */
export const isActiveSwarmCoordinator = (stateDir: string, threadId: ThreadId): boolean =>
  activeCoordinatorsByStateDir.get(stateDir)?.has(threadId) === true;

/** Kind of the active swarm coordinated by `threadId`, if any. */
export const activeSwarmKind = (stateDir: string, threadId: ThreadId): AgySwarmKind | undefined =>
  activeCoordinatorsByStateDir.get(stateDir)?.get(threadId);

/** Remembers `/boost` or `/teamwork` on a thread so `ensureSwarm` sets the right kind even before `title`. */
export const rememberPendingSwarmKind = (
  stateDir: string,
  threadId: ThreadId,
  kind: AgySwarmKind,
): void => {
  let byThread = pendingSwarmKindByStateDir.get(stateDir);
  if (byThread === undefined) {
    byThread = new Map<string, AgySwarmKind>();
    pendingSwarmKindByStateDir.set(stateDir, byThread);
  }
  byThread.set(threadId, kind);
  if (byThread.size > MAX_PENDING_KIND_ENTRIES) {
    const oldest = byThread.keys().next().value;
    if (oldest !== undefined) byThread.delete(oldest);
  }
};

const consumePendingSwarmKind = (stateDir: string, threadId: ThreadId): AgySwarmKind => {
  const byThread = pendingSwarmKindByStateDir.get(stateDir);
  const kind = byThread?.get(threadId);
  if (kind !== undefined) byThread?.delete(threadId);
  return kind ?? "swarm";
};

const MAX_WAIT_SECONDS = 45;
const MONITOR_INTERVAL = Duration.seconds(60);
const STALL_QUIET_MS = 3 * 60_000;
const STALL_REPEAT_MS = 10 * 60_000;
const MONITOR_MAX_AGE_MS = 24 * 60 * 60_000;
const SNAPSHOT_POST_LIMIT = 400;
const STATE_EVENT_PREFIXES = [
  "run.",
  "run-attempt.",
  "runtime-request.",
  "thread.archive",
  "thread.unarchive",
  "thread.model-selection-updated",
  "thread.provider-switched",
];

/** Everything a snapshot shows, cheaply, so an unchanged swarm is never sent twice. */
const fingerprint = (snapshot: AgySwarmSnapshot | null) =>
  snapshot === null
    ? "null"
    : [
        snapshot.head,
        snapshot.title,
        snapshot.kind,
        snapshot.doneAt,
        snapshot.channels
          .map((channel) => `${channel.name}:${channel.archived}:${channel.topic}`)
          .join(","),
        snapshot.plan === null ? "" : JSON.stringify(snapshot.plan),
        snapshot.metrics ? `${snapshot.metrics.turns}:${snapshot.metrics.totalTokens}` : "",
        snapshot.members
          .map((member) =>
            [
              member.name,
              member.state,
              member.activity,
              member.model,
              member.worktreePath ?? "",
              member.branch ?? "",
              (member.owns ?? []).join(";"),
              member.canManage ? "1" : "0",
              member.readOnly ? "1" : "0",
              member.scratchDir ?? "",
              member.killedAt,
              member.lastReadSeq,
              member.channels.join("+"),
              member.metrics ? `${member.metrics.turns}:${member.metrics.totalTokens}` : "",
            ].join("|"),
          )
          .join(","),
      ].join("\n");
const BUSY_STATUSES: ReadonlyArray<string> = [
  ...ThreadManagementService.ACTIVE_RUN_STATUSES,
  "queued",
];
const STOPPED_STATUSES: ReadonlyArray<string> = ["failed", "interrupted", "cancelled"];
const MAX_ADD_BATCH = 16;
const SPAWN_CONCURRENCY = 4;
const WAKE_MAX_POSTS = 20;
const WAKE_MAX_CHARS = 6_000;
const MAX_ALERTED_FAILED_RUNS = 500;
const MAX_RECORDED_METRIC_KEYS = 2_000;
const LOAD_POSTS_DEFAULT_LIMIT = 100;
const LOAD_POSTS_MAX_LIMIT = 400;

function packWakePosts(allUnread: ReadonlyArray<Board.StoredPost>): {
  readonly shown: ReadonlyArray<Board.StoredPost>;
  readonly caughtUp: boolean;
} {
  if (allUnread.length === 0) return { shown: [], caughtUp: true };
  if (allUnread.length <= WAKE_MAX_POSTS) {
    let totalChars = 0;
    for (const post of allUnread) totalChars += Board.formatPost(post).length + 2;
    if (totalChars <= WAKE_MAX_CHARS) return { shown: allUnread, caughtUp: true };
  }
  const picked: Board.StoredPost[] = [];
  let chars = 0;
  for (let index = allUnread.length - 1; index >= 0 && picked.length < WAKE_MAX_POSTS; index--) {
    const post = allUnread[index]!;
    const len = Board.formatPost(post).length + 2;
    if (picked.length > 0 && chars + len > WAKE_MAX_CHARS) break;
    picked.push(post);
    chars += len;
  }
  picked.reverse();
  return { shown: picked, caughtUp: picked.length === allUnread.length };
}

const REASONING_OPTION_IDS = new Set([
  "reasoningEffort",
  "effort",
  "thought_level",
  "thinkingLevel",
]);

function findReasoningDescriptor(
  model: ServerProviderModel,
): SelectProviderOptionDescriptor | undefined {
  return model.capabilities?.optionDescriptors?.find(
    (descriptor): descriptor is SelectProviderOptionDescriptor =>
      descriptor.type === "select" &&
      (descriptor.role === "reasoning" || REASONING_OPTION_IDS.has(descriptor.id)),
  );
}

const modelLabel = (selection: ModelSelection) => `${selection.instanceId}/${selection.model}`;

function modelWithEffortLabel(selection: ModelSelection): string {
  const base = modelLabel(selection);
  const effort = selection.options?.find(
    (option) => typeof option.value === "string" && REASONING_OPTION_IDS.has(option.id),
  );
  return effort === undefined ? base : `${base} (${String(effort.value)})`;
}
/**
 * A member's message travels like `t3_thread_send`: the client folds it under the sender's name
 * and the model is told it is not from the user. A post with no member behind it is T3's own.
 */
const agentSent = (fromMember: boolean) =>
  ({ createdBy: "agent", creationSource: fromMember ? "mcp" : "server" }) as const;

/** The thread's own selection wins, since the user can switch a member's model from the board. */
const liveModel = (
  member: { readonly model: string | null },
  shell: { readonly modelSelection: ModelSelection } | null,
) => (shell === null ? member.model : modelLabel(shell.modelSelection));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const projects = yield* ProjectService.ProjectService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const dir = path.join(config.stateDir, "agy", "swarms");
  const swarms = new Map<string, Board.StoredSwarm>();
  const byThread = new Map<string, string>();
  const activeCoordinators = new Map<string, AgySwarmKind>();
  activeCoordinatorsByStateDir.set(config.stateDir, activeCoordinators);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (activeCoordinatorsByStateDir.get(config.stateDir) === activeCoordinators) {
        activeCoordinatorsByStateDir.delete(config.stateDir);
      }
      pendingSwarmKindByStateDir.delete(config.stateDir);
    }),
  );
  const syncActiveCoordinator = (swarm: Board.StoredSwarm) => {
    const active =
      swarm.doneAt === null &&
      swarm.members.some((member) => member.role !== "coordinator" && Board.isLive(member));
    if (active) activeCoordinators.set(swarm.coordinatorThreadId, swarm.kind);
    else activeCoordinators.delete(swarm.coordinatorThreadId);
  };
  /** Threads parked in `swarm_wait`: a post reaches them there, not as a queued message. */
  const parked = new Map<string, number>();
  /** The highest post each thread was last rung for. */
  const rungSeq = new Map<string, number>();
  const changed = yield* PubSub.unbounded<string>();
  const createLock = yield* Semaphore.make(1);
  const swarmLocks = new Map<string, Semaphore.Semaphore>();
  const spawningNames = new Map<string, Set<string>>();
  const alertedFailedRuns = new Set<string>();
  const recordedRuns = new Set<string>();
  const recordedTurnUsage = new Map<
    string,
    {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedInputTokens: number;
      readonly reasoningTokens: number;
      readonly totalTokens: number;
    }
  >();

  const lockForSwarm = (swarmId: string) =>
    Effect.suspend(() => {
      const existing = swarmLocks.get(swarmId);
      if (existing !== undefined) return Effect.succeed(existing);
      return Semaphore.make(1).pipe(
        Effect.map((created) => {
          const raced = swarmLocks.get(swarmId);
          if (raced !== undefined) return raced;
          swarmLocks.set(swarmId, created);
          return created;
        }),
      );
    });

  const withSwarmLock = <A, E, R>(swarmId: string, effect: Effect.Effect<A, E, R>) =>
    lockForSwarm(swarmId).pipe(Effect.flatMap((sem) => sem.withPermits(1)(effect)));

  yield* fileSystem.makeDirectory(dir, { recursive: true }).pipe(Effect.ignore);
  const files = yield* fileSystem.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    // A file cut short by a crash loses that one swarm, never the others.
    const loaded = yield* fileSystem
      .readFileString(path.join(dir, file))
      .pipe(Effect.flatMap(decodeJson), Effect.option);
    if (loaded._tag === "None") continue;
    const swarm = loaded.value as Board.StoredSwarm;
    if (swarm.version !== 1) continue;
    swarms.set(swarm.id, swarm);
    for (const member of swarm.members) byThread.set(member.threadId, swarm.id);
    syncActiveCoordinator(swarm);
  }

  const save = (swarm: Board.StoredSwarm) => {
    syncActiveCoordinator(swarm);
    const file = path.join(dir, `${swarm.id}.json`);
    return encodeJson(swarm).pipe(
      Effect.flatMap((json) => fileSystem.writeFileString(`${file}.tmp`, json)),
      Effect.andThen(fileSystem.rename(`${file}.tmp`, file)),
      Effect.andThen(PubSub.publish(changed, swarm.id)),
      Effect.catchCause((cause) => Effect.logWarning("agy swarm save failed", { cause })),
    );
  };

  const appendOrRefuse = (
    swarm: Board.StoredSwarm,
    input: Parameters<typeof Board.appendPost>[1],
  ) => {
    const result = Board.appendPost(swarm, input);
    return "refused" in result ? refuse(result.refused) : Effect.succeed(result);
  };

  const callerOf = (threadId: ThreadId) => {
    const swarmId = byThread.get(threadId);
    const swarm = swarmId === undefined ? undefined : swarms.get(swarmId);
    const member = swarm === undefined ? undefined : Board.memberByThread(swarm, threadId);
    return swarm === undefined || member === undefined ? undefined : { swarm, member };
  };

  const requireMember = (threadId: ThreadId) => {
    const found = callerOf(threadId);
    if (found === undefined) {
      return refuse(
        'This thread is in no swarm. A coordinator starts one with t3_swarm{action:"title"} or t3_swarm{action:"add"}.',
      );
    }
    if (found.member.killedAt !== null) return refuse("You were removed from this swarm.");
    return Effect.succeed(found);
  };

  const shellOf = (threadId: string) =>
    threads.getThreadShell(ThreadId.make(threadId)).pipe(Effect.orElseSucceed(() => null));

  /** The caller's swarm, started with the caller as coordinator when it has none. */
  const ensureSwarm = Effect.fn("AgySwarm.ensureSwarm")(function* (threadId: ThreadId) {
    const found = callerOf(threadId);
    if (found !== undefined) return found;
    const shell = yield* shellOf(threadId);
    if (shell === null) return yield* refuse("The calling thread was not found.");
    const swarm = Board.newSwarm({
      id: yield* randomUuidV4,
      kind: consumePendingSwarmKind(config.stateDir, threadId),
      projectId: shell.projectId,
      coordinatorThreadId: threadId,
      instanceId: shell.modelSelection.instanceId,
      model: modelLabel(shell.modelSelection),
      now: yield* nowIso,
    });
    swarms.set(swarm.id, swarm);
    byThread.set(threadId, swarm.id);
    return { swarm, member: swarm.members[0]! };
  });

  const withExistingSwarmLock = <A, E, R>(
    threadId: ThreadId,
    use: (found: {
      readonly swarm: Board.StoredSwarm;
      readonly member: Board.StoredMember;
    }) => Effect.Effect<A, E | AgySwarmError, R>,
  ): Effect.Effect<A, E | AgySwarmError, R> =>
    Effect.suspend(() => {
      const swarmId = byThread.get(threadId);
      if (swarmId === undefined) return requireMember(threadId).pipe(Effect.flatMap(use));
      return withSwarmLock(swarmId, requireMember(threadId).pipe(Effect.flatMap(use)));
    });

  const withEnsuredSwarmLock = <A, E, R>(
    threadId: ThreadId,
    use: (found: {
      readonly swarm: Board.StoredSwarm;
      readonly member: Board.StoredMember;
    }) => Effect.Effect<A, E | AgySwarmError, R>,
  ): Effect.Effect<A, E | AgySwarmError, R> =>
    Effect.suspend(() => {
      const existingSwarmId = byThread.get(threadId);
      if (existingSwarmId !== undefined) {
        return withSwarmLock(existingSwarmId, ensureSwarm(threadId).pipe(Effect.flatMap(use)));
      }
      return createLock
        .withPermits(1)(ensureSwarm(threadId))
        .pipe(
          Effect.flatMap(({ swarm }) =>
            withSwarmLock(swarm.id, ensureSwarm(threadId).pipe(Effect.flatMap(use))),
          ),
        );
    });

  const liveState = (
    member: Board.StoredMember,
    shell: OrchestrationV2ThreadShell | null,
  ): { state: AgySwarmMemberState; activity: string | null } => {
    if (
      member.killedAt !== null ||
      shell === null ||
      shell.archivedAt !== null ||
      shell.deletedAt !== null
    ) {
      return { state: "killed", activity: null };
    }
    if (shell.pendingRuntimeRequest !== null)
      return { state: "needs-input", activity: "Needs input" };
    if (parked.has(member.threadId)) return { state: "waiting", activity: "swarm_wait" };
    if (shell.activeRunId !== null || BUSY_STATUSES.includes(shell.status)) {
      const latest = shell.latestVisibleMessage;
      return {
        state: "working",
        activity: latest !== null && latest.role === "assistant" ? latest.text.slice(0, 160) : null,
      };
    }
    if (STOPPED_STATUSES.includes(shell.status)) {
      return { state: "stopped", activity: shell.lastError ?? null };
    }
    return { state: "waiting", activity: null };
  };

  const memberStates = (swarm: Board.StoredSwarm) =>
    Effect.forEach(
      swarm.members,
      (member) =>
        (member.killedAt === null ? shellOf(member.threadId) : Effect.succeed(null)).pipe(
          Effect.map((shell) => ({ member, shell, ...liveState(member, shell) })),
        ),
      { concurrency: 8 },
    );

  const buildSnapshot = Effect.fn("AgySwarm.buildSnapshot")(function* (swarm: Board.StoredSwarm) {
    const states = yield* memberStates(swarm);
    const includedPosts = swarm.posts
      .slice(-SNAPSHOT_POST_LIMIT)
      .map((post) => ({ ...post, mentions: [...post.mentions] }));
    const swarmMetrics = Board.sumMetrics(swarm.members.map((member) => member.metrics));
    return {
      id: swarm.id,
      kind: swarm.kind,
      title: swarm.title,
      coordinatorThreadId: ThreadId.make(swarm.coordinatorThreadId),
      createdAt: swarm.createdAt,
      doneAt: swarm.doneAt,
      plan: swarm.plan,
      channels: swarm.channels.map((channel) => ({ ...channel })),
      members: states.map(({ member, shell, state, activity }) => ({
        name: member.name,
        threadId: ThreadId.make(member.threadId),
        role: member.role,
        addedBy: member.addedBy,
        instanceId: shell?.modelSelection.instanceId ?? member.instanceId,
        model: liveModel(member, shell),
        workspace: member.workspace,
        worktreePath: member.worktreePath ?? shell?.worktreePath ?? null,
        branch: member.branch ?? shell?.branch ?? null,
        owns: member.owns ? [...member.owns] : [],
        ...(member.canManage ? { canManage: true } : {}),
        ...(member.readOnly ? { readOnly: true } : {}),
        ...(member.scratchDir !== undefined ? { scratchDir: member.scratchDir } : {}),
        channels: [...member.channels],
        brief: member.brief,
        createdAt: member.createdAt,
        killedAt: member.killedAt,
        lastReadSeq: member.lastReadSeq,
        lastPostSeq: Board.lastPostSeq(swarm, member.name),
        state,
        activity,
        metrics: member.metrics ? { ...member.metrics } : Board.emptyMetrics(),
      })),
      posts: includedPosts,
      head: Board.head(swarm),
      totalPostCount: swarm.posts.length,
      oldestIncludedSeq: includedPosts[0]?.seq ?? 0,
      metrics: swarmMetrics,
    } satisfies AgySwarmSnapshot;
  });

  const projectRootOf = (projectId: string) =>
    projects.getById(ProjectId.make(projectId)).pipe(
      Effect.map((project) => Option.getOrUndefined(project)?.workspaceRoot ?? null),
      Effect.orElseSucceed(() => null),
    );

  const resolveModel = Effect.fn("AgySwarm.resolveModel")(function* (
    requested: string,
    fallback: ModelSelection,
    reasoningEffort?: string,
  ) {
    const all = yield* providers.getProviders;
    const slash = requested.indexOf("/");
    const instance = slash > 0 ? requested.slice(0, slash) : fallback.instanceId;
    const wanted = (slash > 0 ? requested.slice(slash + 1) : requested).trim().toLowerCase();
    const provider = all.find((candidate) => candidate.instanceId === instance);
    if (provider === undefined || !provider.enabled) {
      return yield* refuse(
        `Provider instance "${instance}" is not available. Call t3_swarm{action:"models"}.`,
      );
    }
    let model = provider.models.find(
      (candidate) =>
        candidate.slug.toLowerCase() === wanted ||
        candidate.name.toLowerCase() === wanted ||
        (candidate.aliases ?? []).some((alias) => alias.toLowerCase() === wanted),
    );
    let impliedEffort: { readonly id: string; readonly value: string } | undefined;
    // Accept Antigravity-style suffixed slugs like `gemini-3.8-flash-high`.
    if (model === undefined) {
      const dash = wanted.lastIndexOf("-");
      if (dash > 0) {
        const family = wanted.slice(0, dash);
        const suffix = wanted.slice(dash + 1);
        const familyModel = provider.models.find(
          (candidate) => candidate.slug.toLowerCase() === family,
        );
        const descriptor =
          familyModel === undefined ? undefined : findReasoningDescriptor(familyModel);
        const choice = descriptor?.options.find((option) => option.id.toLowerCase() === suffix);
        if (familyModel !== undefined && descriptor !== undefined && choice !== undefined) {
          model = familyModel;
          impliedEffort = { id: descriptor.id, value: choice.id };
        }
      }
    }
    if (model === undefined) {
      return yield* refuse(
        `"${requested}" is not a model of ${instance}. Call t3_swarm{action:"models"}.`,
      );
    }

    const inheritsFallbackOptions =
      instance === fallback.instanceId && model.slug.toLowerCase() === fallback.model.toLowerCase();
    let options = inheritsFallbackOptions ? fallback.options : undefined;

    const descriptor = findReasoningDescriptor(model);
    if (reasoningEffort !== undefined) {
      if (descriptor === undefined) {
        return yield* refuse(`Model "${instance}/${model.slug}" does not support reasoningEffort.`);
      }
      const wantedEffort = reasoningEffort.trim().toLowerCase();
      const matched = descriptor.options.find(
        (choice) =>
          choice.id.toLowerCase() === wantedEffort || choice.label.toLowerCase() === wantedEffort,
      );
      if (matched === undefined) {
        return yield* refuse(
          `Invalid reasoningEffort "${reasoningEffort}" for ${instance}/${model.slug}. Allowed: ${descriptor.options.map((choice) => choice.id).join(", ")}.`,
        );
      }
      const next = new Map((options ?? []).map((entry) => [entry.id, entry]));
      next.set(descriptor.id, { id: descriptor.id, value: matched.id });
      options = [...next.values()];
    } else if (impliedEffort !== undefined) {
      const next = new Map((options ?? []).map((entry) => [entry.id, entry]));
      next.set(impliedEffort.id, impliedEffort);
      options = [...next.values()];
    }

    return {
      instanceId: ProviderInstanceId.make(instance),
      model: model.slug,
      ...(options === undefined || options.length === 0 ? {} : { options }),
    } satisfies ModelSelection;
  });

  /**
   * Rings a member for its unread posts, as Antigravity's board does: once, and only while it is
   * idle. A member mid-turn is rung when that turn ends, so its thread never stacks queued wakes.
   * When all unread visible posts fit in the wake message, advances `lastReadSeq` immediately so
   * the member can act without a redundant `read_board` turn.
   */
  const ring = Effect.fn("AgySwarm.ring")(function* (
    swarm: Board.StoredSwarm,
    target: Board.StoredMember,
  ) {
    if (parked.has(target.threadId)) return;
    // A turn that failed (quota, say) is not rung again until the board moves.
    const wakePosts = Board.unreadWakePosts(swarm, target, rungSeq.get(target.threadId) ?? 0);
    if (wakePosts.length === 0) return;
    const shell = yield* shellOf(target.threadId);
    if (
      shell === null ||
      shell.archivedAt !== null ||
      shell.deletedAt !== null ||
      shell.activeRunId !== null ||
      BUSY_STATUSES.includes(shell.status)
    ) {
      return;
    }
    const allUnread = Board.unreadVisiblePosts(swarm, target);
    const toDeliver = allUnread.length > 0 ? allUnread : wakePosts;
    const { shown, caughtUp } = packWakePosts(toDeliver);
    const latest = shown.at(-1);
    if (latest === undefined) return;
    const previousRungSeq = rungSeq.get(target.threadId);
    const previousLastReadSeq = target.lastReadSeq;
    rungSeq.set(target.threadId, target.lastWakeSeq);
    if (caughtUp && latest.seq > target.lastReadSeq) {
      target.lastReadSeq = latest.seq;
    }
    const latestTrigger = wakePosts.at(-1) ?? latest;
    const sender = Board.memberByName(swarm, latestTrigger.from);
    const heading =
      toDeliver.length === 1
        ? `[swarm] New on the board for you, ${target.name}:`
        : `[swarm] ${toDeliver.length} new posts on the board for you, ${target.name}` +
          (toDeliver.length > shown.length ? ` (latest ${shown.length} below):` : ":");
    const coordinatorHint =
      target.role !== "coordinator"
        ? ""
        : swarm.kind === "boost"
          ? "\nOrchestrate via the T3 Code MCP swarm tools: in Phase 2, update plan.rounds and dispatch the next challenger; in Phase 3, spot-check the diff/citations and real test output yourself before updating finalAudit, posting [done] <summary>, and retiring finished workers."
          : swarm.kind === "teamwork"
            ? "\nAct as Sentinel via the T3 Code MCP swarm tools: keep this turn short, update the user at milestones, and launch a readOnly:true success-auditor once all milestones pass before posting [done] <summary>."
            : "\nCoordinate via the T3 Code MCP swarm tools (t3_swarm, post_message, read_board, swarm_wait): keep this turn short, do not enter plan mode or do worker tasks yourself; judge, dispatch or direct workers, and end your turn.";
    const catchUpLine = caughtUp
      ? `Caught up through #${latest.seq}; no need to call read_board before acting. Act on what is yours, or end your turn if nothing is.`
      : `Catch up on earlier unread posts with read_board{since:${target.lastReadSeq}} and act on what is yours. If nothing is, end your turn.`;
    const text = `${heading}\n${shown.map(Board.formatPost).join("\n\n")}\n\n${catchUpLine}${coordinatorHint}`;
    const delivered = yield* threads
      .sendToThread({
        projectId: ProjectId.make(swarm.projectId),
        commandId: CommandId.make(`agy-swarm:${swarm.id}:wake:${target.name}:${latest.seq}`),
        messageId: MessageId.make(`agy-swarm:${swarm.id}:wake:${target.name}:${latest.seq}`),
        threadId: ThreadId.make(target.threadId),
        ...(sender === undefined ? {} : { senderThreadId: ThreadId.make(sender.threadId) }),
        text,
        attachments: [],
        mode: "queue",
        ...agentSent(sender !== undefined),
      })
      .pipe(
        Effect.as(true),
        Effect.catchCause((cause) => {
          if (previousRungSeq === undefined) rungSeq.delete(target.threadId);
          else rungSeq.set(target.threadId, previousRungSeq);
          target.lastReadSeq = previousLastReadSeq;
          return Effect.logWarning("agy swarm wake failed", { member: target.name, cause }).pipe(
            Effect.as(false),
          );
        }),
      );
    if (delivered && target.lastReadSeq !== previousLastReadSeq) {
      yield* save(swarm);
    }
  });

  const saveAndDeliver = Effect.fn("AgySwarm.saveAndDeliver")(function* (
    swarm: Board.StoredSwarm,
    post: Board.StoredPost,
  ) {
    const targets = Board.wakeTargets(swarm, post);
    for (const target of targets) target.lastWakeSeq = post.seq;
    yield* save(swarm);
    for (const target of targets) yield* ring(swarm, target);
  });

  const appendAndDeliver = Effect.fn("AgySwarm.appendAndDeliver")(function* (
    swarm: Board.StoredSwarm,
    input: Parameters<typeof Board.appendPost>[1],
  ) {
    const post = yield* appendOrRefuse(swarm, input);
    yield* saveAndDeliver(swarm, post);
    return post;
  });

  const launchMember = Effect.fn("AgySwarm.launchMember")(function* (
    swarm: Board.StoredSwarm,
    adder: Board.StoredMember,
    adderShell: OrchestrationV2ThreadShell,
    coordinatorShell: OrchestrationV2ThreadShell | null,
    spec: {
      readonly name: string;
      readonly brief: string;
      readonly model: ModelSelection;
      readonly workspace: "inherit" | "worktree";
      readonly channels: ReadonlyArray<string>;
      readonly forkFrom: Board.StoredMember | undefined;
      readonly readOnly: boolean;
      readonly canManage: boolean;
    },
  ) {
    // Members live under the thread that added them, rooted at the swarm coordinator.
    const swarmLineage = {
      parentThreadId: ThreadId.make(adder.threadId),
      rootThreadId:
        coordinatorShell?.lineage.rootThreadId ?? ThreadId.make(swarm.coordinatorThreadId),
    };
    const threadId = ThreadId.make(yield* randomUuidV4);
    const commandId = CommandId.make(`agy-swarm:${swarm.id}:add:${spec.name}`);
    const title = `${swarm.title} · ${spec.name}`;
    const scratchPath = path.join(dir, swarm.id, "scratch", spec.name);
    const scratchDir = yield* fileSystem.makeDirectory(scratchPath, { recursive: true }).pipe(
      Effect.as(scratchPath),
      Effect.orElseSucceed(() => null),
    );
    const text = `${SWARM_WORKER_PREAMBLE({
      name: spec.name,
      swarmTitle: swarm.title,
      adder: adder.name,
      readOnly: spec.readOnly,
      canManage: spec.canManage,
      scratchDir,
    })}\n\n## Your brief\n${spec.brief}`;

    if (spec.forkFrom !== undefined) {
      yield* threads
        .dispatch({
          type: "thread.fork",
          commandId,
          sourceThreadId: ThreadId.make(spec.forkFrom.threadId),
          targetThreadId: threadId,
          sourcePoint: { type: "latest_stable" },
          title,
          swarmMember: true,
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(
          Effect.mapError(
            (error) => new AgySwarmError({ reason: `Fork failed: ${error.message}` }),
          ),
        );

      let forkWorktreePath: string | null = null;
      let forkBranch: string | null = null;
      if (spec.workspace === "worktree") {
        const projectRoot = yield* projectRootOf(adderShell.projectId);
        if (projectRoot === null) {
          return yield* refuse("Project workspace root was not found for fork worktree.");
        }
        const newRefName = `swarm/${spec.name}-${threadId.slice(0, 8)}`;
        const created = yield* gitWorkflow
          .createWorktree({
            cwd: projectRoot,
            refName: adderShell.branch ?? "HEAD",
            newRefName,
            path: null,
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new AgySwarmError({
                  reason: `Fork worktree failed: ${error.message}`,
                }),
            ),
          );
        forkWorktreePath = created.worktree.path;
        forkBranch = created.worktree.refName;
        yield* threads
          .dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make(`${commandId}:worktree`),
            threadId,
            branch: forkBranch,
            worktreePath: forkWorktreePath,
          })
          .pipe(
            Effect.tapError(() =>
              gitWorkflow
                .removeWorktree({ cwd: projectRoot, path: forkWorktreePath!, force: true })
                .pipe(
                  Effect.andThen(
                    gitWorkflow.deleteLocalBranch({
                      cwd: projectRoot,
                      refName: forkBranch!,
                      force: true,
                    }),
                  ),
                  Effect.ignore,
                ),
            ),
            Effect.mapError(
              (error) =>
                new AgySwarmError({
                  reason: `Fork worktree bind failed: ${error.message}`,
                }),
            ),
          );
      }

      yield* threads
        .sendToThread({
          projectId: adderShell.projectId,
          commandId: CommandId.make(`${commandId}:brief`),
          messageId: MessageId.make(`${commandId}:brief`),
          threadId,
          senderThreadId: ThreadId.make(adder.threadId),
          text,
          attachments: [],
          modelSelection: spec.model,
          mode: "queue",
          ...agentSent(true),
        })
        .pipe(
          Effect.mapError(
            (error) => new AgySwarmError({ reason: `Brief failed: ${error.message}` }),
          ),
        );
      const forkedShell = forkWorktreePath === null ? yield* shellOf(threadId) : null;
      return {
        threadId,
        worktreePath: forkWorktreePath ?? forkedShell?.worktreePath ?? null,
        branch: forkBranch ?? forkedShell?.branch ?? null,
        scratchDir,
      };
    }

    const workspaceStrategy: ThreadLaunchService.ThreadLaunchWorkspaceStrategy =
      spec.workspace === "worktree"
        ? { type: "worktree", baseRef: adderShell.branch ?? "HEAD", startFromOrigin: false }
        : adderShell.worktreePath !== null
          ? {
              type: "existing_worktree",
              worktreePath: adderShell.worktreePath,
              ...(adderShell.branch === null ? {} : { branch: adderShell.branch }),
            }
          : { type: "root" };
    const launched = yield* launches
      .launch({
        commandId,
        threadId,
        projectId: adderShell.projectId,
        title,
        titleRenamed: true,
        swarmLineage,
        modelSelection: spec.model,
        runtimeMode: adderShell.runtimeMode,
        interactionMode: "default",
        workspaceStrategy,
        initialMessage: {
          messageId: MessageId.make(`${commandId}:brief`),
          senderThreadId: ThreadId.make(adder.threadId),
          text,
          attachments: [],
        },
        ...agentSent(true),
      })
      .pipe(
        Effect.mapError(
          (error) => new AgySwarmError({ reason: `Launch failed: ${error.message}` }),
        ),
      );
    const launchedThread = launched?.projection?.thread ?? (yield* shellOf(threadId));
    return {
      threadId,
      worktreePath: launchedThread?.worktreePath ?? null,
      branch: launchedThread?.branch ?? null,
      scratchDir,
    };
  });

  const status: AgySwarmShape["status"] = Effect.fn("AgySwarm.status")(function* (callerThreadId) {
    const { swarm } = yield* requireMember(callerThreadId);
    const states = yield* memberStates(swarm);
    const lines = states.map(({ member, shell, state, activity }) => {
      const last = Board.lastPostSeq(swarm, member.name);
      const model = liveModel(member, shell);
      const branch = member.branch ?? shell?.branch ?? null;
      const workspaceTag =
        member.workspace === "worktree"
          ? branch === null
            ? ", own worktree"
            : `, worktree:${branch}`
          : "";
      const roleTags = [
        member.role,
        ...(member.canManage ? ["manager"] : []),
        ...(member.readOnly ? ["read-only"] : []),
      ].join(", ");
      const ownsTag =
        member.owns && member.owns.length > 0 ? `; owns: ${member.owns.join(", ")}` : "";
      return `- ${member.name} (${roleTags}${model === null ? "" : `, ${model}`}${workspaceTag}): ${state}; last post ${last === null ? "none" : `#${last}`}; read up to #${member.lastReadSeq}${ownsTag}${activity === null ? "" : `; ${activity.replace(/\s+/gu, " ").slice(0, 100)}`}`;
    });
    const planNotes: string[] = [];
    if (swarm.plan?.mode) planNotes.push(`mode=${swarm.plan.mode}`);
    if (swarm.plan?.integrityMode) planNotes.push(`integrity=${swarm.plan.integrityMode}`);
    if (swarm.plan?.milestones && swarm.plan.milestones.length > 0) {
      const passed = swarm.plan.milestones.filter((m) => m.status === "passed").length;
      planNotes.push(`milestones=${passed}/${swarm.plan.milestones.length}`);
    }
    if (swarm.plan?.rounds && swarm.plan.rounds.length > 0) {
      planNotes.push(`rounds=${swarm.plan.rounds.length}`);
    }
    const kindLabel = swarm.kind === "swarm" ? "" : ` (${swarm.kind})`;
    const planLine = planNotes.length > 0 ? `\nPlan: ${planNotes.join(", ")}` : "";
    return `Swarm "${swarm.title}"${kindLabel}, board head #${Board.head(swarm)}${swarm.doneAt === null ? "" : ", done"}.${planLine}\n${lines.join("\n")}`;
  });

  const models: AgySwarmShape["models"] = Effect.fn("AgySwarm.models")(
    function* (callerThreadId, input) {
      const shell = yield* shellOf(callerThreadId);
      const all = yield* providers.getProviders;
      const includeAll = input?.all === true;
      const lines = all
        .filter((provider) => provider.enabled && provider.installed)
        .map((provider) => {
          const listed = provider.models
            .filter((model) => includeAll || model.isLegacy !== true)
            .map((model) => {
              const reasoning = findReasoningDescriptor(model);
              return reasoning === undefined
                ? model.slug
                : `${model.slug} [effort: ${reasoning.options.map((choice) => choice.id).join("|")}]`;
            });
          return `${provider.instanceId}: ${listed.join(", ")}`;
        });
      return (
        `Pass model as "<instance>/<model>", or just "<model>" for your own provider${shell === null ? "" : ` (${modelLabel(shell.modelSelection)})`}, with optional reasoningEffort.\n` +
        "Tip: use fast/light models for exploration or simple checks, and stronger models or higher effort for design, complex edits, and final reviews.\n" +
        lines.join("\n")
      );
    },
  );

  const add: AgySwarmShape["add"] = Effect.fn("AgySwarm.add")(function* (callerThreadId, input) {
    const rawSpecs: Array<AddWorkerSpec> = [];
    if ("workers" in input && input.workers !== undefined) {
      if (input.workers.length < 1 || input.workers.length > MAX_ADD_BATCH) {
        return yield* refuse(`workers must contain between 1 and ${MAX_ADD_BATCH} entries.`);
      }
      rawSpecs.push(...input.workers);
    } else {
      const count = input.n ?? 1;
      if (count < 1 || count > MAX_ADD_BATCH) {
        return yield* refuse(`n must be between 1 and ${MAX_ADD_BATCH}.`);
      }
      const names =
        count === 1 && input.tasks === undefined
          ? [input.name]
          : Array.from({ length: count }, (_, index) => `${input.name}-${index + 1}`);
      if (input.tasks !== undefined && input.tasks.length !== names.length) {
        return yield* refuse(
          `tasks has ${input.tasks.length} entries for ${names.length} workers.`,
        );
      }
      for (const [index, name] of names.entries()) {
        const task = input.tasks?.[index];
        rawSpecs.push({
          name,
          brief: task === undefined ? input.brief : `${input.brief}\n\nYour part: ${task}`,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          fork: input.fork,
          workspace: input.workspace,
          channels: input.channels,
          owns: input.owns,
          readOnly: input.readOnly,
          manager: input.manager,
        });
      }
    }

    // Phase 1: validate and reserve worker names under the swarm lock, then release the lock
    // before performing parallel thread/worktree launches so board I/O stays responsive.
    const prepared = yield* withEnsuredSwarmLock(callerThreadId, ({ swarm, member: adder }) =>
      Effect.gen(function* () {
        if (adder.killedAt !== null) return yield* refuse("You were removed from this swarm.");
        const adderShell = yield* shellOf(adder.threadId);
        if (adderShell === null) return yield* refuse("Your thread was not found.");
        const coordinatorShell =
          swarm.coordinatorThreadId === adder.threadId
            ? adderShell
            : yield* shellOf(swarm.coordinatorThreadId);

        let reserved = spawningNames.get(swarm.id);
        if (reserved === undefined) {
          reserved = new Set<string>();
          spawningNames.set(swarm.id, reserved);
        }
        const batchSeen = new Set<string>();
        const specs: Array<{
          readonly name: string;
          readonly brief: string;
          readonly model: ModelSelection;
          readonly workspace: "inherit" | "worktree";
          readonly channels: ReadonlyArray<string>;
          readonly owns: ReadonlyArray<string>;
          readonly forkFrom: Board.StoredMember | undefined;
          readonly readOnly: boolean;
          readonly canManage: boolean;
        }> = [];

        for (const raw of rawSpecs) {
          const problem = Board.validateNewName(swarm, raw.name);
          if (problem !== null) return yield* refuse(problem);
          if (batchSeen.has(raw.name)) {
            return yield* refuse(`Duplicate worker name "${raw.name}" in the same add request.`);
          }
          if (reserved.has(raw.name)) {
            return yield* refuse(`"${raw.name}" is already being added.`);
          }
          if (raw.manager === true && !Board.canManageSwarm(adder)) {
            return yield* refuse(
              "Only the coordinator or a delegated manager can grant manager privileges.",
            );
          }
          const workspace = raw.workspace ?? "inherit";
          if (raw.readOnly === true && workspace === "worktree") {
            return yield* refuse(
              `Read-only worker "${raw.name}" does not need its own worktree; omit workspace or use "inherit".`,
            );
          }
          batchSeen.add(raw.name);

          const channels = [...new Set([Board.MAIN_CHANNEL, ...(raw.channels ?? [])])];
          for (const channel of channels) {
            if (
              !swarm.channels.some((candidate) => candidate.name === channel && !candidate.archived)
            ) {
              return yield* refuse(
                `Channel #${channel} does not exist. Create it with t3_swarm{action:"channel", op:"create"}.`,
              );
            }
          }
          const forkFrom = raw.fork === undefined ? undefined : Board.memberByName(swarm, raw.fork);
          if (raw.fork !== undefined && (forkFrom === undefined || forkFrom.killedAt !== null)) {
            return yield* refuse(`fork names no live member "${raw.fork}".`);
          }
          const model =
            raw.model === undefined && raw.reasoningEffort === undefined
              ? adderShell.modelSelection
              : yield* resolveModel(
                  raw.model ?? adderShell.modelSelection.model,
                  adderShell.modelSelection,
                  raw.reasoningEffort,
                );
          const owns = (raw.owns ?? [])
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);

          specs.push({
            name: raw.name,
            brief: raw.brief,
            model,
            workspace,
            channels,
            owns,
            forkFrom,
            readOnly: raw.readOnly === true,
            canManage: raw.manager === true,
          });
        }

        for (const spec of specs) reserved.add(spec.name);
        return { swarm, adder, adderShell, coordinatorShell, specs };
      }),
    );

    const releaseReserved = Effect.sync(() => {
      const reserved = spawningNames.get(prepared.swarm.id);
      if (reserved === undefined) return;
      for (const spec of prepared.specs) reserved.delete(spec.name);
      if (reserved.size === 0) spawningNames.delete(prepared.swarm.id);
    });

    // Phase 2: launch all workers concurrently outside the swarm lock.
    const outcomes = yield* Effect.forEach(
      prepared.specs,
      (spec) =>
        launchMember(
          prepared.swarm,
          prepared.adder,
          prepared.adderShell,
          prepared.coordinatorShell,
          spec,
        ).pipe(
          Effect.result,
          Effect.map((result) => ({ spec, result })),
        ),
      { concurrency: SPAWN_CONCURRENCY },
    ).pipe(Effect.onInterrupt(() => releaseReserved));

    // Phase 3: commit succeeded workers and release reservations under the swarm lock.
    return yield* withSwarmLock(
      prepared.swarm.id,
      Effect.gen(function* () {
        yield* releaseReserved;
        const { swarm, adder } = prepared;
        const added: Array<{ readonly name: string; readonly model: string }> = [];
        const failed: Array<{ readonly name: string; readonly reason: string }> = [];
        const overlapWarnings: Array<string> = [];
        let firstError: AgySwarmError | undefined;

        for (const { spec, result } of outcomes) {
          if (result._tag === "Failure") {
            firstError ??= result.failure;
            failed.push({ name: spec.name, reason: result.failure.reason });
            continue;
          }
          const { threadId, worktreePath, branch, scratchDir } = result.success;
          const overlaps = Board.findOwnershipOverlaps(swarm.members, {
            name: spec.name,
            workspace: spec.workspace,
            owns: spec.owns,
          });
          for (const overlap of overlaps) {
            overlapWarnings.push(
              `@${spec.name} (${overlap.ownPath}) overlaps @${overlap.member} (${overlap.otherPath})`,
            );
          }
          const now = yield* nowIso;
          const member: Board.StoredMember = {
            name: spec.name,
            threadId,
            role: "worker",
            addedBy: adder.name,
            instanceId: spec.model.instanceId,
            model: modelLabel(spec.model),
            workspace: spec.workspace,
            worktreePath,
            branch,
            owns: [...spec.owns],
            ...(spec.canManage ? { canManage: true } : {}),
            ...(spec.readOnly ? { readOnly: true } : {}),
            scratchDir,
            channels: [...spec.channels],
            brief: spec.brief,
            createdAt: now,
            killedAt: null,
            lastReadSeq: Board.head(swarm),
            lastWakeSeq: Board.head(swarm),
            wakeOnAny: false,
          };
          swarm.members.push(member);
          byThread.set(threadId, swarm.id);
          const briefPost = yield* appendOrRefuse(swarm, {
            from: adder.name,
            text: `@${spec.name} ${spec.brief}`,
            channel:
              spec.channels.find((channel) => channel !== Board.MAIN_CHANNEL) ?? Board.MAIN_CHANNEL,
            kind: "brief",
            briefTarget: spec.name,
            now,
          });
          // The worker receives its brief as its initial thread message, so mark it read/woken.
          member.lastReadSeq = briefPost.seq;
          member.lastWakeSeq = briefPost.seq;
          added.push({ name: spec.name, model: modelWithEffortLabel(spec.model) });
        }

        if (added.length === 0) {
          return yield* firstError ?? new AgySwarmError({ reason: "Launch failed." });
        }
        yield* save(swarm);

        const uniqueModels = [...new Set(added.map((entry) => entry.model))];
        const parts = [
          uniqueModels.length === 1
            ? `Added ${added.map((entry) => entry.name).join(", ")} (${uniqueModels[0]}). They start on their briefs now and report with @${adder.name}.`
            : `Added ${added.map((entry) => `${entry.name} (${entry.model})`).join(", ")}. They start on their briefs now and report with @${adder.name}.`,
        ];
        if (overlapWarnings.length > 0) {
          parts.push(
            `WARNING: ownership overlap on shared workspace: ${overlapWarnings.join("; ")}. Consider workspace:"worktree" or splitting owns.`,
          );
        }
        if (failed.length > 0) {
          parts.push(
            `Failed to launch: ${failed.map((entry) => `${entry.name} (${entry.reason})`).join("; ")}.`,
          );
        }
        return parts.join("\n");
      }),
    );
  });

  const kill: AgySwarmShape["kill"] = (callerThreadId, name, input) =>
    withExistingSwarmLock(callerThreadId, ({ swarm, member: caller }) =>
      Effect.gen(function* () {
        const targets = Board.membersNamed(swarm, name).filter(Board.isLive);
        if (targets.length === 0) return yield* refuse(`No live member "${name}".`);
        for (const target of targets) {
          if (target.role === "coordinator")
            return yield* refuse("The coordinator cannot be killed.");
          if (!Board.canManageSwarm(caller) && target.addedBy !== caller.name) {
            return yield* refuse(
              `You may kill only helpers you added; ${target.name} was added by ${target.addedBy}.`,
            );
          }
        }

        const projectRoot = yield* projectRootOf(swarm.projectId);
        const coordinatorShell = yield* shellOf(swarm.coordinatorThreadId);
        const targetInfo: Array<{
          readonly target: Board.StoredMember;
          readonly shell: OrchestrationV2ThreadShell | null;
          readonly ownWorktreePath: string | null;
          readonly ownBranch: string | null;
        }> = [];

        // Check dirty worktrees before stopping or killing any target in the batch.
        for (const target of targets) {
          const shell = yield* shellOf(target.threadId);
          const candidatePath = target.worktreePath ?? shell?.worktreePath ?? null;
          const ownWorktreePath =
            target.workspace === "worktree" &&
            candidatePath !== null &&
            candidatePath !== projectRoot &&
            candidatePath !== coordinatorShell?.worktreePath
              ? candidatePath
              : null;
          const ownBranch =
            ownWorktreePath === null ? null : (target.branch ?? shell?.branch ?? null);
          if (ownWorktreePath !== null && input?.force !== true) {
            const localStatus = yield* gitWorkflow
              .localStatus({ cwd: ownWorktreePath })
              .pipe(Effect.orElseSucceed(() => null));
            if (localStatus !== null && localStatus.isRepo && localStatus.hasWorkingTreeChanges) {
              const count = localStatus.workingTree.files.length;
              const detail = count > 0 ? `${count} uncommitted file(s)` : "uncommitted changes";
              return yield* refuse(
                `${target.name}'s worktree (${ownWorktreePath}) has ${detail}. Commit or merge its work first, or pass force:true to discard it.`,
              );
            }
          }
          targetInfo.push({ target, shell, ownWorktreePath, ownBranch });
        }

        const removedWorktrees: Array<string> = [];
        const cleanupWarnings: Array<string> = [];
        for (const { target, shell, ownWorktreePath, ownBranch } of targetInfo) {
          yield* threads
            .dispatch({
              type: "thread.stop",
              commandId: CommandId.make(`agy-swarm:${swarm.id}:kill:${target.name}`),
              threadId: ThreadId.make(target.threadId),
              reason: `Killed by ${caller.name} in swarm "${swarm.title}"`,
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("agy swarm kill stop failed", { cause }),
              ),
            );
          let removed = false;
          if (ownWorktreePath !== null) {
            const repoCwd =
              projectRoot ??
              coordinatorShell?.worktreePath ??
              (yield* gitWorkflow
                .repositoryRoot(ownWorktreePath)
                .pipe(Effect.orElseSucceed(() => null)));
            if (repoCwd !== null) {
              removed = yield* gitWorkflow
                .removeWorktree({ cwd: repoCwd, path: ownWorktreePath, force: true })
                .pipe(
                  Effect.as(true),
                  Effect.catchCause((cause) => {
                    cleanupWarnings.push(
                      `${target.name}: could not remove worktree ${ownWorktreePath}`,
                    );
                    return Effect.logWarning("agy swarm worktree removal failed", {
                      member: target.name,
                      worktreePath: ownWorktreePath,
                      cause,
                    }).pipe(Effect.as(false));
                  }),
                );
              if (removed) {
                removedWorktrees.push(target.name);
                if (ownBranch !== null) {
                  yield* gitWorkflow
                    .deleteLocalBranch({ cwd: repoCwd, refName: ownBranch, force: true })
                    .pipe(Effect.ignore);
                }
              }
            }
          }
          // A retired member keeps showing the model it last ran, not the one it was added with.
          if (shell !== null) {
            target.model = modelLabel(shell.modelSelection);
            target.instanceId = shell.modelSelection.instanceId;
          }
          target.killedAt = yield* nowIso;
          parked.delete(target.threadId);
          rungSeq.delete(target.threadId);
          yield* appendOrRefuse(swarm, {
            from: caller.name,
            text: removed ? `killed ${target.name} (worktree removed)` : `killed ${target.name}`,
            channel: Board.MAIN_CHANNEL,
            kind: "system",
            now: target.killedAt,
          });
        }
        yield* save(swarm);
        const parts = [
          `Killed ${targets.map((target) => target.name).join(", ")}. Their names cannot be reused.`,
        ];
        if (removedWorktrees.length > 0) {
          parts.push(`Removed worktree(s) for: ${removedWorktrees.join(", ")}.`);
        }
        if (cleanupWarnings.length > 0) {
          parts.push(`Cleanup warning: ${cleanupWarnings.join("; ")}.`);
        }
        return parts.join(" ");
      }),
    );

  const setModel: AgySwarmShape["setModel"] = (callerThreadId, input) =>
    withExistingSwarmLock(callerThreadId, ({ swarm, member: caller }) =>
      Effect.gen(function* () {
        const targetName = input.name ?? caller.name;
        const target = Board.memberByName(swarm, targetName);
        if (target === undefined || !Board.isLive(target))
          return yield* refuse(`No live member "${targetName}".`);
        if (
          caller.role !== "coordinator" &&
          target.addedBy !== caller.name &&
          target.name !== caller.name
        ) {
          return yield* refuse(
            `Only the coordinator or ${target.addedBy} may switch ${targetName}'s model.`,
          );
        }
        const shell = yield* shellOf(target.threadId);
        if (shell === null) return yield* refuse(`${targetName}'s thread was not found.`);
        const model = yield* resolveModel(input.model, shell.modelSelection, input.reasoningEffort);
        const isWorking = shell.activeRunId !== null || BUSY_STATUSES.includes(shell.status);
        if (model.instanceId !== shell.providerInstanceId && isWorking) {
          return yield* refuse(
            `Cannot switch ${targetName} to provider "${model.instanceId}" while it is working. Wait until it is idle or stop it first.`,
          );
        }
        const commandId = CommandId.make(
          `agy-swarm:${swarm.id}:model:${targetName}:${Board.head(swarm)}:${modelWithEffortLabel(model)}`,
        );
        const type = modelSelectionCommandType(shell.providerInstanceId, model);
        yield* threads
          .dispatch({
            type,
            commandId,
            threadId: shell.id,
            modelSelection: model,
          })
          .pipe(
            Effect.mapError(
              (error) => new AgySwarmError({ reason: `Switch failed: ${error.message}` }),
            ),
          );
        const shouldResume = input.resume === true || STOPPED_STATUSES.includes(shell.status);
        if (shouldResume) {
          yield* threads
            .sendToThread({
              projectId: shell.projectId,
              commandId: CommandId.make(`${commandId}:resume`),
              messageId: MessageId.make(`${commandId}:resume`),
              threadId: shell.id,
              senderThreadId: ThreadId.make(caller.threadId),
              text: `[swarm] ${caller.name} switched you to ${modelWithEffortLabel(model)}. Continue your brief from where the board stands: read_board{since:${target.lastReadSeq}}.`,
              attachments: [],
              modelSelection: model,
              mode: "queue",
              ...agentSent(true),
            })
            .pipe(
              Effect.mapError(
                (error) =>
                  new AgySwarmError({ reason: `Resume after switch failed: ${error.message}` }),
              ),
            );
        }
        target.model = modelLabel(model);
        target.instanceId = model.instanceId;
        yield* appendOrRefuse(swarm, {
          from: caller.name,
          text: `switched ${targetName} to ${modelWithEffortLabel(model)}`,
          channel: Board.MAIN_CHANNEL,
          kind: "system",
          now: yield* nowIso,
        });
        yield* save(swarm);
        return `${targetName} now runs on ${modelWithEffortLabel(model)}${shouldResume ? " (resumed)" : ""}.`;
      }),
    );

  const setTitle: AgySwarmShape["setTitle"] = (callerThreadId, title, kind) =>
    withEnsuredSwarmLock(callerThreadId, ({ swarm, member }) =>
      Effect.gen(function* () {
        if (member.role !== "coordinator")
          return yield* refuse("Only the coordinator names the swarm.");
        swarm.title = title.trim().slice(0, 120) || swarm.title;
        if (kind !== undefined) swarm.kind = kind;
        yield* save(swarm);
        return `Swarm titled "${swarm.title}".`;
      }),
    );

  const setPlan: AgySwarmShape["setPlan"] = (callerThreadId, input) =>
    withEnsuredSwarmLock(callerThreadId, ({ swarm, member }) =>
      Effect.gen(function* () {
        if (!Board.canManageSwarm(member)) {
          return yield* refuse("Only the coordinator or a delegated manager sets the overview.");
        }
        const existing = swarm.plan;
        const goal = input.goal ?? existing?.goal;
        if (goal === undefined) {
          return yield* refuse("This action needs `goal` on the first plan call.");
        }
        const mode = input.mode ?? existing?.mode;
        const integrityMode = input.integrityMode ?? existing?.integrityMode;
        const projectDir = input.projectDir ?? existing?.projectDir;
        const artifacts = input.artifacts ?? existing?.artifacts;
        const milestones = input.milestones ?? existing?.milestones;
        const rounds = input.rounds ?? existing?.rounds;
        const finalAudit = input.finalAudit ?? existing?.finalAudit;
        swarm.plan = {
          goal,
          tasks: input.tasks ?? existing?.tasks ?? {},
          threads: input.threads ?? existing?.threads ?? [],
          ...(mode === undefined ? {} : { mode }),
          ...(integrityMode === undefined ? {} : { integrityMode }),
          ...(projectDir === undefined ? {} : { projectDir }),
          ...(artifacts === undefined ? {} : { artifacts }),
          ...(milestones === undefined ? {} : { milestones }),
          ...(rounds === undefined ? {} : { rounds }),
          ...(finalAudit === undefined ? {} : { finalAudit }),
        };
        yield* save(swarm);
        return "Overview updated.";
      }),
    );

  const channel: AgySwarmShape["channel"] = (callerThreadId, input) =>
    withEnsuredSwarmLock(callerThreadId, ({ swarm, member: caller }) =>
      Effect.gen(function* () {
        if (input.op === "list") {
          return swarm.channels
            .map((item) => {
              const members = swarm.members.filter(
                (member) => member.channels.includes(item.name) && Board.isLive(member),
              );
              return `#${item.name}${item.archived ? " (archived)" : ""}${item.topic === "" ? "" : `: ${item.topic}`} [${members.map((member) => member.name).join(", ")}]`;
            })
            .join("\n");
        }
        const name = input.channel?.replace(/^#/u, "").trim();
        if (name === undefined || !/^[a-z][a-z0-9_-]{0,39}$/u.test(name)) {
          return yield* refuse("channel must be lowercase letters, digits, '-' and '_'.");
        }
        const existing = swarm.channels.find((item) => item.name === name);
        if (input.op === "create") {
          if (!Board.canManageSwarm(caller)) {
            return yield* refuse("Only the coordinator or a delegated manager creates channels.");
          }
          if (existing !== undefined) return yield* refuse(`#${name} already exists.`);
          swarm.channels.push({
            name,
            topic: input.topic ?? "",
            createdBy: caller.name,
            archived: false,
          });
          if (!caller.channels.includes(name)) caller.channels.push(name);
        } else {
          if (existing === undefined) return yield* refuse(`#${name} does not exist.`);
          if (name === Board.MAIN_CHANNEL) return yield* refuse("#main cannot be changed.");
          if (input.op === "archive") {
            if (!Board.canManageSwarm(caller)) {
              return yield* refuse(
                "Only the coordinator or a delegated manager archives channels.",
              );
            }
            existing.archived = true;
          } else {
            const who = input.name === undefined ? caller : Board.memberByName(swarm, input.name);
            if (who === undefined) return yield* refuse(`No member "${input.name}".`);
            if (who !== caller && !Board.canManageSwarm(caller)) {
              return yield* refuse(
                "Only the coordinator or a delegated manager moves other members between channels.",
              );
            }
            who.channels =
              input.op === "join"
                ? [...new Set([...who.channels, name])]
                : who.channels.filter((item) => item !== name);
          }
        }
        yield* save(swarm);
        return `#${name}: ${input.op} done.`;
      }),
    );

  const post: AgySwarmShape["post"] = (callerThreadId, input) =>
    withEnsuredSwarmLock(callerThreadId, ({ swarm, member }) =>
      Effect.gen(function* () {
        if (member.killedAt !== null) return yield* refuse("You were removed from this swarm.");
        const created = yield* appendAndDeliver(swarm, {
          from: member.name,
          text: input.text,
          channel: input.channel?.replace(/^#/u, ""),
          now: yield* nowIso,
        });
        const hidden = Board.hiddenMentionedMembers(swarm, created);
        return {
          seq: created.seq,
          mentions: created.mentions,
          ...(hidden.length === 0
            ? {}
            : {
                note: `Note: ${hidden.map((name) => `@${name}`).join(", ")} not in #${created.channel} and was not woken.`,
              }),
        };
      }),
    );

  const read: AgySwarmShape["read"] = (callerThreadId, input) =>
    withExistingSwarmLock(callerThreadId, ({ swarm, member }) =>
      Effect.gen(function* () {
        const posts = Board.readPosts(swarm, member, {
          since: input.since ?? member.lastReadSeq,
          limit: Math.min(Math.max(input.limit ?? 100, 1), 300),
          channel: input.channel?.replace(/^#/u, ""),
        });
        const last = posts.at(-1)?.seq;
        if (last !== undefined && last > member.lastReadSeq) {
          member.lastReadSeq = last;
          yield* save(swarm);
        }
        return {
          posts: posts.length === 0 ? "(no new posts)" : posts.map(Board.formatPost).join("\n"),
          head: Board.head(swarm),
        };
      }),
    );

  const waitScoped = Effect.fn("AgySwarm.wait")(function* (
    callerThreadId: ThreadId,
    input: Parameters<AgySwarmShape["wait"]>[1],
  ) {
    const { swarm, member } = yield* requireMember(callerThreadId);
    const mentionsOnly = input.mentionsOnly ?? true;
    const since = input.since ?? member.lastReadSeq;
    const timeout = Duration.seconds(
      Math.min(Math.max(input.timeoutSeconds ?? MAX_WAIT_SECONDS, 1), MAX_WAIT_SECONDS),
    );
    const relevant = () =>
      swarm.posts.filter(
        (candidate) =>
          candidate.seq > since &&
          candidate.from !== member.name &&
          (mentionsOnly
            ? Board.wakeTargets({ ...swarm, members: [member] }, candidate).length > 0
            : Board.visibleTo(member, candidate)),
      );
    const subscription = yield* PubSub.subscribe(changed);
    yield* withSwarmLock(
      swarm.id,
      Effect.sync(() => {
        parked.set(member.threadId, (parked.get(member.threadId) ?? 0) + 1);
        if (!mentionsOnly) member.wakeOnAny = true;
      }).pipe(Effect.andThen(PubSub.publish(changed, swarm.id))),
    );
    // Stay parked until lastReadSeq is recorded under the lock so saveAndDeliver cannot ring in the gap.
    const { posts, timedOut } = yield* Effect.gen(function* () {
      const found = yield* Effect.gen(function* () {
        while (relevant().length === 0) {
          const next = yield* PubSub.take(subscription);
          if (next !== swarm.id) continue;
        }
        return relevant();
      }).pipe(Effect.timeoutOption(timeout));
      const matched = found._tag === "Some" ? found.value : [];
      yield* withSwarmLock(
        swarm.id,
        Effect.gen(function* () {
          const last = matched.at(-1)?.seq;
          if (last !== undefined && last > member.lastReadSeq) {
            member.lastReadSeq = last;
            yield* save(swarm);
          }
        }),
      );
      return { posts: matched, timedOut: found._tag === "None" };
    }).pipe(
      Effect.ensuring(
        withSwarmLock(
          swarm.id,
          Effect.sync(() => {
            const count = (parked.get(member.threadId) ?? 1) - 1;
            if (count <= 0) {
              parked.delete(member.threadId);
              member.wakeOnAny = false;
            } else {
              parked.set(member.threadId, count);
            }
          }).pipe(Effect.andThen(PubSub.publish(changed, swarm.id))),
        ),
      ),
    );
    return {
      posts: posts.length === 0 ? "(nothing yet)" : posts.map(Board.formatPost).join("\n"),
      head: Board.head(swarm),
      timedOut,
    };
  });

  const wait: AgySwarmShape["wait"] = (callerThreadId, input) =>
    Effect.scoped(waitScoped(callerThreadId, input));

  const requireSwarmForThread = (
    threadId: ThreadId,
  ): Effect.Effect<Board.StoredSwarm, AgySwarmError> => {
    const found = callerOf(threadId);
    if (found === undefined) return refuse("This thread is in no swarm.");
    return Effect.succeed(found.swarm);
  };

  const userPost: AgySwarmShape["userPost"] = (threadId, input) =>
    Effect.suspend(() => {
      const swarmId = byThread.get(threadId);
      if (swarmId === undefined) return refuse("This thread is in no swarm.");
      return withSwarmLock(
        swarmId,
        Effect.gen(function* () {
          const swarm = yield* requireSwarmForThread(threadId);
          const created = yield* appendAndDeliver(swarm, {
            from: "user",
            text: input.text,
            channel: input.channel?.replace(/^#/u, "") || Board.MAIN_CHANNEL,
            now: yield* nowIso,
          });
          const hidden = Board.hiddenMentionedMembers(swarm, created);
          return {
            seq: created.seq,
            mentions: created.mentions,
            ...(hidden.length === 0
              ? {}
              : {
                  note: `Note: ${hidden.map((name) => `@${name}`).join(", ")} not in #${created.channel} and was not woken.`,
                }),
          };
        }),
      );
    });

  const userKill: AgySwarmShape["userKill"] = (threadId, input) =>
    requireSwarmForThread(threadId).pipe(
      Effect.flatMap((swarm) =>
        kill(ThreadId.make(swarm.coordinatorThreadId), input.name, { force: input.force }),
      ),
    );

  const userAdd: AgySwarmShape["userAdd"] = (threadId, input) =>
    requireSwarmForThread(threadId).pipe(
      Effect.flatMap((swarm) => add(ThreadId.make(swarm.coordinatorThreadId), input)),
    );

  const userRetry: AgySwarmShape["userRetry"] = (threadId, input) =>
    Effect.suspend(() => {
      const swarmId = byThread.get(threadId);
      if (swarmId === undefined) return refuse("This thread is in no swarm.");
      return withSwarmLock(
        swarmId,
        Effect.gen(function* () {
          const swarm = yield* requireSwarmForThread(threadId);
          const target = Board.memberByName(swarm, input.name);
          if (target === undefined || !Board.isLive(target)) {
            return yield* refuse(`No live member "${input.name}".`);
          }
          const shell = yield* shellOf(target.threadId);
          if (shell === null) return yield* refuse(`${target.name}'s thread was not found.`);
          if (shell.activeRunId !== null || BUSY_STATUSES.includes(shell.status)) {
            return yield* refuse(`${target.name} is already working.`);
          }
          const customNote = input.message?.trim();
          const prompt =
            customNote && customNote.length > 0
              ? `[swarm] User retried you: ${customNote}\nCheck the board with read_board{since:${target.lastReadSeq}} and continue.`
              : `[swarm] User retried you. Continue your work from where the board stands: read_board{since:${target.lastReadSeq}}.`;
          const commandId = CommandId.make(
            `agy-swarm:${swarm.id}:retry:${target.name}:${yield* randomUuidV4}`,
          );
          yield* threads
            .sendToThread({
              projectId: shell.projectId,
              commandId,
              messageId: MessageId.make(commandId),
              threadId: shell.id,
              text: prompt,
              attachments: [],
              mode: "queue",
              ...agentSent(false),
            })
            .pipe(
              Effect.mapError(
                (error) => new AgySwarmError({ reason: `Retry failed: ${error.message}` }),
              ),
            );
          swarm.doneAt = null;
          yield* appendOrRefuse(swarm, {
            from: "user",
            text: `retried ${target.name}`,
            channel: Board.MAIN_CHANNEL,
            kind: "system",
            now: yield* nowIso,
          });
          yield* save(swarm);
          return `Retried ${target.name}.`;
        }),
      );
    });

  const loadPosts: AgySwarmShape["loadPosts"] = (threadId, input) =>
    requireSwarmForThread(threadId).pipe(
      Effect.map((swarm) => {
        const limit = Math.min(
          Math.max(input.limit ?? LOAD_POSTS_DEFAULT_LIMIT, 1),
          LOAD_POSTS_MAX_LIMIT,
        );
        const older = swarm.posts.filter((post) => post.seq < input.beforeSeq);
        const slice = older.slice(-limit);
        return {
          posts: slice.map((post) => ({ ...post, mentions: [...post.mentions] })),
          hasMore: older.length > slice.length,
        };
      }),
    );

  const snapshot: AgySwarmShape["snapshot"] = (threadId) => {
    const found = callerOf(threadId);
    return found === undefined ? Effect.succeed(null) : buildSnapshot(found.swarm);
  };

  const changes: AgySwarmShape["changes"] = (threadId) => {
    // Member threads change state through their runs, which the board never sees.
    // Only run and request changes move a member's state; streamed text would flood the wire.
    const threadEvents = threads.streamDomainEvents.pipe(
      Stream.filter((event) => {
        if (!STATE_EVENT_PREFIXES.some((prefix) => event.type.startsWith(prefix))) return false;
        const swarmId = byThread.get(event.threadId);
        return swarmId !== undefined && swarmId === byThread.get(threadId);
      }),
      Stream.map(() => byThread.get(threadId) ?? ""),
      Stream.catchCause(() => Stream.empty),
    );
    const boardEvents = Stream.fromPubSub(changed).pipe(
      Stream.filter((swarmId) => swarmId === byThread.get(threadId)),
    );
    return Stream.concat(
      Stream.fromEffect(snapshot(threadId)),
      Stream.merge(boardEvents, threadEvents).pipe(
        Stream.debounce(Duration.millis(250)),
        Stream.mapEffect(() => snapshot(threadId)),
      ),
    ).pipe(Stream.changesWith((left, right) => fingerprint(left) === fingerprint(right)));
  };

  // Monotonic start timestamp per active swarm so the elapsed timer stays steady across worker handoffs.
  const activeSinceBySwarm = new Map<string, string>();

  const activeSnapshot: AgySwarmShape["activeSnapshot"] = Effect.gen(function* () {
    const active: Array<AgyActiveSwarm> = [];
    const seen = new Set<string>();
    const now = yield* nowIso;
    for (const swarm of swarms.values()) {
      if (swarm.doneAt !== null) {
        activeSinceBySwarm.delete(swarm.id);
        continue;
      }
      const states = yield* memberStates(swarm);
      const workingWorkers = states.filter(
        ({ member, state }) => member.role !== "coordinator" && state === "working",
      );
      if (workingWorkers.length === 0) {
        activeSinceBySwarm.delete(swarm.id);
        continue;
      }
      seen.add(swarm.id);
      let startedAt = activeSinceBySwarm.get(swarm.id);
      if (startedAt === undefined) {
        const earliest = workingWorkers
          .map(({ shell, member }) => {
            const runAt =
              shell?.activityRunStartedAt ??
              shell?.latestRunStartedAt ??
              shell?.latestRunRequestedAt ??
              null;
            return runAt !== null ? DateTime.formatIso(runAt) : member.createdAt;
          })
          .toSorted()[0];
        startedAt = earliest ?? swarm.posts.at(-1)?.createdAt ?? now;
        activeSinceBySwarm.set(swarm.id, startedAt);
      }
      active.push({
        threadId: ThreadId.make(swarm.coordinatorThreadId),
        startedAt,
      });
    }
    for (const swarmId of activeSinceBySwarm.keys()) {
      if (!seen.has(swarmId)) activeSinceBySwarm.delete(swarmId);
    }
    active.sort((left, right) => left.threadId.localeCompare(right.threadId));
    return { active };
  });

  const activeFingerprint = (value: AgyActiveSwarmsSnapshot) =>
    value.active.map((entry) => `${entry.threadId}:${entry.startedAt}`).join("\n");

  const activeChanges: AgySwarmShape["activeChanges"] = Stream.concat(
    Stream.fromEffect(activeSnapshot),
    Stream.merge(
      Stream.fromPubSub(changed),
      threads.streamDomainEvents.pipe(
        Stream.filter(
          (event) =>
            STATE_EVENT_PREFIXES.some((prefix) => event.type.startsWith(prefix)) &&
            byThread.has(event.threadId),
        ),
        Stream.map((event) => byThread.get(event.threadId) ?? ""),
        Stream.catchCause(() => Stream.empty),
      ),
    ).pipe(
      Stream.debounce(Duration.millis(250)),
      Stream.mapEffect(() => activeSnapshot),
    ),
  ).pipe(Stream.changesWith((left, right) => activeFingerprint(left) === activeFingerprint(right)));

  const monitorOnce = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    for (const swarm of swarms.values()) {
      if (swarm.doneAt !== null) continue;
      const lastAt = Date.parse(swarm.posts.at(-1)?.createdAt ?? swarm.createdAt);
      if (nowMs - lastAt > MONITOR_MAX_AGE_MS) continue;
      const states = yield* memberStates(swarm);
      const alert = Board.detectStall(
        swarm,
        states.map(({ member, state }) => ({
          name: member.name,
          state,
          lastPostSeq: Board.lastPostSeq(swarm, member.name),
        })),
        { nowMs, quietMs: STALL_QUIET_MS, repeatMs: STALL_REPEAT_MS },
      );
      if (alert === null) continue;
      yield* withSwarmLock(
        swarm.id,
        Effect.gen(function* () {
          const now = yield* nowIso;
          const previous = swarm.stall;
          const post = yield* appendOrRefuse(swarm, {
            from: "monitor",
            text: alert.text,
            channel: Board.MAIN_CHANNEL,
            kind: "stall",
            now,
          });
          swarm.stall = {
            key: alert.key,
            count: previous?.key === alert.key ? previous.count + 1 : 1,
            lastAt: now,
            headAtAlert: post.seq,
          };
          yield* saveAndDeliver(swarm, post);
        }),
      );
    }
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("agy swarm monitor pass failed", { cause })),
  );

  yield* forkParked(
    Effect.sleep(MONITOR_INTERVAL).pipe(Effect.andThen(monitorOnce), Effect.forever),
  );

  // Track member turn counts, token usage, failure alerts, and deferred board wakes.
  yield* forkParked(
    threads.streamDomainEvents.pipe(
      Stream.filter(
        (event) =>
          byThread.has(event.threadId) &&
          ((event.type === "run.updated" && !BUSY_STATUSES.includes(event.payload.status)) ||
            event.type === "provider-turn.updated"),
      ),
      Stream.catchCause(() => Stream.empty),
      Stream.runForEach((event) => {
        const swarmId = byThread.get(event.threadId);
        if (swarmId === undefined) return Effect.void;
        if (event.type === "provider-turn.updated") {
          const turnUsage = event.payload.turnTokenUsage;
          const fallbackUsage = event.payload.tokenUsage;
          if (turnUsage === undefined && fallbackUsage === undefined) return Effect.void;
          const next = {
            inputTokens: turnUsage?.inputTokens ?? fallbackUsage?.inputTokens ?? 0,
            outputTokens: turnUsage?.outputTokens ?? fallbackUsage?.outputTokens ?? 0,
            cachedInputTokens:
              turnUsage?.cachedInputTokens ?? fallbackUsage?.cachedInputTokens ?? 0,
            reasoningTokens:
              turnUsage?.reasoningTokens ?? fallbackUsage?.reasoningOutputTokens ?? 0,
            totalTokens: 0,
          };
          const sumIO = next.inputTokens + next.outputTokens;
          next.totalTokens = sumIO > 0 ? sumIO : (fallbackUsage?.usedTokens ?? 0);
          const turnKey = `${event.threadId}:${event.payload.id}`;
          const prev = recordedTurnUsage.get(turnKey);
          const delta = {
            inputTokens: Math.max(0, next.inputTokens - (prev?.inputTokens ?? 0)),
            outputTokens: Math.max(0, next.outputTokens - (prev?.outputTokens ?? 0)),
            cachedInputTokens: Math.max(0, next.cachedInputTokens - (prev?.cachedInputTokens ?? 0)),
            reasoningTokens: Math.max(0, next.reasoningTokens - (prev?.reasoningTokens ?? 0)),
            totalTokens: Math.max(0, next.totalTokens - (prev?.totalTokens ?? 0)),
          };
          if (
            delta.inputTokens === 0 &&
            delta.outputTokens === 0 &&
            delta.cachedInputTokens === 0 &&
            delta.reasoningTokens === 0 &&
            delta.totalTokens === 0
          ) {
            return Effect.void;
          }
          recordedTurnUsage.set(turnKey, {
            inputTokens: Math.max(prev?.inputTokens ?? 0, next.inputTokens),
            outputTokens: Math.max(prev?.outputTokens ?? 0, next.outputTokens),
            cachedInputTokens: Math.max(prev?.cachedInputTokens ?? 0, next.cachedInputTokens),
            reasoningTokens: Math.max(prev?.reasoningTokens ?? 0, next.reasoningTokens),
            totalTokens: Math.max(prev?.totalTokens ?? 0, next.totalTokens),
          });
          if (recordedTurnUsage.size > MAX_RECORDED_METRIC_KEYS) {
            const oldest = recordedTurnUsage.keys().next().value;
            if (oldest !== undefined) recordedTurnUsage.delete(oldest);
          }
          return withSwarmLock(
            swarmId,
            Effect.gen(function* () {
              const found = callerOf(ThreadId.make(event.threadId));
              if (found === undefined) return;
              const current = (found.member.metrics ??= Board.emptyMetrics());
              current.inputTokens += delta.inputTokens;
              current.outputTokens += delta.outputTokens;
              current.cachedInputTokens += delta.cachedInputTokens;
              current.reasoningTokens += delta.reasoningTokens;
              current.totalTokens += delta.totalTokens;
              yield* save(found.swarm);
            }),
          ).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("agy swarm token metrics update failed", { cause }),
            ),
          );
        }
        if (event.type !== "run.updated") return Effect.void;
        return withSwarmLock(
          swarmId,
          Effect.gen(function* () {
            const found = callerOf(ThreadId.make(event.threadId));
            if (found === undefined) return;
            let metricsDirty = false;
            if (!recordedRuns.has(event.payload.id)) {
              recordedRuns.add(event.payload.id);
              if (recordedRuns.size > MAX_RECORDED_METRIC_KEYS) {
                const oldest = recordedRuns.values().next().value;
                if (oldest !== undefined) recordedRuns.delete(oldest);
              }
              const current = (found.member.metrics ??= Board.emptyMetrics());
              current.turns += 1;
              metricsDirty = true;
            }
            if (
              event.payload.status === "failed" &&
              found.member.role !== "coordinator" &&
              Board.isLive(found.member) &&
              found.swarm.doneAt === null &&
              !alertedFailedRuns.has(event.payload.id)
            ) {
              alertedFailedRuns.add(event.payload.id);
              if (alertedFailedRuns.size > MAX_ALERTED_FAILED_RUNS) {
                const oldest = alertedFailedRuns.values().next().value;
                if (oldest !== undefined) alertedFailedRuns.delete(oldest);
              }
              const shell = yield* shellOf(found.member.threadId);
              const reason =
                shell?.lastError?.replace(/\s+/gu, " ").trim().slice(0, 240) || "turn failed";
              yield* appendAndDeliver(found.swarm, {
                from: "system",
                text: `@coordinator [error] ${found.member.name} failed: ${reason}. Check its thread, switch its model with t3_swarm{action:"model"}, or kill and replace it.`,
                channel: Board.MAIN_CHANNEL,
                kind: "system",
                now: yield* nowIso,
              });
              metricsDirty = false;
            } else if (metricsDirty) {
              yield* save(found.swarm);
            }
            yield* ring(found.swarm, found.member);
          }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("agy swarm turn-end ring failed", { cause }),
          ),
        );
      }),
    ),
  );

  return {
    status,
    models,
    add,
    kill,
    setModel,
    setTitle,
    setPlan,
    channel,
    post,
    read,
    wait,
    userPost,
    userKill,
    userRetry,
    userAdd,
    loadPosts,
    snapshot,
    changes,
    activeSnapshot,
    activeChanges,
  } satisfies AgySwarmShape;
});

export const layer = Layer.effect(AgySwarm, make);
