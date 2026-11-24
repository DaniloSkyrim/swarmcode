// Fork: the swarm board of a thread, read live from the environment.
import { createAgySwarmEnvironmentAtoms } from "@t3tools/client-runtime/state/agy-swarm";
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
