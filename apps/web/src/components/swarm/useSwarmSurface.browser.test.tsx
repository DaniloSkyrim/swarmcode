import "~/index.css";

import {
  EnvironmentId,
  ThreadId,
  type AgySwarmSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render, stubGlobal } from "../../../test/render";
import {
  selectActiveRightPanelSurface,
  selectThreadPanelOpen,
  useRightPanelStore,
} from "~/rightPanelStore";
import { cancelSwarmEntrance, getActiveSwarmEntrance } from "./swarmEntranceStore";

const swarmState = vi.hoisted(() => ({
  swarm: null as AgySwarmSnapshot | null,
  loaded: false,
  error: null as string | null,
}));

vi.mock(import("~/state/agySwarm"), async (original) => ({
  ...(await original()),
  useAgySwarm: () => swarmState,
}));

import { useSwarmSurface } from "./useSwarmSurface";

function makeSwarm(threadId: ThreadId): AgySwarmSnapshot {
  return {
    id: `swarm-${threadId}`,
    kind: "swarm",
    title: "Test Swarm",
    coordinatorThreadId: threadId,
    head: 1,
    doneAt: null,
    channels: [{ name: "main", archived: false }],
    members: [],
    posts: [],
    plan: null,
  } as unknown as AgySwarmSnapshot;
}

function makeMatchMedia(reduced: boolean) {
  return (query: string) =>
    ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

function Harness(props: {
  readonly threadRef: ScopedThreadRef;
  readonly tick: number;
  readonly onSurface?: (surface: ReturnType<typeof useSwarmSurface>) => void;
}) {
  const surface = useSwarmSurface(props.threadRef, true, true);
  props.onSurface?.(surface);
  return <div data-chat-composer-surface="true" style={{ width: 640, height: 112 }} />;
}

function disposableSwarmTestState(): Disposable {
  return {
    [Symbol.dispose]() {
      cancelSwarmEntrance();
      localStorage.clear();
      swarmState.swarm = null;
      swarmState.loaded = false;
      swarmState.error = null;
    },
  };
}

describe("useSwarmSurface entrance trigger", () => {
  it("plays the entrance animation only on a live null -> swarm transition and not on manual reopen", async () => {
    using _cleanup = disposableSwarmTestState();
    using _mm = stubGlobal("matchMedia", makeMatchMedia(false));
    const threadRef: ScopedThreadRef = {
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-live-open"),
    };
    let latestSurface: ReturnType<typeof useSwarmSurface> | null = null;

    swarmState.loaded = true;
    swarmState.swarm = null;
    await using screen = await render(
      <Harness threadRef={threadRef} tick={0} onSurface={(s) => (latestSurface = s)} />,
    );
    expect(getActiveSwarmEntrance()).toBeNull();

    // Swarm appears live on the thread: animation starts and defers opening the board until reveal.
    swarmState.swarm = makeSwarm(threadRef.threadId);
    await screen.rerender(
      <Harness threadRef={threadRef} tick={1} onSurface={(s) => (latestSurface = s)} />,
    );

    const entrance = getActiveSwarmEntrance();
    expect(entrance).not.toBeNull();
    expect(entrance?.composerRect?.width).toBeGreaterThan(100);

    // Executing onRevealBoard opens the right panel proactively and minimizes inline thread details.
    expect(
      selectThreadPanelOpen(
        useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
        threadRef,
        "inline",
      ),
    ).toBe(true);
    await act(() => {
      entrance!.onRevealBoard();
    });
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef)?.kind,
    ).toBe("swarm");
    expect(
      selectThreadPanelOpen(
        useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
        threadRef,
        "inline",
      ),
    ).toBe(false);

    // User can always re-open thread details from the header toggle afterwards.
    await act(() => {
      useRightPanelStore.getState().toggleThreadPanel(threadRef, "inline");
    });
    expect(
      selectThreadPanelOpen(
        useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
        threadRef,
        "inline",
      ),
    ).toBe(true);

    // Clearing the entrance and manually toggling closed/open never replays the entrance animation.
    cancelSwarmEntrance();
    await act(() => {
      latestSurface?.shortcuts["swarm.toggle"]();
      latestSurface?.addSwarmSurface();
    });
    expect(getActiveSwarmEntrance()).toBeNull();
  });

  it("keeps thread details open if the user took over the right panel before reveal", async () => {
    using _cleanup = disposableSwarmTestState();
    using _mm = stubGlobal("matchMedia", makeMatchMedia(false));
    const threadRef: ScopedThreadRef = {
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-user-override"),
    };

    swarmState.loaded = true;
    swarmState.swarm = null;
    await using screen = await render(<Harness threadRef={threadRef} tick={0} />);

    swarmState.swarm = makeSwarm(threadRef.threadId);
    await screen.rerender(<Harness threadRef={threadRef} tick={1} />);

    const entrance = getActiveSwarmEntrance();
    expect(entrance).not.toBeNull();

    // User interacts with the right panel mid-flight, so proactive open refuses and details stay open.
    await act(() => {
      useRightPanelStore.getState().markUserAction(threadRef);
      entrance!.onRevealBoard();
    });
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef),
    ).toBeNull();
    expect(
      selectThreadPanelOpen(
        useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
        threadRef,
        "inline",
      ),
    ).toBe(true);
  });

  it("opens directly without animating when loading a thread that already has a swarm", async () => {
    using _cleanup = disposableSwarmTestState();
    using _mm = stubGlobal("matchMedia", makeMatchMedia(false));
    const threadRef: ScopedThreadRef = {
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-existing-swarm"),
    };

    swarmState.loaded = true;
    swarmState.swarm = makeSwarm(threadRef.threadId);
    await using _screen = await render(<Harness threadRef={threadRef} tick={0} />);

    expect(getActiveSwarmEntrance()).toBeNull();
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef)?.kind,
    ).toBe("swarm");
  });

  it("opens directly without animating when prefers-reduced-motion is enabled", async () => {
    using _cleanup = disposableSwarmTestState();
    using _mm = stubGlobal("matchMedia", makeMatchMedia(true));
    const threadRef: ScopedThreadRef = {
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-reduced-motion"),
    };

    swarmState.loaded = true;
    swarmState.swarm = null;
    await using screen = await render(<Harness threadRef={threadRef} tick={0} />);

    swarmState.swarm = makeSwarm(threadRef.threadId);
    await screen.rerender(<Harness threadRef={threadRef} tick={1} />);

    expect(getActiveSwarmEntrance()).toBeNull();
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef)?.kind,
    ).toBe("swarm");
    expect(
      selectThreadPanelOpen(
        useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
        threadRef,
        "inline",
      ),
    ).toBe(false);
  });
});
