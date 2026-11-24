// Fork: the swarm board of a thread. Kept apart from the upstream state modules so merges stay clean.
import { AGY_WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcSubscriptionAtomFamily } from "./runtime.ts";

export function createAgySwarmEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    // Emits the swarm the thread belongs to now and on every change, or null when it is in none.
    swarm: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:agy:swarm",
      tag: AGY_WS_METHODS.swarmSubscribe,
      idleTtlMs: 30_000,
    }),
  };
}
