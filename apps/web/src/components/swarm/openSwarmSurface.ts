import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { openSideThread } from "~/lib/sideChatPane";
import { useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { agySwarmEnvironment } from "~/state/agySwarm";
import { nextNeedsInputMember } from "./swarmBoard.logic";

const AUTO_OPENED_KEY = "t3code:swarm-auto-opened:v1";
const AUTO_OPENED_LIMIT = 200;

function readAutoOpened(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(AUTO_OPENED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** Whether the board already opened itself for this thread, here or in an earlier session. */
export function swarmAutoOpened(threadRef: ScopedThreadRef): boolean {
  return readAutoOpened().includes(scopedThreadKey(threadRef));
}

export function markSwarmAutoOpened(threadRef: ScopedThreadRef): void {
  const key = scopedThreadKey(threadRef);
  const known = readAutoOpened();
  if (known.includes(key)) return;
  try {
    localStorage.setItem(
      AUTO_OPENED_KEY,
      JSON.stringify([...known, key].slice(-AUTO_OPENED_LIMIT)),
    );
  } catch {
    // Storage can be blocked; the board then offers itself once per session instead.
  }
}

/** Opens (or focuses) the thread's swarm board in its right panel. */
export function openSwarmSurface(threadRef: ScopedThreadRef): void {
  markSwarmAutoOpened(threadRef);
  useRightPanelStore.getState().open(threadRef, "swarm");
}

/**
 * Jumps directly to the next swarm member awaiting user input; if none is cached or waiting,
 * opens the swarm board instead so the user can inspect member states.
 */
export function jumpToNextNeedsInputMember(
  threadRef: ScopedThreadRef,
  navigate: (target: ScopedThreadRef) => void,
): boolean {
  const result = appAtomRegistry.get(
    agySwarmEnvironment.swarm({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const swarm = Option.getOrUndefined(AsyncResult.value(result)) ?? null;
  const target = swarm ? nextNeedsInputMember(swarm.members, threadRef.threadId) : null;
  if (target === null) {
    openSwarmSurface(threadRef);
    return false;
  }
  openSideThread({
    threadRef: scopeThreadRef(threadRef.environmentId, target.threadId),
    panelRef: threadRef,
    intent: "primary",
    navigate,
  });
  return true;
}
