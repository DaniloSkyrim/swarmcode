import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as AgySwarm from "../../../agy/swarm/AgySwarm.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { SwarmToolkit } from "./tools.ts";

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const required = <A>(value: A | undefined, name: string) =>
  value === undefined
    ? Effect.fail(invalid(`This action needs \`${name}\`.`))
    : Effect.succeed(value);

/** The calling thread and the swarm service, with swarm refusals as invalid requests. */
const asCaller = Effect.fn("SwarmHandlers.asCaller")(function* <A>(
  use: (
    swarm: AgySwarm.AgySwarmShape,
    threadId: ThreadId,
  ) => Effect.Effect<A, AgySwarm.AgySwarmError | OrchestratorMcpFailure>,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const thread = yield* McpInvocationContext.requireThreadScope(scope, "The swarm");
  const swarm = yield* AgySwarm.AgySwarm;
  return yield* use(swarm, thread.thread.threadId).pipe(
    Effect.mapError((error) => (error._tag === "AgySwarmError" ? invalid(error.message) : error)),
  );
});

export const layer = McpToolAccess.toLayer(SwarmToolkit, {
  t3_swarm: McpToolAccess.actsAsCaller((input) =>
    asCaller((swarm, threadId) =>
      Effect.gen(function* () {
        switch (input.action) {
          case "status":
            return { result: yield* swarm.status(threadId) };
          case "models":
            return { result: yield* swarm.models(threadId, { all: input.all }) };
          case "add": {
            if (input.workers !== undefined) {
              if (
                input.name !== undefined ||
                input.brief !== undefined ||
                input.n !== undefined ||
                input.workerTasks !== undefined
              ) {
                return yield* invalid(
                  "Pass either `workers` for a batch or `name`/`brief` for a single/numbered add, not both.",
                );
              }
              return { result: yield* swarm.add(threadId, { workers: input.workers }) };
            }
            const tasks = input.workerTasks;
            return {
              result: yield* swarm.add(threadId, {
                name: yield* required(input.name, "name"),
                brief: yield* required(input.brief, "brief"),
                model: input.model,
                reasoningEffort: input.reasoningEffort,
                n: input.n ?? tasks?.length,
                tasks,
                fork: input.fork,
                workspace: input.workspace,
                channels: input.channels,
                owns: input.owns,
                readOnly: input.readOnly,
                manager: input.manager,
              }),
            };
          }
          case "kill":
            return {
              result: yield* swarm.kill(threadId, yield* required(input.name, "name"), {
                force: input.force,
              }),
            };
          case "model":
            return {
              result: yield* swarm.setModel(threadId, {
                name: input.name,
                model: yield* required(input.model, "model"),
                reasoningEffort: input.reasoningEffort,
                resume: input.resume,
              }),
            };
          case "title":
            return {
              result: yield* swarm.setTitle(
                threadId,
                yield* required(input.title, "title"),
                input.kind,
              ),
            };
          case "plan": {
            const tasks =
              input.planTasks === undefined
                ? undefined
                : Object.fromEntries(input.planTasks.map((entry) => [entry.worker, entry.summary]));
            return {
              result: yield* swarm.setPlan(threadId, {
                goal: input.goal,
                tasks,
                threads: input.threads,
                mode: input.mode,
                integrityMode: input.integrityMode,
                projectDir: input.projectDir,
                artifacts: input.artifacts,
                milestones: input.milestones,
                rounds: input.rounds,
                finalAudit: input.finalAudit,
              }),
            };
          }
          case "channel":
            return {
              result: yield* swarm.channel(threadId, {
                op: yield* required(input.op, "op"),
                channel: input.channel,
                topic: input.topic,
                name: input.name,
              }),
            };
        }
      }),
    ),
  ),
  post_message: McpToolAccess.actsAsCaller((input) =>
    asCaller((swarm, threadId) =>
      swarm.post(threadId, { text: input.text, channel: input.channel }).pipe(
        Effect.map((result) => ({
          seq: result.seq,
          mentions: [...result.mentions],
          ...(result.note === undefined ? {} : { note: result.note }),
        })),
      ),
    ),
  ),
  read_board: McpToolAccess.readsAsCaller((input) =>
    asCaller((swarm, threadId) =>
      swarm.read(threadId, {
        since: input.since,
        channel: input.channel,
        limit: input.limit,
        seqs: input.seqs,
        includeBriefs: input.includeBriefs,
        includeSystem: input.includeSystem,
      }),
    ),
  ),
  swarm_wait: McpToolAccess.readsAsCaller((input) =>
    asCaller((swarm, threadId) =>
      swarm.wait(threadId, {
        since: input.since,
        mentionsOnly: input.mentions_only,
        timeoutSeconds: input.timeout,
      }),
    ),
  ),
} satisfies McpToolAccess.Handlers<typeof SwarmToolkit.tools>);
