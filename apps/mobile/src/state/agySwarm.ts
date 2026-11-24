// Fork: environment-wide active swarm state on mobile, shared with web via client-runtime.
import { useAtomValue } from "@effect/atom-react";
import {
  activeSwarmEnvironmentIdsKey,
  createAgySwarmEnvironmentAtoms,
  extractActiveSwarmStartedAt,
} from "@t3tools/client-runtime/state/agy-swarm";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

const agySwarmEnvironment = createAgySwarmEnvironmentAtoms(connectionAtomRuntime);

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
