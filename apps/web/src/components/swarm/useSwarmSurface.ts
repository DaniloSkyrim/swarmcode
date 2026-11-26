import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { useRightPanelStore } from "~/rightPanelStore";
import { useAgySwarm } from "~/state/agySwarm";
import { buildThreadRouteParams } from "~/threadRoutes";
import {
  jumpToNextNeedsInputMember,
  markSwarmAutoOpened,
  openSwarmSurface,
  swarmAutoOpened,
} from "./openSwarmSurface";
import {
  cancelSwarmEntrance,
  startSwarmEntrance,
  type SwarmComposerRect,
} from "./swarmEntranceStore";

function readComposerRect(): SwarmComposerRect | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>('[data-chat-composer-surface="true"]');
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * The swarm board's entry points for a thread's chat view: the tab action, the toggle shortcut,
 * and opening the board once, without stealing focus again, when the thread first joins a swarm.
 * Only a thread that may still auto-open subscribes; an open board subscribes on its own.
 */
export function useSwarmSurface(
  threadRef: ScopedThreadRef | null,
  enabled: boolean,
  autoOpen: boolean,
) {
  const threadKey = threadRef ? scopedThreadKey(threadRef) : null;
  const watchRef =
    enabled && autoOpen && threadRef && !swarmAutoOpened(threadRef) ? threadRef : null;
  const watchKey = watchRef ? scopedThreadKey(watchRef) : null;
  const { swarm, loaded } = useAgySwarm(
    watchRef?.environmentId ?? null,
    watchRef?.threadId ?? null,
  );
  const inSwarm = swarm !== null;
  const sawNoSwarmKeyRef = useRef<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels an in-flight entrance overlay if the user switches away from this thread
  useEffect(() => {
    if (!threadKey) return;
    return () => {
      cancelSwarmEntrance(threadKey);
    };
  }, [threadKey]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the panel when the server reports a swarm, animating only on a live null -> swarm transition
  useEffect(() => {
    if (!watchRef || !watchKey) return;
    if (loaded && !inSwarm) {
      sawNoSwarmKeyRef.current = watchKey;
      return;
    }
    if (!inSwarm || swarmAutoOpened(watchRef)) return;
    markSwarmAutoOpened(watchRef);
    const panels = useRightPanelStore.getState();
    const revision = panels.getUserActionRevision(watchRef);
    const openBoard = () => {
      useRightPanelStore
        .getState()
        .openProactive(watchRef, { id: "swarm", kind: "swarm" }, revision);
    };
    const isFreshSwarmOpen = sawNoSwarmKeyRef.current === watchKey;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (isFreshSwarmOpen && !prefersReducedMotion) {
      startSwarmEntrance({
        threadKey: watchKey,
        composerRect: readComposerRect(),
        onRevealBoard: openBoard,
      });
      return;
    }
    openBoard();
  }, [inSwarm, loaded, watchKey, watchRef]);

  const navigate = useNavigate();
  const addSwarmSurface = useStableCallback(() => {
    if (threadRef) openSwarmSurface(threadRef);
  });
  const toggleSwarmSurface = useStableCallback(() => {
    if (!threadRef || !enabled) return false;
    markSwarmAutoOpened(threadRef);
    useRightPanelStore.getState().toggle(threadRef, "swarm");
  });
  const jumpNeedsInput = useStableCallback(() => {
    if (!threadRef || !enabled) return false;
    jumpToNextNeedsInputMember(threadRef, (target) => {
      void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(target) });
    });
  });

  return {
    swarmAvailable: enabled && threadRef !== null,
    addSwarmSurface,
    shortcuts: {
      "swarm.toggle": toggleSwarmSurface,
      "swarm.jumpNeedsInput": jumpNeedsInput,
    },
  };
}
