import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { useRightPanelStore } from "~/rightPanelStore";

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
