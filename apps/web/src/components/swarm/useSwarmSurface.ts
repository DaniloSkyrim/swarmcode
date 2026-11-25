import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

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
  const watchRef =
    enabled && autoOpen && threadRef && !swarmAutoOpened(threadRef) ? threadRef : null;
  const { swarm } = useAgySwarm(watchRef?.environmentId ?? null, watchRef?.threadId ?? null);
  const inSwarm = swarm !== null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the panel when the server reports a swarm, which only the subscription knows
  useEffect(() => {
    if (!inSwarm || !watchRef || swarmAutoOpened(watchRef)) return;
    markSwarmAutoOpened(watchRef);
    const panels = useRightPanelStore.getState();
    panels.openProactive(
      watchRef,
      { id: "swarm", kind: "swarm" },
      panels.getUserActionRevision(watchRef),
    );
  }, [inSwarm, watchRef]);

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
