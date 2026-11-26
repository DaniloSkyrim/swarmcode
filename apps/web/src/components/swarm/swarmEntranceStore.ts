import { useSyncExternalStore } from "react";

export interface SwarmComposerRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ActiveSwarmEntrance {
  readonly id: number;
  readonly threadKey: string;
  readonly composerRect: SwarmComposerRect | null;
  readonly onRevealBoard: () => void;
}

type Listener = () => void;

let nextEntranceId = 1;
let activeEntrance: ActiveSwarmEntrance | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function startSwarmEntrance(input: {
  readonly threadKey: string;
  readonly composerRect: SwarmComposerRect | null;
  readonly onRevealBoard: () => void;
}): number {
  const id = nextEntranceId++;
  activeEntrance = {
    id,
    threadKey: input.threadKey,
    composerRect: input.composerRect,
    onRevealBoard: input.onRevealBoard,
  };
  emit();
  return id;
}

export function finishSwarmEntrance(id: number): void {
  if (activeEntrance?.id !== id) return;
  activeEntrance = null;
  emit();
}

export function cancelSwarmEntrance(threadKey?: string): void {
  if (!activeEntrance) return;
  if (threadKey !== undefined && activeEntrance.threadKey !== threadKey) return;
  activeEntrance = null;
  emit();
}

export function getActiveSwarmEntrance(): ActiveSwarmEntrance | null {
  return activeEntrance;
}

function subscribeSwarmEntrance(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActiveSwarmEntrance(): ActiveSwarmEntrance | null {
  return useSyncExternalStore(
    subscribeSwarmEntrance,
    getActiveSwarmEntrance,
    getActiveSwarmEntrance,
  );
}
