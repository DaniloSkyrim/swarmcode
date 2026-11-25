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
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
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

      const layer = AgySwarm.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ServerConfig.ServerConfig, {
              stateDir,
            } as ServerConfig.ServerConfig["Service"]),
            Layer.succeed(ThreadManagementService.ThreadManagementService, threads),
            Layer.succeed(ThreadLaunchService.ThreadLaunchService, launches),
            Layer.succeed(ProviderRegistry.ProviderRegistry, providers),
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
