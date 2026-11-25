// Fork: the swarm runtime. Members are ordinary T3 threads; the board, membership, and
// wakeups live here and persist as JSON next to the state database, so upstream migrations
// never see them.
import {
  type AgyActiveSwarm,
  type AgyActiveSwarmsSnapshot,
  type AgySwarmKind,
  type AgySwarmMemberState,
  type AgySwarmPlan,
  type AgySwarmSnapshot,
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
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

export interface AddInput {
  readonly name: string;
  readonly brief: string;
  readonly model?: string | undefined;
  readonly n?: number | undefined;
  readonly tasks?: ReadonlyArray<string> | undefined;
  readonly fork?: string | undefined;
  readonly workspace?: "inherit" | "worktree" | undefined;
  readonly channels?: ReadonlyArray<string> | undefined;
}

export interface ChannelInput {
  readonly op: "create" | "join" | "leave" | "archive" | "list";
  readonly channel?: string | undefined;
  readonly topic?: string | undefined;
  readonly name?: string | undefined;
}

export interface AgySwarmShape {
  readonly status: (callerThreadId: ThreadId) => Effect.Effect<string, AgySwarmError>;
  readonly models: (callerThreadId: ThreadId) => Effect.Effect<string, AgySwarmError>;
  readonly add: (callerThreadId: ThreadId, input: AddInput) => Effect.Effect<string, AgySwarmError>;
  readonly kill: (callerThreadId: ThreadId, name: string) => Effect.Effect<string, AgySwarmError>;
  readonly setModel: (
    callerThreadId: ThreadId,
    name: string,
    model: string,
  ) => Effect.Effect<string, AgySwarmError>;
  readonly setTitle: (
    callerThreadId: ThreadId,
    title: string,
    kind: AgySwarmKind | undefined,
  ) => Effect.Effect<string, AgySwarmError>;
  readonly setPlan: (
    callerThreadId: ThreadId,
    plan: AgySwarmPlan,
  ) => Effect.Effect<string, AgySwarmError>;
  readonly channel: (
    callerThreadId: ThreadId,
    input: ChannelInput,
  ) => Effect.Effect<string, AgySwarmError>;
  readonly post: (
    callerThreadId: ThreadId,
    input: { readonly text: string; readonly channel?: string | undefined },
  ) => Effect.Effect<
    { readonly seq: number; readonly mentions: ReadonlyArray<string> },
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
  readonly snapshot: (threadId: ThreadId) => Effect.Effect<AgySwarmSnapshot | null>;
  readonly changes: (threadId: ThreadId) => Stream.Stream<AgySwarmSnapshot | null>;
  readonly activeSnapshot: Effect.Effect<AgyActiveSwarmsSnapshot>;
  readonly activeChanges: Stream.Stream<AgyActiveSwarmsSnapshot>;
}

export class AgySwarm extends Context.Service<AgySwarm, AgySwarmShape>()("t3/agy/swarm/AgySwarm") {}

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
        snapshot.members
          .map((member) =>
            [
              member.name,
              member.state,
              member.activity,
              member.model,
              member.killedAt,
              member.lastReadSeq,
              member.channels.join("+"),
            ].join("|"),
          )
          .join(","),
      ].join("\n");
const BUSY_STATUSES: ReadonlyArray<string> = [
  ...ThreadManagementService.ACTIVE_RUN_STATUSES,
  "queued",
];
const STOPPED_STATUSES: ReadonlyArray<string> = ["failed", "interrupted", "cancelled"];
/** Posts a wake message quotes; older unread ones are left to read_board. */
const WAKE_POSTS_SHOWN = 3;

const modelLabel = (selection: ModelSelection) => `${selection.instanceId}/${selection.model}`;
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
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const dir = path.join(config.stateDir, "agy", "swarms");
  const swarms = new Map<string, Board.StoredSwarm>();
  const byThread = new Map<string, string>();
  /** Threads parked in `swarm_wait`: a post reaches them there, not as a queued message. */
  const parked = new Map<string, number>();
  /** The highest post each thread was last rung for. */
  const rungSeq = new Map<string, number>();
  const changed = yield* PubSub.unbounded<string>();
  const lock = yield* Semaphore.make(1);

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
  }

  const save = (swarm: Board.StoredSwarm) => {
    const file = path.join(dir, `${swarm.id}.json`);
    return encodeJson(swarm).pipe(
      Effect.flatMap((json) => fileSystem.writeFileString(`${file}.tmp`, json)),
      Effect.andThen(fileSystem.rename(`${file}.tmp`, file)),
      Effect.andThen(PubSub.publish(changed, swarm.id)),
      Effect.catchCause((cause) => Effect.logWarning("agy swarm save failed", { cause })),
    );
  };

  const locked = <A, E, R>(effect: Effect.Effect<A, E, R>) => lock.withPermits(1)(effect);
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
        'This thread is in no swarm. A coordinator starts one with swarm{action:"title"} or swarm{action:"add"}.',
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
      kind: "swarm",
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
        channels: [...member.channels],
        brief: member.brief,
        createdAt: member.createdAt,
        killedAt: member.killedAt,
        lastReadSeq: member.lastReadSeq,
        lastPostSeq: Board.lastPostSeq(swarm, member.name),
        state,
        activity,
      })),
      posts: swarm.posts
        .slice(-SNAPSHOT_POST_LIMIT)
        .map((post) => ({ ...post, mentions: [...post.mentions] })),
      head: Board.head(swarm),
    } satisfies AgySwarmSnapshot;
  });

  const resolveModel = Effect.fn("AgySwarm.resolveModel")(function* (
    requested: string,
    fallback: ModelSelection,
  ) {
    const all = yield* providers.getProviders;
    const slash = requested.indexOf("/");
    const instance = slash > 0 ? requested.slice(0, slash) : fallback.instanceId;
    const wanted = (slash > 0 ? requested.slice(slash + 1) : requested).trim().toLowerCase();
    const provider = all.find((candidate) => candidate.instanceId === instance);
    if (provider === undefined || !provider.enabled) {
      return yield* refuse(
        `Provider instance "${instance}" is not available. Call swarm{action:"models"}.`,
      );
    }
    const model = provider.models.find(
      (candidate) =>
        candidate.slug.toLowerCase() === wanted ||
        candidate.name.toLowerCase() === wanted ||
        (candidate.aliases ?? []).some((alias) => alias.toLowerCase() === wanted),
    );
    if (model === undefined) {
      return yield* refuse(
        `"${requested}" is not a model of ${instance}. Call swarm{action:"models"}.`,
      );
    }
    return {
      instanceId: ProviderInstanceId.make(instance),
      model: model.slug,
    } satisfies ModelSelection;
  });

  /**
   * Rings a member for its unread posts, as Antigravity's board does: once, and only while it is
   * idle. A member mid-turn is rung when that turn ends, so its thread never stacks queued wakes.
   */
  const ring = Effect.fn("AgySwarm.ring")(function* (
    swarm: Board.StoredSwarm,
    target: Board.StoredMember,
  ) {
    if (parked.has(target.threadId)) return;
    // A turn that failed (quota, say) is not rung again until the board moves.
    const unread = Board.unreadWakePosts(swarm, target, rungSeq.get(target.threadId) ?? 0);
    if (unread.length === 0) return;
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
    const shown = unread.slice(-WAKE_POSTS_SHOWN);
    const latest = shown.at(-1);
    if (latest === undefined) return;
    const previousRungSeq = rungSeq.get(target.threadId);
    rungSeq.set(target.threadId, target.lastWakeSeq);
    const sender = Board.memberByName(swarm, latest.from);
    const heading =
      unread.length === 1
        ? `[swarm] New on the board for you, ${target.name}:`
        : `[swarm] ${unread.length} new posts on the board for you, ${target.name}` +
          (unread.length > shown.length ? ` (latest ${shown.length} below):` : ":");
    const text =
      `${heading}\n${shown.map(Board.formatPost).join("\n\n")}\n\n` +
      `Catch up with read_board{since:${target.lastReadSeq}} and act on what is yours. ` +
      `If nothing is, end your turn.`;
    yield* threads
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
        Effect.catchCause((cause) => {
          if (previousRungSeq === undefined) rungSeq.delete(target.threadId);
          else rungSeq.set(target.threadId, previousRungSeq);
          return Effect.logWarning("agy swarm wake failed", { member: target.name, cause });
        }),
      );
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
    spec: {
      readonly name: string;
      readonly brief: string;
      readonly model: ModelSelection;
      readonly workspace: "inherit" | "worktree";
      readonly channels: ReadonlyArray<string>;
      readonly forkFrom: Board.StoredMember | undefined;
    },
  ) {
    const adderShell = yield* shellOf(adder.threadId);
    if (adderShell === null) return yield* refuse("Your thread was not found.");
    // Members live under the thread that started the swarm, not in thread lists.
    const coordinatorShell =
      swarm.coordinatorThreadId === adder.threadId
        ? adderShell
        : yield* shellOf(swarm.coordinatorThreadId);
    const swarmLineage = {
      parentThreadId: ThreadId.make(swarm.coordinatorThreadId),
      rootThreadId:
        coordinatorShell?.lineage.rootThreadId ?? ThreadId.make(swarm.coordinatorThreadId),
    };
    const threadId = ThreadId.make(yield* randomUuidV4);
    const commandId = CommandId.make(`agy-swarm:${swarm.id}:add:${spec.name}`);
    const title = `${swarm.title} · ${spec.name}`;
    const text = `${SWARM_WORKER_PREAMBLE({ name: spec.name, swarmTitle: swarm.title, adder: adder.name })}\n\n## Your brief\n${spec.brief}`;

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
      return threadId;
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
    yield* launches
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
    return threadId;
  });

  const status: AgySwarmShape["status"] = Effect.fn("AgySwarm.status")(function* (callerThreadId) {
    const { swarm } = yield* requireMember(callerThreadId);
    const states = yield* memberStates(swarm);
    const lines = states.map(({ member, shell, state, activity }) => {
      const last = Board.lastPostSeq(swarm, member.name);
      const model = liveModel(member, shell);
      return `- ${member.name} (${member.role}${model === null ? "" : `, ${model}`}${member.workspace === "worktree" ? ", own worktree" : ""}): ${state}; last post ${last === null ? "none" : `#${last}`}; read up to #${member.lastReadSeq}${activity === null ? "" : `; ${activity.replace(/\s+/gu, " ").slice(0, 100)}`}`;
    });
    return `Swarm "${swarm.title}", board head #${Board.head(swarm)}${swarm.doneAt === null ? "" : ", done"}.\n${lines.join("\n")}`;
  });

  const models: AgySwarmShape["models"] = Effect.fn("AgySwarm.models")(function* (callerThreadId) {
    const shell = yield* shellOf(callerThreadId);
    const all = yield* providers.getProviders;
    const lines = all
      .filter((provider) => provider.enabled && provider.installed)
      .map(
        (provider) =>
          `${provider.instanceId}: ${provider.models
            .filter((model) => model.isLegacy !== true)
            .map((model) => model.slug)
            .join(", ")}`,
      );
    return `Pass model as "<instance>/<model>", or just "<model>" for your own provider${shell === null ? "" : ` (${modelLabel(shell.modelSelection)})`}.\n${lines.join("\n")}`;
  });

  const add: AgySwarmShape["add"] = (callerThreadId, input) =>
    locked(
      Effect.gen(function* () {
        const { swarm, member: adder } = yield* ensureSwarm(callerThreadId);
        if (adder.killedAt !== null) return yield* refuse("You were removed from this swarm.");
        const adderShell = yield* shellOf(adder.threadId);
        if (adderShell === null) return yield* refuse("Your thread was not found.");
        const count = input.n ?? 1;
        if (count < 1 || count > 16) return yield* refuse("n must be between 1 and 16.");
        const names =
          count === 1 && input.tasks === undefined
            ? [input.name]
            : Array.from({ length: count }, (_, index) => `${input.name}-${index + 1}`);
        if (input.tasks !== undefined && input.tasks.length !== names.length) {
          return yield* refuse(
            `tasks has ${input.tasks.length} entries for ${names.length} workers.`,
          );
        }
        for (const name of names) {
          const problem = Board.validateNewName(swarm, name);
          if (problem !== null) return yield* refuse(problem);
        }
        const channels = [...new Set([Board.MAIN_CHANNEL, ...(input.channels ?? [])])];
        for (const channel of channels) {
          if (
            !swarm.channels.some((candidate) => candidate.name === channel && !candidate.archived)
          ) {
            return yield* refuse(
              `Channel #${channel} does not exist. Create it with swarm{action:"channel", op:"create"}.`,
            );
          }
        }
        const forkFrom =
          input.fork === undefined ? undefined : Board.memberByName(swarm, input.fork);
        if (input.fork !== undefined && (forkFrom === undefined || forkFrom.killedAt !== null)) {
          return yield* refuse(`fork names no live member "${input.fork}".`);
        }
        const model =
          input.model === undefined
            ? adderShell.modelSelection
            : yield* resolveModel(input.model, adderShell.modelSelection);
        const added: string[] = [];
        for (const [index, name] of names.entries()) {
          const task = input.tasks?.[index];
          const brief = task === undefined ? input.brief : `${input.brief}\n\nYour part: ${task}`;
          const threadId = yield* launchMember(swarm, adder, {
            name,
            brief,
            model,
            workspace: input.workspace ?? "inherit",
            channels,
            forkFrom,
          });
          const now = yield* nowIso;
          swarm.members.push({
            name,
            threadId,
            role: "worker",
            addedBy: adder.name,
            instanceId: model.instanceId,
            model: modelLabel(model),
            workspace: input.workspace ?? "inherit",
            channels,
            brief,
            createdAt: now,
            killedAt: null,
            lastReadSeq: Board.head(swarm),
            lastWakeSeq: Board.head(swarm),
            wakeOnAny: false,
          });
          byThread.set(threadId, swarm.id);
          yield* appendOrRefuse(swarm, {
            from: name,
            text: brief.split("\n")[0]!.slice(0, 280),
            channel:
              channels.find((channel) => channel !== Board.MAIN_CHANNEL) ?? Board.MAIN_CHANNEL,
            kind: "brief",
            now,
          });
          // A worker's brief is its first message, so its own post must not wake it.
          const self = Board.memberByName(swarm, name);
          if (self !== undefined) self.lastReadSeq = Board.head(swarm);
          added.push(name);
        }
        yield* save(swarm);
        return `Added ${added.join(", ")} (${modelLabel(model)}). They start on their briefs now and report with @${adder.name}.`;
      }),
    );

  const kill: AgySwarmShape["kill"] = (callerThreadId, name) =>
    locked(
      Effect.gen(function* () {
        const { swarm, member: caller } = yield* requireMember(callerThreadId);
        const targets = Board.membersNamed(swarm, name).filter(Board.isLive);
        if (targets.length === 0) return yield* refuse(`No live member "${name}".`);
        for (const target of targets) {
          if (target.role === "coordinator")
            return yield* refuse("The coordinator cannot be killed.");
          if (caller.role !== "coordinator" && target.addedBy !== caller.name) {
            return yield* refuse(
              `You may kill only helpers you added; ${target.name} was added by ${target.addedBy}.`,
            );
          }
        }
        for (const target of targets) {
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
          // A retired member keeps showing the model it last ran, not the one it was added with.
          const shell = yield* shellOf(target.threadId);
          if (shell !== null) {
            target.model = modelLabel(shell.modelSelection);
            target.instanceId = shell.modelSelection.instanceId;
          }
          target.killedAt = yield* nowIso;
          parked.delete(target.threadId);
          rungSeq.delete(target.threadId);
          yield* appendOrRefuse(swarm, {
            from: caller.name,
            text: `killed ${target.name}`,
            channel: Board.MAIN_CHANNEL,
            kind: "system",
            now: target.killedAt,
          });
        }
        yield* save(swarm);
        return `Killed ${targets.map((target) => target.name).join(", ")}. Their names cannot be reused.`;
      }),
    );

  const setModel: AgySwarmShape["setModel"] = (callerThreadId, name, requested) =>
    locked(
      Effect.gen(function* () {
        const { swarm, member: caller } = yield* requireMember(callerThreadId);
        const target = Board.memberByName(swarm, name);
        if (target === undefined || !Board.isLive(target))
          return yield* refuse(`No live member "${name}".`);
        if (
          caller.role !== "coordinator" &&
          target.addedBy !== caller.name &&
          target.name !== caller.name
        ) {
          return yield* refuse(
            `Only the coordinator or ${target.addedBy} may switch ${name}'s model.`,
          );
        }
        const shell = yield* shellOf(target.threadId);
        if (shell === null) return yield* refuse(`${name}'s thread was not found.`);
        const model = yield* resolveModel(requested, shell.modelSelection);
        const commandId = CommandId.make(
          `agy-swarm:${swarm.id}:model:${name}:${Board.head(swarm)}:${modelLabel(model)}`,
        );
        yield* threads
          .sendToThread({
            projectId: shell.projectId,
            commandId,
            messageId: MessageId.make(commandId),
            threadId: shell.id,
            senderThreadId: ThreadId.make(caller.threadId),
            text: `[swarm] ${caller.name} switched you to ${modelLabel(model)}. Continue your brief from where the board stands: read_board{since:${target.lastReadSeq}}.`,
            attachments: [],
            modelSelection: model,
            mode: "queue",
            ...agentSent(true),
          })
          .pipe(
            Effect.mapError(
              (error) => new AgySwarmError({ reason: `Switch failed: ${error.message}` }),
            ),
          );
        target.model = modelLabel(model);
        target.instanceId = model.instanceId;
        yield* appendOrRefuse(swarm, {
          from: caller.name,
          text: `switched ${name} to ${modelLabel(model)}`,
          channel: Board.MAIN_CHANNEL,
          kind: "system",
          now: yield* nowIso,
        });
        yield* save(swarm);
        return `${name} now runs on ${modelLabel(model)}.`;
      }),
    );

  const setTitle: AgySwarmShape["setTitle"] = (callerThreadId, title, kind) =>
    locked(
      Effect.gen(function* () {
        const { swarm, member } = yield* ensureSwarm(callerThreadId);
        if (member.role !== "coordinator")
          return yield* refuse("Only the coordinator names the swarm.");
        swarm.title = title.trim().slice(0, 120) || swarm.title;
        if (kind !== undefined) swarm.kind = kind;
        yield* save(swarm);
        return `Swarm titled "${swarm.title}".`;
      }),
    );

  const setPlan: AgySwarmShape["setPlan"] = (callerThreadId, plan) =>
    locked(
      Effect.gen(function* () {
        const { swarm, member } = yield* ensureSwarm(callerThreadId);
        if (member.role !== "coordinator")
          return yield* refuse("Only the coordinator sets the overview.");
        swarm.plan = plan;
        yield* save(swarm);
        return "Overview updated.";
      }),
    );

  const channel: AgySwarmShape["channel"] = (callerThreadId, input) =>
    locked(
      Effect.gen(function* () {
        const { swarm, member: caller } = yield* ensureSwarm(callerThreadId);
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
          if (caller.role !== "coordinator")
            return yield* refuse("Only the coordinator creates channels.");
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
            if (caller.role !== "coordinator")
              return yield* refuse("Only the coordinator archives channels.");
            existing.archived = true;
          } else {
            const who = input.name === undefined ? caller : Board.memberByName(swarm, input.name);
            if (who === undefined) return yield* refuse(`No member "${input.name}".`);
            if (who !== caller && caller.role !== "coordinator") {
              return yield* refuse("Only the coordinator moves other members between channels.");
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
    locked(
      Effect.gen(function* () {
        const { swarm, member } = yield* ensureSwarm(callerThreadId);
        if (member.killedAt !== null) return yield* refuse("You were removed from this swarm.");
        const created = yield* appendAndDeliver(swarm, {
          from: member.name,
          text: input.text,
          channel: input.channel?.replace(/^#/u, ""),
          now: yield* nowIso,
        });
        return { seq: created.seq, mentions: created.mentions };
      }),
    );

  const read: AgySwarmShape["read"] = (callerThreadId, input) =>
    locked(
      Effect.gen(function* () {
        const { swarm, member } = yield* requireMember(callerThreadId);
        const posts = Board.readPosts(swarm, member, {
          since: input.since ?? member.lastReadSeq,
          limit: Math.min(Math.max(input.limit ?? 100, 1), 300),
          channel: input.channel?.replace(/^#/u, ""),
        });
        const last = posts.at(-1)?.seq;
        if (last !== undefined && last > member.lastReadSeq) member.lastReadSeq = last;
        yield* save(swarm);
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
    parked.set(member.threadId, (parked.get(member.threadId) ?? 0) + 1);
    member.wakeOnAny = !mentionsOnly;
    yield* PubSub.publish(changed, swarm.id);
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
      yield* locked(
        Effect.gen(function* () {
          const last = matched.at(-1)?.seq;
          if (last !== undefined && last > member.lastReadSeq) member.lastReadSeq = last;
          yield* save(swarm);
        }),
      );
      return { posts: matched, timedOut: found._tag === "None" };
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          const count = (parked.get(member.threadId) ?? 1) - 1;
          if (count <= 0) parked.delete(member.threadId);
          else parked.set(member.threadId, count);
          member.wakeOnAny = false;
        }).pipe(Effect.andThen(PubSub.publish(changed, swarm.id))),
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
      yield* locked(
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

  // A member that finishes a turn with posts it has not read is rung for them then.
  yield* forkParked(
    threads.streamDomainEvents.pipe(
      Stream.filter(
        (event) =>
          event.type === "run.updated" &&
          !BUSY_STATUSES.includes(event.payload.status) &&
          byThread.has(event.threadId),
      ),
      Stream.catchCause(() => Stream.empty),
      Stream.runForEach((event) =>
        locked(
          Effect.gen(function* () {
            const found = callerOf(ThreadId.make(event.threadId));
            if (found !== undefined) yield* ring(found.swarm, found.member);
          }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("agy swarm turn-end ring failed", { cause }),
          ),
        ),
      ),
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
    snapshot,
    changes,
    activeSnapshot,
    activeChanges,
  } satisfies AgySwarmShape;
});

export const layer = Layer.effect(AgySwarm, make);
