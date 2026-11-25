// Fork: environment-wide active swarm state on mobile, shared with web via client-runtime.
import { useAtomValue } from "@effect/atom-react";
import {
  activeSwarmEnvironmentIdsKey,
  createAgySwarmEnvironmentAtoms,
  extractActiveSwarmStartedAt,
} from "@t3tools/client-runtime/state/agy-swarm";
import type { AgySwarmSnapshot, EnvironmentId, ThreadId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

export const agySwarmEnvironment = createAgySwarmEnvironmentAtoms(connectionAtomRuntime);

export interface AgySwarmView {
  readonly swarm: AgySwarmSnapshot | null;
  readonly loaded: boolean;
  readonly error: string | null;
}

export function useAgySwarm(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): AgySwarmView {
  const query = useEnvironmentQuery(
    environmentId === null || threadId === null
      ? null
      : agySwarmEnvironment.swarm({ environmentId, input: { threadId } }),
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
