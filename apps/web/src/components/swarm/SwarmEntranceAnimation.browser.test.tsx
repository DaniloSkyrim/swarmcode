import "~/index.css";

import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render, stubGlobal } from "../../../test/render";
import ChatMarkdown from "../ChatMarkdown";
import {
  ComposerPromptEditorTiptap,
  type ComposerPromptEditorHandle,
} from "../ComposerPromptEditorTiptap";
import {
  computeSwarmDetailsCardPresentation,
  computeSwarmPanelPresentation,
  recoverStrandedDetailsCard,
  resolveSwarmDetailsCardBehavior,
  resolveSwarmDetailsCardTuckOffset,
  SWARM_ENTRANCE_TIMING,
  SwarmEntranceOverlay,
  SwarmEntranceScene,
} from "./SwarmEntranceAnimation";
import {
  cancelSwarmEntrance,
  getActiveSwarmEntrance,
  startSwarmEntrance,
} from "./swarmEntranceStore";

vi.mock(import("~/state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig, DEFAULT_KEYBINDINGS } =
    await import("@t3tools/shared/keybindings");
  return {
    ...(await original()),
    primaryServerKeybindingsAtom: Atom.make(compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS)),
  };
});

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

function ComposerHarness(props: { readonly initialValue: string }) {
  const [prompt, setPrompt] = useState({
    value: props.initialValue,
    cursor: props.initialValue.length,
  });
  return (
    <ComposerPromptEditorTiptap
      editorRef={createRef<ComposerPromptEditorHandle>()}
      value={prompt.value}
      cursor={prompt.cursor}
      richTextEnabled
      contextRecords={new Map()}
      skills={[]}
      disabled={false}
      placeholder=""
      onChange={(nextValue, nextCursor) => setPrompt({ value: nextValue, cursor: nextCursor })}
      onPaste={() => {}}
      onCommandKeyDown={() => false}
    />
  );
}

function disposableEntranceCleanup(): Disposable {
  return {
    [Symbol.dispose]() {
      cancelSwarmEntrance();
    },
  };
}

/** Drives the runner's rAF timeline by hand: `await frames.at(ms)` runs one frame at `ms`. */
function manualFrames() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  });
  const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    callbacks.delete(id);
  });
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  return {
    pending: () => callbacks.size,
    async at(ms: number) {
      const due = [...callbacks.values()];
      callbacks.clear();
      await act(() => {
        for (const callback of due) callback(ms);
      });
    },
    [Symbol.dispose]() {
      raf.mockRestore();
      caf.mockRestore();
      now.mockRestore();
    },
  };
}

function stubVisibilityState(state: DocumentVisibilityState): Disposable {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  return {
    [Symbol.dispose]() {
      Reflect.deleteProperty(document, "visibilityState");
    },
  };
}

/** Real-app DOM the runner drives: a canvas too narrow to keep the details card inline. */
function mountCollapseLayoutFixture(): Disposable & {
  readonly shell: HTMLElement;
  readonly details: HTMLElement;
  readonly toggle: HTMLElement;
} {
  const root = document.createElement("div");
  root.innerHTML = `
    <span data-thread-panel-toggle style="position:fixed;left:900px;top:8px;width:28px;height:28px"></span>
    <div data-chat-canvas style="position:relative;width:1200px;height:600px">
      <aside data-thread-details-panel="inline" style="position:absolute;right:12px;top:12px;width:280px;height:400px"></aside>
    </div>
    <div data-right-panel-shell="true" style="--resizable-width:600px;width:var(--resizable-width)"></div>`;
  document.body.append(root);
  return {
    shell: root.querySelector<HTMLElement>("[data-right-panel-shell]")!,
    details: root.querySelector<HTMLElement>("[data-thread-details-panel]")!,
    toggle: root.querySelector<HTMLElement>("[data-thread-panel-toggle]")!,
    [Symbol.dispose]() {
      root.remove();
    },
  };
}

describe("SwarmEntranceAnimation", () => {
  it("computes consistent chevron panel reveal and clean final dock", () => {
    const targetWidth = 480;
    const before = computeSwarmPanelPresentation(
      SWARM_ENTRANCE_TIMING.revealAtMs - 10,
      targetWidth,
    );
    expect(before.revealed).toBe(false);
    expect(before.widthPx).toBe(0);
    expect(before.chevronClipPx).toBe(0);

    const mid = computeSwarmPanelPresentation(1120, targetWidth);
    expect(mid.revealed).toBe(true);
    expect(mid.widthPx).toBeGreaterThan(0);
    expect(mid.chevronClipPx).toBeGreaterThan(20);
    expect(mid.violetGlowOpacity).toBeGreaterThan(0);

    const done = computeSwarmPanelPresentation(SWARM_ENTRANCE_TIMING.durationMs, targetWidth);
    expect(done.revealed).toBe(true);
    expect(done.widthPx).toBe(targetWidth);
    expect(done.chevronClipPx).toBe(0);
    expect(done.violetGlowOpacity).toBe(0);
  });

  it("renders mascot and colorful worker bees during the Honeycomb Portal reveal", async () => {
    await using screen = await render(
      <SwarmEntranceScene
        timeMs={1350}
        composerRect={{ left: 320, top: 730, width: 720, height: 112 }}
        viewport={{ width: 1440, height: 860 }}
        panelTargetWidth={480}
      />,
    );
    const overlay = screen.container.querySelector(
      '[data-swarm-entrance-overlay="honeycomb-portal"]',
    );
    expect(overlay).not.toBeNull();
    // Contains the mascot bee SVG, portal SVG, and 6 colorful worker bee SVGs.
    expect(overlay!.querySelectorAll("svg").length).toBeGreaterThanOrEqual(7);
  });

  it("reveals the board immediately and skips animation under prefers-reduced-motion", async () => {
    using _cleanup = disposableEntranceCleanup();
    using _mm = stubGlobal("matchMedia", makeMatchMedia(true));
    const onRevealBoard = vi.fn();

    startSwarmEntrance({
      threadKey: "env-1:thread-reduced",
      composerRect: null,
      onRevealBoard,
    });

    await using _screen = await render(<SwarmEntranceOverlay />);
    expect(onRevealBoard).toHaveBeenCalledTimes(1);
    expect(getActiveSwarmEntrance()).toBeNull();
  });

  it("choreographs inline ThreadDetailsCard cleanly for both collapse and stay-inline viewports", async () => {
    expect(
      resolveSwarmDetailsCardBehavior({
        hasInlineDetailsCard: false,
        canvasWidth: 1600,
        panelTargetWidth: 540,
      }),
    ).toBe("none");

    // Standard desktop window: 1216 - 540 = 676px < 1012px threshold -> collapses smoothly.
    expect(
      resolveSwarmDetailsCardBehavior({
        hasInlineDetailsCard: true,
        canvasWidth: 1216,
        panelTargetWidth: 540,
      }),
    ).toBe("collapse");

    // Wide window / collapsed sidebar: 1624 - 480 = 1144px >= 1012px threshold -> stays inline.
    expect(
      resolveSwarmDetailsCardBehavior({
        hasInlineDetailsCard: true,
        canvasWidth: 1624,
        panelTargetWidth: 480,
      }),
    ).toBe("stay-inline");

    const collapseMid = computeSwarmDetailsCardPresentation("collapse", 540, 0, 540);
    expect(collapseMid.opacity).toBeGreaterThan(0);
    expect(collapseMid.opacity).toBeLessThan(1);
    expect(collapseMid.scale).toBeLessThan(1);

    const collapseAtReveal = computeSwarmDetailsCardPresentation("collapse", 840, 0, 540);
    expect(collapseAtReveal.opacity).toBe(0);
    expect(collapseAtReveal.togglePulse).toBeGreaterThan(0.5);

    // Stay-inline mode opens a 104px portal corridor before reveal and blends monotonically to 0 at dock.
    const stayPreReveal = computeSwarmDetailsCardPresentation("stay-inline", 839, 0, 480);
    expect(stayPreReveal.translateXPx).toBeLessThan(-96);
    expect(stayPreReveal.opacity).toBe(1);

    const stayHalf = computeSwarmDetailsCardPresentation("stay-inline", 1150, 240, 480);
    expect(stayHalf.translateXPx).toBeCloseTo(-52, 1);

    const stayDone = computeSwarmDetailsCardPresentation("stay-inline", 2350, 480, 480);
    expect(stayDone.translateXPx).toBe(0);
    expect(stayDone.opacity).toBe(1);

    await using screen = await render(
      <SwarmEntranceScene
        timeMs={1250}
        composerRect={{ left: 320, top: 760, width: 720, height: 112 }}
        viewport={{ width: 1680, height: 900 }}
        panelTargetWidth={480}
        detailsCard={{
          behavior: "stay-inline",
          rect: { left: 1388, top: 60, width: 280, height: 404 },
          toggleRect: { left: 1596, top: 10, width: 28, height: 28 },
        }}
      />,
    );
    expect(
      screen.container.querySelector('[data-swarm-entrance-overlay="honeycomb-portal"]'),
    ).not.toBeNull();
  });

  it("folds a collapsing card into the toggle center and unfolds it if the layout keeps it inline", () => {
    const card = { left: 1388, top: 60, width: 280, height: 404 };
    const toggle = { left: 1596, top: 9, width: 28, height: 28 };
    const offset = resolveSwarmDetailsCardTuckOffset(card, toggle);
    expect(offset).toEqual({ x: 1610 - 1668, y: 23 - 60 });
    const fallback = resolveSwarmDetailsCardTuckOffset(card, null);
    expect(fallback.x).toBeLessThan(0);
    expect(fallback.y).toBeLessThan(0);

    let previous = computeSwarmDetailsCardPresentation("collapse", 0, 0, 540);
    for (let t = 0; t <= SWARM_ENTRANCE_TIMING.revealAtMs; t += 10) {
      const frame = computeSwarmDetailsCardPresentation("collapse", t, 0, 540, offset);
      expect(frame.scale).toBeLessThanOrEqual(previous.scale);
      expect(frame.opacity).toBeLessThanOrEqual(previous.opacity);
      previous = frame;
    }
    const landed = computeSwarmDetailsCardPresentation(
      "collapse",
      SWARM_ENTRANCE_TIMING.revealAtMs - 140,
      0,
      540,
      offset,
    );
    expect(landed.translateXPx).toBeCloseTo(offset.x, 5);
    expect(landed.translateYPx).toBeCloseTo(offset.y, 5);
    expect(landed.scale).toBeLessThan(0.1);
    expect(landed.opacity).toBe(0);
    expect(landed.togglePulse).toBeGreaterThan(0.8);
    expect(
      computeSwarmDetailsCardPresentation(
        "collapse",
        SWARM_ENTRANCE_TIMING.revealAtMs + 320,
        540,
        540,
        offset,
      ).togglePulse,
    ).toBe(0);

    expect(recoverStrandedDetailsCard(landed, 0)).toEqual(landed);
    expect(recoverStrandedDetailsCard(landed, 420)).toEqual({
      translateXPx: 0,
      translateYPx: 0,
      scale: 1,
      opacity: 1,
      togglePulse: landed.togglePulse,
    });
  });

  it("moves a stay-inline card monotonically left with no snap across the reveal", () => {
    const target = 480;
    let previousLeft = 0;
    for (let t = 0; t <= SWARM_ENTRANCE_TIMING.durationMs; t += 4) {
      const panel = computeSwarmPanelPresentation(t, target);
      const card = computeSwarmDetailsCardPresentation("stay-inline", t, panel.widthPx, target);
      // The card is right-anchored to a canvas that shrinks by the panel width.
      const left = -panel.widthPx + card.translateXPx;
      expect(left).toBeLessThanOrEqual(previousLeft + 1e-9);
      expect(previousLeft - left).toBeLessThan(target * 0.2);
      previousLeft = left;
    }
    expect(previousLeft).toBe(-target);
  });
});

describe("SwarmEntranceOverlay runner", () => {
  it("drives the real panel to its --resizable-width, tucks the card, and restores every style", async () => {
    using _cleanup = disposableEntranceCleanup();
    using _mm = stubGlobal("matchMedia", makeMatchMedia(false));
    using fixture = mountCollapseLayoutFixture();
    using frames = manualFrames();
    const onRevealBoard = vi.fn();
    startSwarmEntrance({ threadKey: "env-1:thread-run", composerRect: null, onRevealBoard });

    await using _screen = await render(<SwarmEntranceOverlay />);
    expect(onRevealBoard).not.toHaveBeenCalled();
    expect(frames.pending()).toBe(1);

    await frames.at(600);
    expect(fixture.details.style.transform).toContain("scale(");
    expect(fixture.toggle.style.boxShadow).not.toBe("");
    expect(onRevealBoard).not.toHaveBeenCalled();

    await frames.at(SWARM_ENTRANCE_TIMING.revealAtMs);
    expect(onRevealBoard).toHaveBeenCalledTimes(1);
    expect(Number(fixture.details.style.opacity)).toBe(0);
    expect(fixture.details.style.pointerEvents).toBe("none");

    await frames.at(1800);
    expect(fixture.shell.style.width).toBe("600px");
    expect(fixture.shell.style.transitionProperty).toBe("none");

    // The fixture never unmounts the card, so it is stranded inline and unfolds back.
    await frames.at(2300);
    expect(Number(fixture.details.style.opacity || "1")).toBeGreaterThan(0.95);

    await frames.at(SWARM_ENTRANCE_TIMING.durationMs);
    expect(getActiveSwarmEntrance()).toBeNull();
    expect(onRevealBoard).toHaveBeenCalledTimes(1);
    expect(fixture.shell.style.width).toBe("var(--resizable-width)");
    expect(fixture.shell.style.transitionProperty).toBe("");
    expect(fixture.shell.style.clipPath).toBe("");
    expect(fixture.details.style.transform).toBe("");
    expect(fixture.details.style.opacity).toBe("");
    expect(fixture.details.style.willChange).toBe("");
    expect(fixture.toggle.style.boxShadow).toBe("");
  });

  it("reveals the board once when the entrance is cancelled mid-flight", async () => {
    using _cleanup = disposableEntranceCleanup();
    using _mm = stubGlobal("matchMedia", makeMatchMedia(false));
    using fixture = mountCollapseLayoutFixture();
    using frames = manualFrames();
    const onRevealBoard = vi.fn();
    startSwarmEntrance({ threadKey: "env-1:thread-cancel", composerRect: null, onRevealBoard });
    await using _screen = await render(<SwarmEntranceOverlay />);

    await frames.at(600);
    await act(() => cancelSwarmEntrance("env-1:thread-cancel"));
    expect(onRevealBoard).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(0);
    expect(fixture.details.style.transform).toBe("");
    expect(fixture.toggle.style.boxShadow).toBe("");
  });

  it("skips the animation and reveals immediately in a hidden tab", async () => {
    using _cleanup = disposableEntranceCleanup();
    using _mm = stubGlobal("matchMedia", makeMatchMedia(false));
    using _hidden = stubVisibilityState("hidden");
    const onRevealBoard = vi.fn();
    startSwarmEntrance({ threadKey: "env-1:thread-hidden", composerRect: null, onRevealBoard });

    await using _screen = await render(<SwarmEntranceOverlay />);
    expect(onRevealBoard).toHaveBeenCalledTimes(1);
    expect(getActiveSwarmEntrance()).toBeNull();
  });
});

describe("/swarm purple highlight", () => {
  it("highlights only standalone /swarm in the live composer editor", async () => {
    await using screen = await render(
      <ComposerHarness initialValue="/swarm coordene /teamwork e /boost mas não `/swarm`" />,
    );

    const highlighted = [
      ...screen.container.querySelectorAll<HTMLElement>('[data-swarm-command="true"]'),
    ];
    expect(highlighted.map((el) => el.textContent)).toEqual(["/swarm"]);
    expect(highlighted[0]?.classList.contains("composer-swarm-command")).toBe(true);
  });

  it("highlights /swarm in sent user messages but not in assistant messages or inline code", async () => {
    await using userScreen = await render(
      <ChatMarkdown
        cwd="/tmp/project"
        text="/swarm atualize a overview, ignore /teamwork, /boost e `/swarm`"
        extensions={{ userMessage: true }}
      />,
    );
    const userHighlighted = [
      ...userScreen.container.querySelectorAll<HTMLElement>('[data-swarm-command="true"]'),
    ];
    expect(userHighlighted.map((el) => el.textContent)).toEqual(["/swarm"]);

    await using assistantScreen = await render(
      <ChatMarkdown cwd="/tmp/project" text="Use /swarm para iniciar uma swarm." />,
    );
    expect(assistantScreen.container.querySelectorAll('[data-swarm-command="true"]').length).toBe(
      0,
    );
  });
});
