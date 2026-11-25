// Fork: the swarm board of a thread and environment-wide active swarm state.
// Kept apart from the upstream state modules so merges stay clean.
import {
  AGY_WS_METHODS,
  type AgyActiveSwarmsSnapshot,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

const EMPTY_ACTIVE_SWARMS: ReadonlyMap<string, string> = new Map();

function activeSwarmKey(thread: {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
}): string {
  return `${thread.environmentId}:${thread.id}`;
}

export function activeSwarmEnvironmentIdsKey(environmentIds: Iterable<EnvironmentId>): string {
  const unique = [...new Set(environmentIds)].sort();
  return JSON.stringify(unique);
}

export function hasActiveSwarm(
  activeSwarms: ReadonlyMap<string, string> | undefined,
  thread: { readonly environmentId: EnvironmentId; readonly id: ThreadId },
): boolean {
  return activeSwarms?.has(activeSwarmKey(thread)) === true;
}

export function extractActiveSwarmStartedAt(
  result: AsyncResult.AsyncResult<AgyActiveSwarmsSnapshot, unknown>,
  threadId: ThreadId,
): string | null {
  const snapshot = Option.getOrUndefined(AsyncResult.value(result));
  if (snapshot === undefined) return null;
  for (const entry of snapshot.active) {
    if (entry.threadId === threadId) return entry.startedAt;
  }
  return null;
}

function mapsEqual(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

export function createAgySwarmEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const activeSwarms = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:agy:swarm:active",
    tag: AGY_WS_METHODS.swarmActiveSubscribe,
    idleTtlMs: 30_000,
  });

  const activeSwarmsAcross = Atom.family((environmentIdsKey: string) => {
    const environmentIds = JSON.parse(environmentIdsKey) as EnvironmentId[];
    if (environmentIds.length === 0) {
      return Atom.make(EMPTY_ACTIVE_SWARMS).pipe(
        Atom.withLabel("environment-data:agy:swarm:active-across:empty"),
      );
    }
    const sources = environmentIds.map((environmentId) => ({
      environmentId,
      atom: activeSwarms({ environmentId, input: {} }),
    }));
    let previous: ReadonlyMap<string, string> = EMPTY_ACTIVE_SWARMS;
    return Atom.make((get): ReadonlyMap<string, string> => {
      const next = new Map<string, string>();
      for (const { environmentId, atom } of sources) {
        const snapshot = Option.getOrUndefined(AsyncResult.value(get(atom)));
        if (snapshot === undefined) continue;
        for (const entry of snapshot.active) {
          next.set(`${environmentId}:${entry.threadId}`, entry.startedAt);
        }
      }
      if (next.size === 0) {
        previous = EMPTY_ACTIVE_SWARMS;
        return EMPTY_ACTIVE_SWARMS;
      }
      if (mapsEqual(previous, next)) return previous;
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`environment-data:agy:swarm:active-across:${environmentIdsKey}`));
  });

  return {
    // Emits the swarm the thread belongs to now and on every change, or null when it is in none.
    swarm: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:agy:swarm",
      tag: AGY_WS_METHODS.swarmSubscribe,
      idleTtlMs: 30_000,
    }),
    // Emits active coordinator threads across one environment on state transitions.
    activeSwarms,
    // Aggregated map of `${environmentId}:${threadId}` -> active start timestamp across environments.
    activeSwarmsAcross,
    post: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:agy:swarm:post",
      tag: AGY_WS_METHODS.swarmPost,
    }),
    kill: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:agy:swarm:kill",
      tag: AGY_WS_METHODS.swarmKill,
    }),
    retry: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:agy:swarm:retry",
      tag: AGY_WS_METHODS.swarmRetry,
    }),
    add: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:agy:swarm:add",
      tag: AGY_WS_METHODS.swarmAdd,
    }),
    loadPosts: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:agy:swarm:load-posts",
      tag: AGY_WS_METHODS.swarmLoadPosts,
    }),
  };
}
