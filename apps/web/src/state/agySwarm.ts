// Fork: the swarm board of a thread and environment-wide active swarm state, read live.
import { useAtomValue } from "@effect/atom-react";
import {
  activeSwarmEnvironmentIdsKey,
  createAgySwarmEnvironmentAtoms,
  extractActiveSwarmStartedAt,
} from "@t3tools/client-runtime/state/agy-swarm";
import type { AgySwarmSnapshot, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMessages } from "gt-react";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

const agySwarmEnvironment = createAgySwarmEnvironmentAtoms(connectionAtomRuntime);

export interface AgySwarmView {
  /** Null while loading and when the thread is in no swarm; `loaded` tells them apart. */
  readonly swarm: AgySwarmSnapshot | null;
  readonly loaded: boolean;
  readonly error: string | null;
}

export function useAgySwarm(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): AgySwarmView {
  const resolve = useMessages();
  const query = useEnvironmentQuery(
    environmentId === null || threadId === null
      ? null
      : agySwarmEnvironment.swarm({ environmentId, input: { threadId } }),
    resolve,
  );
  return { swarm: query.data, loaded: query.isSuccess, error: query.error };
}

export function useActiveSwarmThreads(
  environmentIds: Iterable<EnvironmentId>,
): ReadonlyMap<string, string> {
  return useAtomValue(
    agySwarmEnvironment.activeSwarmsAcross(activeSwarmEnvironmentIdsKey(environmentIds)),
  );
}

export function useActiveSwarmStartedAt(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): string | null {
  return useAtomValue(agySwarmEnvironment.activeSwarms({ environmentId, input: {} }), (result) =>
    extractActiveSwarmStartedAt(result, threadId),
  );
}
