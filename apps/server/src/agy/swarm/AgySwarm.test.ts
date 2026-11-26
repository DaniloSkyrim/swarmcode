import { assert, it } from "@effect/vitest";
import {
  type AgyActiveSwarmsSnapshot,
  type AgySwarmSnapshot,
  EventId,
  type ModelSelection,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2RunStatus,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../../config.ts";
import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as AgySwarm from "./AgySwarm.ts";

const projectId = ProjectId.make("project:swarm-test");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5" };
const now = DateTime.makeUnsafe("2026-11-24T10:00:00.000Z");

function makeShell(
  id: ThreadId,
  status: OrchestrationV2ThreadShell["status"],
): OrchestrationV2ThreadShell {
  return {
    id,
    projectId,
    title: id,
    providerInstanceId: instanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    linkedPullRequest: null,
    branchPullRequest: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    status,
    activeRunId:
      status === "running" ||
      status === "preparing" ||
      status === "starting" ||
      status === "waiting"
        ? RunId.make(`run:${id}`)
        : null,
    latestRunId: null,
    latestRunCompletedAt: null,
    latestVisibleMessage: null,
    visibleItemCount: 0,
    pendingRuntimeRequest: null,
    lastError: null,
    activityRunId: null,
    activityRunStatus: null,
    queuedRunCount: status === "queued" ? 1 : 0,
    unseenSince: null,
  } as unknown as OrchestrationV2ThreadShell;
}

let nextEventSeq = 0;

function makeRunUpdatedEvent(
  threadId: ThreadId,
  status: OrchestrationV2RunStatus,
): OrchestrationV2DomainEvent {
  nextEventSeq += 1;
  return {
    id: EventId.make(`event:${threadId}:${status}:${nextEventSeq}`),
    type: "run.updated",
    threadId,
    providerInstanceId: instanceId,
    occurredAt: now,
    payload: {
      id: RunId.make(`run:${threadId}`),
      threadId,
      status,
    },
  } as unknown as OrchestrationV2DomainEvent;
}

function makeThreadEvent(
  threadId: ThreadId,
  type: "thread.model-selection-updated" | "thread.provider-switched",
): OrchestrationV2DomainEvent {
  nextEventSeq += 1;
  return {
    id: EventId.make(`event:${threadId}:${type}:${nextEventSeq}`),
    type,
    threadId,
    providerInstanceId: instanceId,
    occurredAt: now,
    payload: {},
  } as unknown as OrchestrationV2DomainEvent;
}

const withSwarmHarness = <A, E>(
  body: (ctx: {
    readonly swarm: AgySwarm.AgySwarmShape;
    readonly coordinatorId: ThreadId;
    readonly workerId: ThreadId;
    readonly stateDir: string;
    readonly sent: Array<{ readonly threadId: ThreadId; readonly text: string }>;
    readonly setStatus: (threadId: ThreadId, status: OrchestrationV2ThreadShell["status"]) => void;
    readonly setModelSelection: (threadId: ThreadId, selection: ModelSelection) => void;
    readonly deleteThread: (threadId: ThreadId) => void;
    readonly emitRunStatus: (
      threadId: ThreadId,
      status: OrchestrationV2RunStatus,
    ) => Effect.Effect<void>;
    readonly emitThreadEvent: (
      threadId: ThreadId,
      type: "thread.model-selection-updated" | "thread.provider-switched",
    ) => Effect.Effect<void>;
    readonly awaitDomainSubscription: () => Effect.Effect<void>;
    readonly nextWake: () => Effect.Effect<void>;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "agy-swarm-test-" });
      const coordinatorId = ThreadId.make("thread:coordinator");
      const shells = new Map<ThreadId, OrchestrationV2ThreadShell>([
        [coordinatorId, makeShell(coordinatorId, "completed")],
      ]);
      const deletedThreads = new Set<ThreadId>();
      const sent: Array<{ readonly threadId: ThreadId; readonly text: string }> = [];
      let wakeSignal = yield* Deferred.make<void>();
      const events = yield* PubSub.unbounded<OrchestrationV2DomainEvent>();
      const eventsSubscribed = yield* Deferred.make<void>();
      let nextDomainSub = yield* Deferred.make<void>();

      const threads = {
        getThreadShell: (threadId: ThreadId) =>
          deletedThreads.has(threadId)
            ? Effect.fail(new AgySwarm.AgySwarmError({ reason: `Thread ${threadId} not found` }))
            : Effect.succeed(shells.get(threadId) ?? makeShell(threadId, "completed")),
        sendToThread: (input: { readonly threadId: ThreadId; readonly text: string }) =>
          Effect.gen(function* () {
            sent.push({ threadId: input.threadId, text: input.text });
            shells.set(input.threadId, makeShell(input.threadId, "queued"));
            yield* Deferred.succeed(wakeSignal, undefined);
            wakeSignal = yield* Deferred.make<void>();
            return {} as never;
          }),
        dispatch: (command: { readonly threadId?: ThreadId }) =>
          command.threadId !== undefined && deletedThreads.has(command.threadId)
            ? Effect.fail(
                new AgySwarm.AgySwarmError({ reason: `Thread ${command.threadId} not found` }),
              )
            : Effect.succeed({} as never),
        streamDomainEvents: Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(events);
            yield* Deferred.succeed(eventsSubscribed, undefined);
            const currentSub = nextDomainSub;
            nextDomainSub = yield* Deferred.make<void>();
            yield* Deferred.succeed(currentSub, undefined);
            return Stream.fromSubscription(subscription);
          }),
        ),
      } as unknown as ThreadManagementService.ThreadManagementService["Service"];

      const launches = {
        launch: (input: { readonly threadId: ThreadId }) =>
          Effect.sync(() => {
            shells.set(input.threadId, makeShell(input.threadId, "running"));
            return {} as never;
          }),
      } as unknown as ThreadLaunchService.ThreadLaunchService["Service"];

      const providers = {
        getProviders: Effect.succeed([]),
      } as unknown as ProviderRegistry.ProviderRegistry["Service"];

      const gitWorkflow = {
        localStatus: () =>
          Effect.succeed({
            isRepo: true,
            hasPrimaryRemote: false,
            isDefaultRef: false,
            refName: null,
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
          }),
        repositoryRoot: () => Effect.succeed("/repo"),
        createWorktree: (input: { readonly newRefName?: string | null }) =>
          Effect.succeed({
            worktree: {
              path: `/repo-wt/${input.newRefName ?? "wt"}`,
              refName: input.newRefName ?? "swarm/wt",
            },
          }),
        removeWorktree: () => Effect.void,
        deleteLocalBranch: () => Effect.void,
      } as unknown as GitWorkflowService.GitWorkflowService["Service"];

      const projects = {
        getById: () => Effect.succeedSome({ id: projectId, workspaceRoot: "/repo" }),
      } as unknown as ProjectService.ProjectService["Service"];

      const layer = AgySwarm.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ServerConfig.ServerConfig, {
              stateDir,
            } as ServerConfig.ServerConfig["Service"]),
            Layer.succeed(ThreadManagementService.ThreadManagementService, threads),
            Layer.succeed(ThreadLaunchService.ThreadLaunchService, launches),
            Layer.succeed(ProviderRegistry.ProviderRegistry, providers),
            Layer.succeed(GitWorkflowService.GitWorkflowService, gitWorkflow),
            Layer.succeed(ProjectService.ProjectService, projects),
          ),
        ),
      );

      const built = yield* Layer.build(layer);
      const swarm = Context.get(built, AgySwarm.AgySwarm);
      yield* Deferred.await(eventsSubscribed);
      yield* swarm.add(coordinatorId, { name: "worker", brief: "do work" });
      const snap = yield* swarm.snapshot(coordinatorId);
      const workerId = snap!.members.find((member) => member.name === "worker")!.threadId;

      return yield* body({
        swarm,
        coordinatorId,
        workerId,
        stateDir,
        sent,
        setStatus: (threadId, status) => {
          const current = shells.get(threadId) ?? makeShell(threadId, status);
          shells.set(threadId, {
            ...makeShell(threadId, status),
            modelSelection: current.modelSelection,
          });
        },
        setModelSelection: (threadId, selection) => {
          const current = shells.get(threadId) ?? makeShell(threadId, "completed");
          shells.set(threadId, {
            ...current,
            providerInstanceId: selection.instanceId,
            modelSelection: selection,
          });
        },
        deleteThread: (threadId) => {
          deletedThreads.add(threadId);
          shells.delete(threadId);
        },
        emitRunStatus: (threadId, status) =>
          PubSub.publish(events, makeRunUpdatedEvent(threadId, status)).pipe(Effect.asVoid),
        emitThreadEvent: (threadId, type) =>
          PubSub.publish(events, makeThreadEvent(threadId, type)).pipe(Effect.asVoid),
        awaitDomainSubscription: () => Deferred.await(nextDomainSub),
        nextWake: () => Deferred.await(wakeSignal),
      });
    }),
  ).pipe(Effect.provide(NodeServices.layer));

it.effect(
  "rings once while idle, defers queued/busy wakes, and does not stick if read_board is skipped",
  () =>
    withSwarmHarness(
      ({ swarm, coordinatorId, workerId, sent, setStatus, emitRunStatus, nextWake }) =>
        Effect.gen(function* () {
          // Idle coordinator gets rung once; a second post while queued does not stack a second wake.
          yield* swarm.post(workerId, { text: "@coordinator first update" });
          assert.lengthOf(sent, 1);
          assert.include(sent[0]!.text, "first update");

          yield* swarm.post(workerId, { text: "@coordinator second update while queued" });
          assert.lengthOf(sent, 1);

          // Coordinator's first turn completes WITHOUT calling read_board; turn-end rings once for the deferred post.
          const wake2 = nextWake();
          setStatus(coordinatorId, "completed");
          yield* emitRunStatus(coordinatorId, "completed");
          yield* wake2;
          assert.lengthOf(sent, 2);
          assert.include(sent[1]!.text, "second update while queued");

          // Coordinator's second turn fails without reading; no wake loop on failed turn-end.
          setStatus(coordinatorId, "failed");
          yield* emitRunStatus(coordinatorId, "failed");
          yield* Effect.yieldNow;
          assert.lengthOf(sent, 2);

          // A new post still wakes the coordinator (no stuck wakePending after failed/unread turn).
          yield* swarm.post(workerId, { text: "@coordinator third update after failure" });
          assert.lengthOf(sent, 3);
          assert.include(sent[2]!.text, "third update after failure");
        }),
    ),
);

it.effect(
  "persists lastWakeSeq before saving and delivers directly to a member parked in swarm_wait",
  () =>
    withSwarmHarness(({ swarm, coordinatorId, workerId, stateDir, sent, setStatus }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const snap = yield* swarm.snapshot(coordinatorId);
        setStatus(coordinatorId, "running");

        yield* swarm.post(workerId, { text: "@coordinator while busy" });
        assert.lengthOf(sent, 0);

        const saved = JSON.parse(
          yield* fs.readFileString(path.join(stateDir, "agy", "swarms", `${snap!.id}.json`)),
        ) as { members: Array<{ name: string; lastWakeSeq: number }> };
        const savedCoordinator = saved.members.find((member) => member.name === "coordinator");
        assert.isAbove(savedCoordinator?.lastWakeSeq ?? 0, 0);

        // Parked in swarm_wait: post wakes wait directly without queuing a thread message.
        const waiter = yield* Effect.forkChild(
          swarm.wait(workerId, { mentionsOnly: true, timeoutSeconds: 5 }),
        );
        yield* Effect.yieldNow;
        const parkedSnap = yield* swarm.snapshot(workerId);
        assert.equal(
          parkedSnap?.members.find((member) => member.name === "worker")?.activity,
          "swarm_wait",
        );
        setStatus(workerId, "completed");
        yield* swarm.post(coordinatorId, { text: "@worker parked ping" });
        const waitResult = yield* Fiber.join(waiter);
        assert.isFalse(waitResult.timedOut);
        assert.include(waitResult.posts, "parked ping");
        assert.lengthOf(sent, 0);
      }),
    ),
);

it.effect("refreshes snapshots on member model and provider switches", () =>
  withSwarmHarness(
    ({
      swarm,
      coordinatorId,
      workerId,
      setModelSelection,
      emitThreadEvent,
      awaitDomainSubscription,
    }) =>
      Effect.gen(function* () {
        const snapshots = yield* Queue.unbounded<AgySwarmSnapshot | null>();
        const subscribed = awaitDomainSubscription();
        const watcher = yield* Effect.forkChild(
          Stream.runForEach(swarm.changes(coordinatorId), (snap) =>
            Queue.offer(snapshots, snap).pipe(Effect.asVoid),
          ),
        );
        const initial = yield* Queue.take(snapshots);
        assert.strictEqual(
          initial?.members.find((member) => member.name === "worker")?.model,
          "codex/gpt-5",
        );
        yield* subscribed;

        setModelSelection(workerId, { instanceId, model: "gpt-5.4" });
        yield* emitThreadEvent(workerId, "thread.model-selection-updated");
        yield* TestClock.adjust("300 millis");
        const updated = yield* Queue.take(snapshots);
        assert.strictEqual(
          updated?.members.find((member) => member.name === "worker")?.model,
          "codex/gpt-5.4",
        );

        const claudeInstance = ProviderInstanceId.make("claude");
        setModelSelection(workerId, { instanceId: claudeInstance, model: "claude-opus-4-6" });
        yield* emitThreadEvent(workerId, "thread.provider-switched");
        yield* TestClock.adjust("300 millis");
        const switched = yield* Queue.take(snapshots);
        const switchedWorker = switched?.members.find((member) => member.name === "worker");
        assert.strictEqual(switchedWorker?.model, "claude/claude-opus-4-6");
        assert.strictEqual(switchedWorker?.instanceId, claudeInstance);

        yield* Fiber.interrupt(watcher);
      }),
  ),
);

it.effect("kill saves the member's last live model and tolerates a missing thread", () =>
  withSwarmHarness(
    ({ swarm, coordinatorId, workerId, stateDir, setModelSelection, deleteThread }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const claudeInstance = ProviderInstanceId.make("claude");

        // Switch the worker's live thread model directly, as the board UI does, then kill it.
        setModelSelection(workerId, { instanceId: claudeInstance, model: "claude-opus-4-6" });
        yield* swarm.kill(coordinatorId, "worker");

        const afterWorkerKill = yield* swarm.snapshot(coordinatorId);
        const killedWorker = afterWorkerKill?.members.find((member) => member.name === "worker");
        assert.strictEqual(killedWorker?.state, "killed");
        assert.strictEqual(killedWorker?.model, "claude/claude-opus-4-6");
        assert.strictEqual(killedWorker?.instanceId, claudeInstance);

        const saved = JSON.parse(
          yield* fs.readFileString(
            path.join(stateDir, "agy", "swarms", `${afterWorkerKill!.id}.json`),
          ),
        ) as { members: Array<{ name: string; model: string | null; instanceId: string | null }> };
        const savedWorker = saved.members.find((member) => member.name === "worker");
        assert.strictEqual(savedWorker?.model, "claude/claude-opus-4-6");
        assert.strictEqual(savedWorker?.instanceId, claudeInstance);

        // Killing a member whose thread shell is gone keeps its stored model instead of failing.
        yield* swarm.add(coordinatorId, { name: "ghost", brief: "ephemeral task" });
        const withGhost = yield* swarm.snapshot(coordinatorId);
        const ghostId = withGhost!.members.find((member) => member.name === "ghost")!.threadId;
        deleteThread(ghostId);
        yield* swarm.kill(coordinatorId, "ghost");

        const afterGhostKill = yield* swarm.snapshot(coordinatorId);
        const killedGhost = afterGhostKill?.members.find((member) => member.name === "ghost");
        assert.strictEqual(killedGhost?.state, "killed");
        assert.strictEqual(killedGhost?.model, "codex/gpt-5");
        assert.strictEqual(killedGhost?.instanceId, instanceId);
      }),
  ),
);

it.effect(
  "activeSnapshot and activeChanges track live working workers and clear when idle or done",
  () =>
    withSwarmHarness(
      ({ swarm, coordinatorId, workerId, setStatus, emitRunStatus, awaitDomainSubscription }) =>
        Effect.gen(function* () {
          const updates = yield* Queue.unbounded<AgyActiveSwarmsSnapshot>();
          const subscribed = awaitDomainSubscription();
          const watcher = yield* Effect.forkChild(
            Stream.runForEach(swarm.activeChanges, (snap) =>
              Queue.offer(updates, snap).pipe(Effect.asVoid),
            ),
          );

          // Harness launches worker as running, so coordinator starts active with a stable startedAt.
          const initial = yield* Queue.take(updates);
          assert.lengthOf(initial.active, 1);
          assert.strictEqual(initial.active[0]?.threadId, coordinatorId);
          const initialStartedAt = initial.active[0]!.startedAt;
          yield* subscribed;

          // Adding a second worker keeps the coordinator's active startedAt monotonic.
          yield* TestClock.adjust("5 seconds");
          yield* swarm.add(coordinatorId, { name: "worker-2", brief: "second task" });
          const snap2 = yield* swarm.snapshot(coordinatorId);
          const worker2Id = snap2!.members.find((member) => member.name === "worker-2")!.threadId;
          const whileBothWorking = yield* swarm.activeSnapshot;
          assert.deepStrictEqual(whileBothWorking.active, [
            { threadId: coordinatorId, startedAt: initialStartedAt },
          ]);

          // Stopping only one worker leaves the swarm active with the same startedAt.
          setStatus(workerId, "completed");
          yield* emitRunStatus(workerId, "completed");
          yield* TestClock.adjust("300 millis");
          const withOneWorking = yield* swarm.activeSnapshot;
          assert.deepStrictEqual(withOneWorking.active, [
            { threadId: coordinatorId, startedAt: initialStartedAt },
          ]);

          // Completing the last worker removes the coordinator and emits an update.
          setStatus(worker2Id, "completed");
          yield* emitRunStatus(worker2Id, "completed");
          yield* TestClock.adjust("300 millis");
          const idleUpdate = yield* Queue.take(updates);
          assert.deepStrictEqual(idleUpdate.active, []);

          // Coordinator working alone (no working non-coordinator workers) does not count as swarming.
          setStatus(coordinatorId, "running");
          yield* emitRunStatus(coordinatorId, "running");
          yield* TestClock.adjust("300 millis");
          assert.deepStrictEqual((yield* swarm.activeSnapshot).active, []);

          // Resuming a worker re-activates the swarm and emits an update.
          setStatus(workerId, "running");
          yield* emitRunStatus(workerId, "running");
          yield* TestClock.adjust("300 millis");
          const resumedUpdate = yield* Queue.take(updates);
          assert.lengthOf(resumedUpdate.active, 1);
          assert.strictEqual(resumedUpdate.active[0]?.threadId, coordinatorId);

          // Marking the swarm done removes it even if a worker shell still reports running.
          yield* swarm.post(coordinatorId, { text: "[done] finished" });
          yield* TestClock.adjust("300 millis");
          const doneUpdate = yield* Queue.take(updates);
          assert.deepStrictEqual(doneUpdate.active, []);

          yield* Fiber.interrupt(watcher);
        }),
    ),
);

it.effect("setPlan preserves omitted fields on updates and requires goal on the first call", () =>
  withSwarmHarness(({ swarm, coordinatorId }) =>
    Effect.gen(function* () {
      const missingGoal = yield* Effect.result(
        swarm.setPlan(coordinatorId, { tasks: { worker: "first piece" } }),
      );
      assert.strictEqual(missingGoal._tag, "Failure");

      yield* swarm.setPlan(coordinatorId, {
        goal: { title: "Ship Wave 2", line: "Complete all Wave 2 tracks." },
        tasks: { worker: "build assets" },
        threads: [{ id: "wave-2", title: "Wave 2", goal: "Art & QA", tasks: ["worker"] }],
      });

      // Updating only tasks keeps existing goal and threads intact.
      yield* swarm.setPlan(coordinatorId, {
        tasks: { worker: "build assets", reviewer: "verify assets" },
      });
      const afterTaskUpdate = (yield* swarm.snapshot(coordinatorId))?.plan;
      assert.deepStrictEqual(afterTaskUpdate, {
        goal: { title: "Ship Wave 2", line: "Complete all Wave 2 tracks." },
        tasks: { worker: "build assets", reviewer: "verify assets" },
        threads: [{ id: "wave-2", title: "Wave 2", goal: "Art & QA", tasks: ["worker"] }],
      });

      // Passing threads: [] explicitly clears groups while keeping goal and tasks.
      yield* swarm.setPlan(coordinatorId, { threads: [] });
      const afterClearThreads = (yield* swarm.snapshot(coordinatorId))?.plan;
      assert.deepStrictEqual(afterClearThreads, {
        goal: { title: "Ship Wave 2", line: "Complete all Wave 2 tracks." },
        tasks: { worker: "build assets", reviewer: "verify assets" },
        threads: [],
      });
    }),
  ),
);

it.effect(
  "coordinator wakes carry coordinator guidance and active coordinator tracks live workers",
  () =>
    withSwarmHarness(({ swarm, coordinatorId, workerId, stateDir, sent, setStatus }) =>
      Effect.gen(function* () {
        // Harness starts with one live worker, so coordinator is active and worker is not.
        assert.isTrue(AgySwarm.isActiveSwarmCoordinator(stateDir, coordinatorId));
        assert.isFalse(AgySwarm.isActiveSwarmCoordinator(stateDir, workerId));

        // Waking the coordinator includes coordinator guidance; waking a worker does not.
        yield* swarm.post(workerId, { text: "@coordinator [done] finished task" });
        const coordWake = sent.find((entry) => entry.threadId === coordinatorId);
        assert.isDefined(coordWake);
        assert.include(coordWake!.text, "do not enter plan mode");

        setStatus(workerId, "completed");
        yield* swarm.post(coordinatorId, { text: "@worker please run follow-up" });
        const workerWake = sent.find((entry) => entry.threadId === workerId);
        assert.isDefined(workerWake);
        assert.notInclude(workerWake!.text, "do not enter plan mode");

        // Killing the last live worker deactivates coordinator reminder; adding a new worker re-enables it.
        yield* swarm.kill(coordinatorId, "worker");
        assert.isFalse(AgySwarm.isActiveSwarmCoordinator(stateDir, coordinatorId));

        yield* swarm.add(coordinatorId, { name: "worker-2", brief: "next wave" });
        assert.isTrue(AgySwarm.isActiveSwarmCoordinator(stateDir, coordinatorId));

        // Marking the swarm done deactivates coordinator reminder.
        yield* swarm.post(coordinatorId, { text: "[done] all complete" });
        assert.isFalse(AgySwarm.isActiveSwarmCoordinator(stateDir, coordinatorId));
      }),
    ),
);

it.effect(
  "wakes are self-sufficient when unread posts fit and fall back to read_board when huge",
  () =>
    withSwarmHarness(({ swarm, coordinatorId, workerId, sent, setStatus }) =>
      Effect.gen(function* () {
        // Unread non-mention post followed by a mention: wake delivers both and advances lastReadSeq.
        yield* swarm.post(workerId, { text: "intermediate progress log" });
        yield* swarm.post(workerId, { text: "@coordinator [done] all green" });

        assert.lengthOf(sent, 1);
        assert.include(sent[0]!.text, "intermediate progress log");
        assert.include(sent[0]!.text, "[done] all green");
        assert.include(sent[0]!.text, "no need to call read_board");

        // Coordinator is already caught up, so read_board returns no new posts.
        const readAfterWake = yield* swarm.read(coordinatorId, {});
        assert.strictEqual(readAfterWake.posts, "(no new posts)");

        // Huge unread payload exceeds WAKE_MAX_CHARS: wake truncates and tells coordinator to read_board.
        setStatus(coordinatorId, "running");
        const huge = "x".repeat(4_000);
        yield* swarm.post(workerId, { text: `part 1 ${huge}` });
        yield* swarm.post(workerId, { text: `@coordinator part 2 ${huge}` });
        setStatus(coordinatorId, "completed");
        yield* swarm.post(workerId, { text: "@coordinator ping" });

        assert.lengthOf(sent, 2);
        assert.include(sent[1]!.text, "Catch up on earlier unread posts with read_board");
      }),
    ),
);

it.effect(
  "immediately alerts coordinator on worker failure even while another worker is busy",
  () =>
    withSwarmHarness(
      ({ swarm, coordinatorId, workerId, sent, setStatus, emitRunStatus, nextWake }) =>
        Effect.gen(function* () {
          // Add a second worker that remains running while the first worker fails.
          yield* swarm.add(coordinatorId, { name: "worker-2", brief: "keep going" });
          const snap = yield* swarm.snapshot(coordinatorId);
          const workerBrief = snap!.posts.find((post) => post.kind === "brief");
          assert.strictEqual(workerBrief?.from, "coordinator");
          assert.include(workerBrief?.text ?? "", "@worker do work");

          const wake = nextWake();
          setStatus(workerId, "failed");
          yield* emitRunStatus(workerId, "failed");
          yield* wake;

          assert.lengthOf(sent, 1);
          assert.strictEqual(sent[0]!.threadId, coordinatorId);
          assert.include(sent[0]!.text, "[error] worker failed:");

          // Duplicate run.updated for the same failed runId does not emit a second alert.
          yield* emitRunStatus(workerId, "failed");
          yield* Effect.yieldNow;
          assert.lengthOf(sent, 1);
        }),
    ),
);

it.effect(
  "batch workers add launches in parallel outside the swarm lock and notes hidden channel mentions",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "agy-swarm-batch-" });
        const coordinatorId = ThreadId.make("thread:coordinator");
        const shells = new Map<ThreadId, OrchestrationV2ThreadShell>([
          [coordinatorId, makeShell(coordinatorId, "completed")],
        ]);
        const events = yield* PubSub.unbounded<OrchestrationV2DomainEvent>();
        const eventsSubscribed = yield* Deferred.make<void>();
        const gate = yield* Deferred.make<void>();
        let inFlight = 0;
        let maxInFlight = 0;
        let startedCount = 0;
        const twoInFlight = yield* Deferred.make<void>();

        const threads = {
          getThreadShell: (threadId: ThreadId) =>
            Effect.succeed(shells.get(threadId) ?? makeShell(threadId, "completed")),
          sendToThread: () => Effect.succeed({} as never),
          dispatch: () => Effect.succeed({} as never),
          streamDomainEvents: Stream.unwrap(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(events);
              yield* Deferred.succeed(eventsSubscribed, undefined);
              return Stream.fromSubscription(subscription);
            }),
          ),
        } as unknown as ThreadManagementService.ThreadManagementService["Service"];

        const launches = {
          launch: (input: { readonly threadId: ThreadId; readonly title: string }) =>
            Effect.gen(function* () {
              inFlight += 1;
              startedCount += 1;
              maxInFlight = Math.max(maxInFlight, inFlight);
              if (startedCount >= 2) yield* Deferred.succeed(twoInFlight, undefined);
              yield* Deferred.await(gate);
              inFlight -= 1;
              if (input.title.includes("broken")) {
                return yield* Effect.fail({ message: "simulated launch failure" } as never);
              }
              shells.set(input.threadId, makeShell(input.threadId, "running"));
              return {} as never;
            }),
        } as unknown as ThreadLaunchService.ThreadLaunchService["Service"];

        const providers = {
          getProviders: Effect.succeed([]),
        } as unknown as ProviderRegistry.ProviderRegistry["Service"];

        const gitWorkflow = {
          localStatus: () =>
            Effect.succeed({
              isRepo: true,
              hasPrimaryRemote: false,
              isDefaultRef: false,
              refName: null,
              hasWorkingTreeChanges: false,
              workingTree: { files: [], insertions: 0, deletions: 0 },
            }),
          repositoryRoot: () => Effect.succeed("/repo"),
          createWorktree: () =>
            Effect.succeed({ worktree: { path: "/repo-wt/batch", refName: "swarm/batch" } }),
          removeWorktree: () => Effect.void,
          deleteLocalBranch: () => Effect.void,
        } as unknown as GitWorkflowService.GitWorkflowService["Service"];

        const projects = {
          getById: () => Effect.succeedSome({ id: projectId, workspaceRoot: "/repo" }),
        } as unknown as ProjectService.ProjectService["Service"];

        const layer = AgySwarm.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ServerConfig.ServerConfig, {
                stateDir,
              } as ServerConfig.ServerConfig["Service"]),
              Layer.succeed(ThreadManagementService.ThreadManagementService, threads),
              Layer.succeed(ThreadLaunchService.ThreadLaunchService, launches),
              Layer.succeed(ProviderRegistry.ProviderRegistry, providers),
              Layer.succeed(GitWorkflowService.GitWorkflowService, gitWorkflow),
              Layer.succeed(ProjectService.ProjectService, projects),
            ),
          ),
        );

        const built = yield* Layer.build(layer);
        const swarm = Context.get(built, AgySwarm.AgySwarm);
        yield* Deferred.await(eventsSubscribed);
        yield* swarm.setTitle(coordinatorId, "Batch Test", undefined);
        yield* swarm.channel(coordinatorId, { op: "create", channel: "backend", topic: "API" });

        const addFiber = yield* Effect.forkChild(
          swarm.add(coordinatorId, {
            workers: [
              { name: "api", brief: "build endpoints", channels: ["backend"] },
              { name: "ui", brief: "build views" },
              { name: "broken", brief: "fails to boot" },
            ],
          }),
        );

        // Verify concurrent launches AND that board posts are NOT blocked while launches run.
        yield* Deferred.await(twoInFlight);
        assert.isAtLeast(maxInFlight, 2);
        const concurrentPost = yield* swarm.post(coordinatorId, { text: "board stays responsive" });
        assert.strictEqual(concurrentPost.seq, 1);

        yield* Deferred.succeed(gate, undefined);
        const result = yield* Fiber.join(addFiber);
        assert.include(result, "Added api, ui");
        assert.include(
          result,
          "Failed to launch: broken (Launch failed: simulated launch failure)",
        );

        // Posting in #backend mentioning @ui (not in #backend) returns a note instead of waking ui.
        const snap = yield* swarm.snapshot(coordinatorId);
        const apiId = snap!.members.find((member) => member.name === "api")!.threadId;
        const cross = yield* swarm.post(apiId, { text: "@ui secret", channel: "backend" });
        assert.include(cross.note ?? "", "@ui not in #backend");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.live(
  "guards dirty worktrees on kill unless force:true, supports fork+worktree, model/effort switching, and owns warnings",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "agy-swarm-phase3-" });
        const coordinatorId = ThreadId.make("thread:coordinator");
        const shells = new Map<ThreadId, OrchestrationV2ThreadShell>([
          [coordinatorId, makeShell(coordinatorId, "completed")],
        ]);
        const events = yield* PubSub.unbounded<OrchestrationV2DomainEvent>();
        const eventsSubscribed = yield* Deferred.make<void>();
        const dispatched: Array<Record<string, unknown>> = [];
        const sentMessages: Array<{ readonly threadId: ThreadId; readonly text: string }> = [];
        const createdWorktrees: Array<string> = [];
        const removedWorktrees: Array<string> = [];
        const deletedBranches: Array<string> = [];
        const dirtyWorktrees = new Set<string>();

        const threads = {
          getThreadShell: (threadId: ThreadId) =>
            Effect.succeed(shells.get(threadId) ?? makeShell(threadId, "completed")),
          sendToThread: (input: { readonly threadId: ThreadId; readonly text: string }) =>
            Effect.sync(() => {
              sentMessages.push({ threadId: input.threadId, text: input.text });
              return {} as never;
            }),
          dispatch: (command: Record<string, unknown>) =>
            Effect.sync(() => {
              dispatched.push(command);
              if (command.type === "thread.fork") {
                const targetId = command.targetThreadId as ThreadId;
                shells.set(targetId, makeShell(targetId, "completed"));
              }
              if (command.type === "thread.metadata.update") {
                const targetId = command.threadId as ThreadId;
                const current = shells.get(targetId) ?? makeShell(targetId, "completed");
                shells.set(targetId, {
                  ...current,
                  worktreePath: (command.worktreePath as string | null) ?? current.worktreePath,
                  branch: (command.branch as string | null) ?? current.branch,
                });
              }
              if (
                command.type === "thread.model-selection.set" ||
                command.type === "provider.switch"
              ) {
                const targetId = command.threadId as ThreadId;
                const selection = command.modelSelection as ModelSelection;
                const current = shells.get(targetId) ?? makeShell(targetId, "completed");
                shells.set(targetId, {
                  ...current,
                  providerInstanceId: selection.instanceId,
                  modelSelection: selection,
                });
              }
              return {} as never;
            }),
          streamDomainEvents: Stream.unwrap(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(events);
              yield* Deferred.succeed(eventsSubscribed, undefined);
              return Stream.fromSubscription(subscription);
            }),
          ),
        } as unknown as ThreadManagementService.ThreadManagementService["Service"];

        const launchedPrompts: string[] = [];
        const launches = {
          launch: (input: {
            readonly threadId: ThreadId;
            readonly title: string;
            readonly workspaceStrategy: { readonly type: string };
            readonly modelSelection: ModelSelection;
            readonly initialMessage?: { readonly text: string };
          }) =>
            Effect.sync(() => {
              if (input.initialMessage?.text) launchedPrompts.push(input.initialMessage.text);
              const isWt = input.workspaceStrategy.type === "worktree";
              const worktreePath = isWt ? `/repo-wt/${input.threadId}` : null;
              const branch = isWt ? `swarm/${input.threadId}` : null;
              const shell: OrchestrationV2ThreadShell = {
                ...makeShell(input.threadId, "completed"),
                modelSelection: input.modelSelection,
                providerInstanceId: input.modelSelection.instanceId,
                worktreePath,
                branch,
              };
              shells.set(input.threadId, shell);
              return {
                threadId: input.threadId,
                projection: { thread: shell },
                resumed: false,
              } as never;
            }),
        } as unknown as ThreadLaunchService.ThreadLaunchService["Service"];

        const providers = {
          getProviders: Effect.succeed([
            {
              instanceId: ProviderInstanceId.make("codex"),
              enabled: true,
              installed: true,
              models: [
                {
                  slug: "gpt-5",
                  name: "GPT-5",
                  isLegacy: false,
                  capabilities: {
                    optionDescriptors: [
                      {
                        id: "reasoningEffort",
                        label: "Effort",
                        type: "select",
                        role: "reasoning",
                        options: [
                          { id: "low", label: "Low" },
                          { id: "high", label: "High" },
                        ],
                      },
                    ],
                  },
                },
                { slug: "gpt-4-legacy", name: "GPT-4", isLegacy: true },
              ],
            },
            {
              instanceId: ProviderInstanceId.make("claude"),
              enabled: true,
              installed: true,
              models: [{ slug: "sonnet", name: "Sonnet", isLegacy: false }],
            },
          ]),
        } as unknown as ProviderRegistry.ProviderRegistry["Service"];

        const gitWorkflow = {
          localStatus: (input: { readonly cwd: string }) =>
            Effect.succeed({
              isRepo: true,
              hasPrimaryRemote: false,
              isDefaultRef: false,
              refName: null,
              hasWorkingTreeChanges: dirtyWorktrees.has(input.cwd),
              workingTree: {
                files: dirtyWorktrees.has(input.cwd)
                  ? [{ path: "src/a.ts", insertions: 3, deletions: 1 }]
                  : [],
                insertions: 3,
                deletions: 1,
              },
            }),
          repositoryRoot: () => Effect.succeed("/repo"),
          createWorktree: (input: { readonly newRefName?: string | null }) =>
            Effect.sync(() => {
              const wtPath = `/repo-wt/${input.newRefName ?? "fork"}`;
              createdWorktrees.push(wtPath);
              return { worktree: { path: wtPath, refName: input.newRefName ?? "swarm/fork" } };
            }),
          removeWorktree: (input: { readonly path: string }) =>
            Effect.sync(() => {
              removedWorktrees.push(input.path);
            }),
          deleteLocalBranch: (input: { readonly refName: string }) =>
            Effect.sync(() => {
              deletedBranches.push(input.refName);
            }),
        } as unknown as GitWorkflowService.GitWorkflowService["Service"];

        const projects = {
          getById: () => Effect.succeedSome({ id: projectId, workspaceRoot: "/repo" }),
        } as unknown as ProjectService.ProjectService["Service"];

        const layer = AgySwarm.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ServerConfig.ServerConfig, {
                stateDir,
              } as ServerConfig.ServerConfig["Service"]),
              Layer.succeed(ThreadManagementService.ThreadManagementService, threads),
              Layer.succeed(ThreadLaunchService.ThreadLaunchService, launches),
              Layer.succeed(ProviderRegistry.ProviderRegistry, providers),
              Layer.succeed(GitWorkflowService.GitWorkflowService, gitWorkflow),
              Layer.succeed(ProjectService.ProjectService, projects),
            ),
          ),
        );

        const built = yield* Layer.build(layer);
        const swarm = Context.get(built, AgySwarm.AgySwarm);
        yield* Deferred.await(eventsSubscribed);

        // 1. models() hides legacy by default, lists effort levels, and shows legacy with all:true.
        const defaultModels = yield* swarm.models(coordinatorId);
        assert.include(defaultModels, "gpt-5 [effort: low|high]");
        assert.notInclude(defaultModels, "gpt-4-legacy");
        const allModels = yield* swarm.models(coordinatorId, { all: true });
        assert.include(allModels, "gpt-4-legacy");

        // 2. add with owns overlap emits non-blocking warning on shared workspace.
        const first = yield* swarm.add(coordinatorId, {
          name: "editor-a",
          brief: "edit server",
          owns: ["apps/server/src"],
          reasoningEffort: "high",
        });
        assert.include(first, "codex/gpt-5 (high)");
        const overlapRes = yield* swarm.add(coordinatorId, {
          name: "editor-b",
          brief: "edit swarm",
          owns: ["apps/server/src/agy/swarm.ts"],
        });
        assert.include(overlapRes, "WARNING: ownership overlap on shared workspace");

        // 3. fork + workspace:"worktree" provisions and binds a real worktree.
        yield* swarm.add(coordinatorId, {
          name: "forked-wt",
          brief: "continue in isolated worktree",
          fork: "coordinator",
          workspace: "worktree",
        });
        assert.lengthOf(createdWorktrees, 1);
        const snap = yield* swarm.snapshot(coordinatorId);
        const forkedMember = snap!.members.find((member) => member.name === "forked-wt")!;
        assert.strictEqual(forkedMember.worktreePath, createdWorktrees[0]);
        assert.isNotNull(forkedMember.branch);

        // 4. Dirty worktree blocks kill until force:true, then removes worktree + branch.
        dirtyWorktrees.add(createdWorktrees[0]!);
        const dirtyErr = yield* swarm.kill(coordinatorId, "forked-wt").pipe(Effect.flip);
        assert.include(dirtyErr.reason, "1 uncommitted file(s)");
        assert.lengthOf(removedWorktrees, 0);

        const killed = yield* swarm.kill(coordinatorId, "forked-wt", { force: true });
        assert.include(killed, "Removed worktree(s) for: forked-wt");
        assert.deepStrictEqual(removedWorktrees, [createdWorktrees[0]!]);
        assert.deepStrictEqual(deletedBranches, [forkedMember.branch!]);

        // 5. setModel defaults to self when name omitted, uses direct dispatch without spurious turn,
        // auto-resumes stopped workers, and blocks cross-provider switch while working.
        const sentBefore = sentMessages.length;
        const selfSwitched = yield* swarm.setModel(coordinatorId, {
          model: "gpt-5",
          reasoningEffort: "low",
        });
        assert.include(selfSwitched, "coordinator now runs on codex/gpt-5 (low).");
        assert.strictEqual(sentMessages.length, sentBefore);
        assert.isTrue(
          dispatched.some(
            (cmd) => cmd.type === "thread.model-selection.set" && cmd.threadId === coordinatorId,
          ),
        );

        const editorAId = snap!.members.find((member) => member.name === "editor-a")!.threadId;
        shells.set(editorAId, makeShell(editorAId, "running"));
        const workingSwitchErr = yield* swarm
          .setModel(coordinatorId, { name: "editor-a", model: "claude/sonnet" })
          .pipe(Effect.flip);
        assert.include(workingSwitchErr.reason, "while it is working");

        shells.set(editorAId, makeShell(editorAId, "failed"));
        const resumedSwitch = yield* swarm.setModel(coordinatorId, {
          name: "editor-a",
          model: "claude/sonnet",
        });
        assert.include(resumedSwitch, "(resumed)");
        assert.strictEqual(sentMessages.length, sentBefore + 1);

        // 6. Phase 4 user actions: userPost, userRetry, loadPosts, and metrics accumulation.
        const userPosted = yield* swarm.userPost(editorAId, {
          text: "@editor-a Please double check edge cases",
        });
        assert.include(userPosted.mentions, "editor-a");

        shells.set(editorAId, makeShell(editorAId, "failed"));
        const retried = yield* swarm.userRetry(coordinatorId, {
          name: "editor-a",
          message: "Try again after lint fix",
        });
        assert.include(retried, "Retried editor-a");
        assert.include(sentMessages.at(-1)?.text ?? "", "Try again after lint fix");

        const snapAfterActions = yield* swarm.snapshot(coordinatorId);
        assert.isNotNull(snapAfterActions);
        assert.isAtLeast(snapAfterActions!.totalPostCount ?? 0, snapAfterActions!.posts.length);
        assert.strictEqual(snapAfterActions!.oldestIncludedSeq, snapAfterActions!.posts[0]?.seq);

        const olderPage = yield* swarm.loadPosts(coordinatorId, {
          beforeSeq: snapAfterActions!.head,
          limit: 2,
        });
        assert.lengthOf(olderPage.posts, 2);
        assert.isTrue(olderPage.hasMore);

        // Emit provider-turn.updated + run.updated and verify deduped metrics accumulation.
        yield* Deferred.await(eventsSubscribed);
        const initialReady = yield* Deferred.make<void>();
        const metricsReady = yield* Deferred.make<AgySwarmSnapshot>();
        const metricsWatcher = yield* Effect.forkScoped(
          Stream.runForEach(swarm.changes(coordinatorId), (snap) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(initialReady, undefined);
              if (snap !== null && snap.metrics?.turns === 1 && snap.metrics?.totalTokens === 220) {
                yield* Deferred.succeed(metricsReady, snap);
              }
            }),
          ),
        );
        yield* Deferred.await(initialReady);
        const turnEventBase = {
          sequence: 1,
          eventId: "evt-1" as never,
          threadId: editorAId,
          projectId,
          occurredAt: "2026-01-01T00:00:00.000Z" as never,
          commandId: null,
          causationEventId: null,
        };
        yield* PubSub.publish(events, {
          ...turnEventBase,
          type: "provider-turn.updated",
          payload: {
            id: "pt-1" as never,
            providerThreadId: "pth-1" as never,
            nodeId: "node-1" as never,
            runAttemptId: null,
            nativeTurnRef: null,
            ordinal: 1 as never,
            status: "running",
            startedAt: null,
            completedAt: null,
            turnTokenUsage: {
              usageStatus: "complete",
              inputTokens: 100 as never,
              outputTokens: 40 as never,
              cachedInputTokens: 20 as never,
              reasoningTokens: 10 as never,
            },
          },
        } as unknown as OrchestrationV2DomainEvent);
        // Same provider turn updated again with higher totals: only delta should be added.
        yield* PubSub.publish(events, {
          ...turnEventBase,
          sequence: 2,
          type: "provider-turn.updated",
          payload: {
            id: "pt-1" as never,
            providerThreadId: "pth-1" as never,
            nodeId: "node-1" as never,
            runAttemptId: null,
            nativeTurnRef: null,
            ordinal: 1 as never,
            status: "completed",
            startedAt: null,
            completedAt: null,
            turnTokenUsage: {
              usageStatus: "complete",
              inputTokens: 150 as never,
              outputTokens: 70 as never,
              cachedInputTokens: 25 as never,
              reasoningTokens: 15 as never,
            },
          },
        } as unknown as OrchestrationV2DomainEvent);
        yield* PubSub.publish(events, {
          ...turnEventBase,
          sequence: 3,
          type: "run.updated",
          payload: {
            id: "run-metrics-1" as never,
            status: "completed",
          },
        } as unknown as OrchestrationV2DomainEvent);
        const snapWithMetrics = yield* Deferred.await(metricsReady);
        yield* Fiber.interrupt(metricsWatcher);
        const editorMetrics = snapWithMetrics.members.find((m) => m.name === "editor-a")?.metrics;
        assert.strictEqual(editorMetrics?.turns, 1);
        assert.strictEqual(editorMetrics?.inputTokens, 150);
        assert.strictEqual(editorMetrics?.outputTokens, 70);
        assert.strictEqual(editorMetrics?.cachedInputTokens, 25);
        assert.strictEqual(editorMetrics?.reasoningTokens, 15);
        assert.strictEqual(editorMetrics?.totalTokens, 220);
        assert.strictEqual(snapWithMetrics?.metrics?.totalTokens, 220);
        assert.strictEqual(snapWithMetrics?.metrics?.turns, 1);

        // 7. Teamwork & Boost upgrades: kind tracking, readOnly, scratchDir, delegated manager, rich plan.
        assert.strictEqual(AgySwarm.activeSwarmKind(stateDir, coordinatorId), "swarm");
        yield* swarm.setTitle(coordinatorId, "Teamwork Upgrade", "teamwork");
        assert.strictEqual(AgySwarm.activeSwarmKind(stateDir, coordinatorId), "teamwork");

        const readOnlyWtErr = yield* swarm
          .add(coordinatorId, {
            name: "bad-ro",
            brief: "invalid combo",
            readOnly: true,
            workspace: "worktree",
          })
          .pipe(Effect.flip);
        assert.include(readOnlyWtErr.reason, "Read-only worker");

        yield* swarm.add(coordinatorId, {
          name: "auditor",
          brief: "Inspect everything read-only",
          readOnly: true,
        });
        const auditorMsg = launchedPrompts.at(-1) ?? "";
        assert.include(auditorMsg, "<read_only_worker>");
        assert.include(auditorMsg, "Scratch directory:");

        // Ordinary worker cannot manage swarm, create channels, set plan, or grant manager:true.
        const workerMgrErr = yield* swarm
          .add(editorAId, { name: "rogue-mgr", brief: "escalate", manager: true })
          .pipe(Effect.flip);
        assert.include(workerMgrErr.reason, "delegated manager");
        const workerPlanErr = yield* swarm
          .setPlan(editorAId, { goal: { title: "Unauthorized", line: "Should be rejected" } })
          .pipe(Effect.flip);
        assert.include(workerPlanErr.reason, "delegated manager");
        const workerChanErr = yield* swarm
          .channel(editorAId, { op: "create", channel: "rogue" })
          .pipe(Effect.flip);
        assert.include(workerChanErr.reason, "delegated manager");

        // Delegated manager can set rich plan, manage channels, spawn successor manager, and kill workers (not coordinator).
        yield* swarm.add(coordinatorId, {
          name: "orchestrator",
          brief: "Drive milestones",
          manager: true,
        });
        assert.include(launchedPrompts.at(-1) ?? "", "<swarm_manager>");

        const snapBeforeMgr = yield* swarm.snapshot(coordinatorId);
        const auditorMember = snapBeforeMgr!.members.find((m) => m.name === "auditor")!;
        const orchestratorMember = snapBeforeMgr!.members.find((m) => m.name === "orchestrator")!;
        assert.isTrue(auditorMember.readOnly);
        assert.isTrue(orchestratorMember.canManage);
        assert.isDefined(auditorMember.scratchDir);
        assert.isTrue(yield* fs.exists(auditorMember.scratchDir!));

        const orchestratorId = orchestratorMember.threadId;
        yield* swarm.setPlan(orchestratorId, {
          goal: { title: "Ship Teamwork v2", line: "3 review gates + final audit" },
          mode: "general",
          integrityMode: "development",
          projectDir: "/repo",
          artifacts: [{ label: "Plan", path: "/repo/plan.md" }],
          milestones: [
            {
              id: "m1",
              title: "Foundation",
              status: "passed",
              gates: { critic: "passed", challenger: "passed", auditor: "passed" },
            },
            {
              id: "m2",
              title: "Verification",
              status: "verifying",
              gates: { critic: "passed", challenger: "running", auditor: "pending" },
            },
          ],
          rounds: [{ round: 0, status: "fixed", worker: "editor-a", summary: "Initial pass" }],
          finalAudit: { status: "running", summary: "Auditing build" },
        });
        yield* swarm.channel(orchestratorId, { op: "create", channel: "milestone-2" });
        yield* swarm.add(orchestratorId, {
          name: "orchestrator-2",
          brief: "Take over milestone 2",
          manager: true,
        });
        const killCoordErr = yield* swarm.kill(orchestratorId, "coordinator").pipe(Effect.flip);
        assert.include(killCoordErr.reason, "coordinator");
        yield* swarm.kill(orchestratorId, "editor-b");

        const snapAfterMgr = yield* swarm.snapshot(coordinatorId);
        assert.strictEqual(snapAfterMgr?.plan?.integrityMode, "development");
        assert.lengthOf(snapAfterMgr?.plan?.milestones ?? [], 2);
        assert.lengthOf(snapAfterMgr?.plan?.rounds ?? [], 1);
        assert.strictEqual(snapAfterMgr?.plan?.finalAudit?.status, "running");
        assert.isTrue(
          snapAfterMgr?.members.find((m) => m.name === "orchestrator-2")?.canManage === true,
        );

        const statusText = yield* swarm.status(coordinatorId);
        assert.include(statusText, "(teamwork)");
        assert.include(statusText, "worker, manager,");
        assert.include(statusText, "worker, read-only,");
        assert.include(statusText, "milestones=1/2");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("wakes a parked swarm_wait immediately when the waiting member is killed", () =>
  withSwarmHarness(({ swarm, coordinatorId, workerId }) =>
    Effect.gen(function* () {
      const waitFiber = yield* Effect.forkChild(
        swarm.wait(workerId, { timeoutSeconds: 45, mentionsOnly: true }),
      );
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      yield* swarm.kill(coordinatorId, "worker");

      // Must resolve immediately on kill without advancing the 45s wait timer.
      const waited = yield* Fiber.join(waitFiber);
      assert.isFalse(waited.timedOut);
      assert.strictEqual(waited.posts, "(nothing yet)");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "still notifies parked waiters and removes temp file when snapshot rename fails transiently",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const realFs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const stateDir = yield* realFs.makeTempDirectoryScoped({ prefix: "agy-swarm-save-" });
        const coordinatorId = ThreadId.make("thread:coordinator-save");
        const shells = new Map<ThreadId, OrchestrationV2ThreadShell>([
          [coordinatorId, makeShell(coordinatorId, "completed")],
        ]);
        const events = yield* PubSub.unbounded<OrchestrationV2DomainEvent>();
        const eventsSubscribed = yield* Deferred.make<void>();
        let failNextRename = false;

        const flakyFs: FileSystem.FileSystem = {
          ...realFs,
          rename: (oldPath, newPath) => {
            if (failNextRename) {
              failNextRename = false;
              return Effect.fail(new Error("EPERM: transient antivirus lock") as never);
            }
            return realFs.rename(oldPath, newPath);
          },
        };

        const threads = {
          getThreadShell: (threadId: ThreadId) =>
            Effect.succeed(shells.get(threadId) ?? makeShell(threadId, "completed")),
          sendToThread: () => Effect.succeed({} as never),
          dispatch: () => Effect.succeed({} as never),
          streamDomainEvents: Stream.unwrap(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(events);
              yield* Deferred.succeed(eventsSubscribed, undefined);
              return Stream.fromSubscription(subscription);
            }),
          ),
        } as unknown as ThreadManagementService.ThreadManagementService["Service"];
        const launches = {
          launch: (input: { readonly threadId: ThreadId }) =>
            Effect.sync(() => {
              shells.set(input.threadId, makeShell(input.threadId, "running"));
              return {} as never;
            }),
        } as unknown as ThreadLaunchService.ThreadLaunchService["Service"];
        const providers = {
          getProviders: Effect.succeed([]),
        } as unknown as ProviderRegistry.ProviderRegistry["Service"];
        const gitWorkflow = {
          localStatus: () =>
            Effect.succeed({
              isRepo: true,
              hasPrimaryRemote: false,
              isDefaultRef: false,
              refName: null,
              hasWorkingTreeChanges: false,
              workingTree: { files: [], insertions: 0, deletions: 0 },
            }),
          repositoryRoot: () => Effect.succeed("/repo"),
          createWorktree: () =>
            Effect.succeed({ worktree: { path: "/repo-wt/tmp", refName: "swarm/tmp" } }),
          removeWorktree: () => Effect.void,
          deleteLocalBranch: () => Effect.void,
        } as unknown as GitWorkflowService.GitWorkflowService["Service"];
        const projects = {
          getById: () => Effect.succeedSome({ id: projectId, workspaceRoot: "/repo" }),
        } as unknown as ProjectService.ProjectService["Service"];

        const layer = AgySwarm.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(FileSystem.FileSystem, flakyFs),
              Layer.succeed(ServerConfig.ServerConfig, {
                stateDir,
              } as ServerConfig.ServerConfig["Service"]),
              Layer.succeed(ThreadManagementService.ThreadManagementService, threads),
              Layer.succeed(ThreadLaunchService.ThreadLaunchService, launches),
              Layer.succeed(ProviderRegistry.ProviderRegistry, providers),
              Layer.succeed(GitWorkflowService.GitWorkflowService, gitWorkflow),
              Layer.succeed(ProjectService.ProjectService, projects),
            ),
          ),
        );
        const built = yield* Layer.build(layer);
        const swarm = Context.get(built, AgySwarm.AgySwarm);
        yield* Deferred.await(eventsSubscribed);
        yield* swarm.add(coordinatorId, { name: "worker", brief: "listen" });
        const snap = yield* swarm.snapshot(coordinatorId);
        const workerId = snap!.members.find((m) => m.name === "worker")!.threadId;

        const waitFiber = yield* Effect.forkChild(
          swarm.wait(workerId, { timeoutSeconds: 45, mentionsOnly: true }),
        );
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;

        failNextRename = true;
        yield* swarm.post(coordinatorId, { text: "@worker wake despite disk error" });

        const waited = yield* Fiber.join(waitFiber);
        assert.isFalse(waited.timedOut);
        assert.include(waited.posts, "wake despite disk error");

        const files = yield* realFs.readDirectory(path.join(stateDir, "agy", "swarms"));
        assert.isFalse(
          files.some((file) => file.includes(".tmp")),
          `expected no orphaned .tmp files, found: ${files.join(", ")}`,
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("cleans up forked worktree and branch when delivering the initial brief fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "agy-swarm-fork-cleanup-" });
      const coordinatorId = ThreadId.make("thread:coordinator-fork-cleanup");
      const shells = new Map<ThreadId, OrchestrationV2ThreadShell>([
        [coordinatorId, makeShell(coordinatorId, "completed")],
      ]);
      const events = yield* PubSub.unbounded<OrchestrationV2DomainEvent>();
      const eventsSubscribed = yield* Deferred.make<void>();
      const createdWorktrees: Array<string> = [];
      const removedWorktrees: Array<string> = [];
      const deletedBranches: Array<string> = [];

      const threads = {
        getThreadShell: (threadId: ThreadId) =>
          Effect.succeed(shells.get(threadId) ?? makeShell(threadId, "completed")),
        sendToThread: () =>
          Effect.fail(new AgySwarm.AgySwarmError({ reason: "simulated brief delivery failure" })),
        dispatch: () => Effect.succeed({} as never),
        streamDomainEvents: Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(events);
            yield* Deferred.succeed(eventsSubscribed, undefined);
            return Stream.fromSubscription(subscription);
          }),
        ),
      } as unknown as ThreadManagementService.ThreadManagementService["Service"];
      const launches = {
        launch: () => Effect.succeed({} as never),
        forkThread: (input: { readonly threadId: ThreadId }) =>
          Effect.sync(() => {
            const shell = makeShell(input.threadId, "completed");
            shells.set(input.threadId, shell);
            return {
              threadId: input.threadId,
              projection: { thread: shell },
              resumed: false,
            } as never;
          }),
      } as unknown as ThreadLaunchService.ThreadLaunchService["Service"];
      const providers = {
        getProviders: Effect.succeed([]),
      } as unknown as ProviderRegistry.ProviderRegistry["Service"];
      const gitWorkflow = {
        localStatus: () =>
          Effect.succeed({
            isRepo: true,
            hasPrimaryRemote: false,
            isDefaultRef: false,
            refName: null,
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
          }),
        repositoryRoot: () => Effect.succeed("/repo"),
        createWorktree: (input: { readonly newRefName?: string | null }) =>
          Effect.sync(() => {
            const wtPath = `/repo-wt/${input.newRefName ?? "fork"}`;
            createdWorktrees.push(wtPath);
            return { worktree: { path: wtPath, refName: input.newRefName ?? "swarm/fork" } };
          }),
        removeWorktree: (input: { readonly path: string }) =>
          Effect.sync(() => {
            removedWorktrees.push(input.path);
          }),
        deleteLocalBranch: (input: { readonly refName: string }) =>
          Effect.sync(() => {
            deletedBranches.push(input.refName);
          }),
      } as unknown as GitWorkflowService.GitWorkflowService["Service"];
      const projects = {
        getById: () => Effect.succeedSome({ id: projectId, workspaceRoot: "/repo" }),
      } as unknown as ProjectService.ProjectService["Service"];

      const layer = AgySwarm.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ServerConfig.ServerConfig, {
              stateDir,
            } as ServerConfig.ServerConfig["Service"]),
            Layer.succeed(ThreadManagementService.ThreadManagementService, threads),
            Layer.succeed(ThreadLaunchService.ThreadLaunchService, launches),
            Layer.succeed(ProviderRegistry.ProviderRegistry, providers),
            Layer.succeed(GitWorkflowService.GitWorkflowService, gitWorkflow),
            Layer.succeed(ProjectService.ProjectService, projects),
          ),
        ),
      );
      const built = yield* Layer.build(layer);
      const swarm = Context.get(built, AgySwarm.AgySwarm);
      yield* Deferred.await(eventsSubscribed);

      const err = yield* swarm
        .add(coordinatorId, {
          name: "forked-fail",
          brief: "should fail on send",
          fork: "coordinator",
          workspace: "worktree",
        })
        .pipe(Effect.flip);
      assert.include(err.reason, "simulated brief delivery failure");
      assert.lengthOf(createdWorktrees, 1);
      assert.deepStrictEqual(removedWorktrees, createdWorktrees);
      assert.lengthOf(deletedBranches, 1);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
