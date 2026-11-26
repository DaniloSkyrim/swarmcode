import { type CSSProperties, useEffect, useRef, useState } from "react";

import { RESIZABLE_WIDTH_PROPERTY } from "~/hooks/useResizableWidth";
import { DETAILS_CARD_CLEARANCE } from "../chat/chatCanvasLayout";
import { THREAD_DETAILS_CARD_GAP } from "../chat/threadDetailsCardLayout";
import { BeeSprite } from "./SwarmAvatar";
import { type BeeColors, WORKER_BEES } from "./swarmBoard.logic";
import { SwarmcodeMascotBee, SwarmPixelSparkle } from "./SwarmcodeMascotBee";
import {
  type ActiveSwarmEntrance,
  finishSwarmEntrance,
  type SwarmComposerRect,
  useActiveSwarmEntrance,
} from "./swarmEntranceStore";

export const SWARM_ENTRANCE_TIMING = {
  durationMs: 2350,
  revealAtMs: 840,
} as const;

export interface SwarmPanelPresentation {
  readonly revealed: boolean;
  readonly widthPx: number;
  readonly violetGlowOpacity: number;
  readonly chevronClipPx: number;
}

export type SwarmDetailsCardBehavior = "none" | "collapse" | "stay-inline";

export interface SwarmDetailsCardContext {
  readonly behavior: SwarmDetailsCardBehavior;
  /** Inline `[data-thread-details-panel="inline"]` bounding rect at t = 0 (viewport coordinates). */
  readonly rect: SwarmComposerRect;
  /** `[data-thread-panel-toggle]` rect at t = 0; the collapsing card folds into its center. */
  readonly toggleRect?: SwarmComposerRect | null | undefined;
}

export interface SwarmVec2 {
  readonly x: number;
  readonly y: number;
}

export interface SwarmDetailsCardPresentation {
  readonly translateXPx: number;
  readonly translateYPx: number;
  readonly scale: number;
  readonly opacity: number;
  /** 0..1 highlight pulse on `[data-thread-panel-toggle]` as the card tucks into the header. */
  readonly togglePulse: number;
}

export interface SwarmEntranceViewport {
  readonly width: number;
  readonly height: number;
}

type Vec2 = SwarmVec2;

const DEFAULT_PANEL_WIDTH = 540;
const MIN_PANEL_WIDTH = 360;
const MAX_PANEL_WIDTH_FRACTION = 0.7;
const SIBLING_COLUMN_MIN_WIDTH = 360;
const DEFAULT_DETAILS_CARD_WIDTH = 280;
const DEFAULT_LANE_PADDING = 48;
const DEFAULT_MIN_CHAT_WIDTH = 640;
const DETAILS_CARD_PORTAL_CORRIDOR_PX = 104;
// Card top-right corner to the header toggle center in the default chat header layout.
const DEFAULT_DETAILS_CARD_TUCK_OFFSET: Vec2 = { x: -58, y: -37 };
const DETAILS_CARD_TUCK_END_SCALE = 0.08;
const DETAILS_CARD_TUCK_START_MS = Math.max(240, SWARM_ENTRANCE_TIMING.revealAtMs - 460);
const DETAILS_CARD_TUCK_END_MS = Math.max(
  DETAILS_CARD_TUCK_START_MS + 220,
  SWARM_ENTRANCE_TIMING.revealAtMs - 140,
);

const SWARM_FX = {
  goldLight: "#fef08a",
  goldPale: "#ffee8c",
  gold: "#fbbf24",
  lavender: "#c9a7ff",
  violetLight: "#c4b5fd",
  violetSoft: "#a78bfa",
  violet: "#8b5cf6",
} as const;

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function segment(timeMs: number, startMs: number, endMs: number): number {
  if (endMs <= startMs) return timeMs >= endMs ? 1 : 0;
  return clamp01((timeMs - startMs) / (endMs - startMs));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

function easeOutQuint(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u * u * u;
}

function easeInCubic(t: number): number {
  const x = clamp01(t);
  return x * x * x;
}

function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function cubicBezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, rawT: number): Vec2 {
  const t = clamp01(rawT);
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}

function cubicBezierTangent(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, rawT: number): Vec2 {
  const t = clamp01(rawT);
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

function wingBeat(
  timeMs: number,
  speed = 0.056,
  amplitude = 19,
): {
  readonly angle: number;
  readonly scaleY: number;
} {
  const phase = timeMs * speed;
  return {
    angle: Math.sin(phase) * amplitude,
    scaleY: 0.87 + Math.cos(phase) * 0.15,
  };
}

function pickWorkerBee(index: number): BeeColors {
  return WORKER_BEES[index % WORKER_BEES.length]!;
}

function buildChevronClipPath(chevronClipPx: number): string | undefined {
  if (chevronClipPx <= 0.5) return undefined;
  const px = chevronClipPx.toFixed(1);
  return `polygon(0px 50%, ${px}px 0%, 100% 0%, 100% 100%, ${px}px 100%)`;
}

/**
 * Mirrors `resolveThreadDetailsCardLayout` so the entrance choreography knows in advance
 * whether an open inline thread details card will collapse into its header toggle or stay inline.
 */
export function resolveSwarmDetailsCardBehavior(input: {
  readonly hasInlineDetailsCard: boolean;
  readonly canvasWidth: number;
  readonly panelTargetWidth: number;
  readonly detailsCardWidth?: number | undefined;
  readonly lanePadding?: number | undefined;
  readonly minChatWidth?: number | undefined;
}): SwarmDetailsCardBehavior {
  if (!input.hasInlineDetailsCard) return "none";
  const cardWidth = input.detailsCardWidth ?? DEFAULT_DETAILS_CARD_WIDTH;
  const lanePadding = input.lanePadding ?? DEFAULT_LANE_PADDING;
  const minChatWidth = input.minChatWidth ?? DEFAULT_MIN_CHAT_WIDTH;
  const remainingCanvasWidth = input.canvasWidth - input.panelTargetWidth;
  const fitsAfterOpen =
    remainingCanvasWidth -
      cardWidth -
      THREAD_DETAILS_CARD_GAP -
      DETAILS_CARD_CLEARANCE -
      lanePadding >=
    minChatWidth;
  return fitsAfterOpen ? "stay-inline" : "collapse";
}

/** Offset from the card's top-right corner (its transform origin) to the toggle's center. */
export function resolveSwarmDetailsCardTuckOffset(
  cardRect: SwarmComposerRect,
  toggleRect: SwarmComposerRect | null | undefined,
): SwarmVec2 {
  if (!toggleRect || toggleRect.width <= 0 || toggleRect.height <= 0) {
    return DEFAULT_DETAILS_CARD_TUCK_OFFSET;
  }
  return {
    x: toggleRect.left + toggleRect.width / 2 - (cardRect.left + cardRect.width),
    y: toggleRect.top + toggleRect.height / 2 - cardRect.top,
  };
}

const IDENTITY_DETAILS_CARD: SwarmDetailsCardPresentation = {
  translateXPx: 0,
  translateYPx: 0,
  scale: 1,
  opacity: 1,
  togglePulse: 0,
};

/**
 * Synchronizes `[data-thread-details-panel="inline"]` with the opening Swarm Board:
 * - `"collapse"`: shrinks the card from its top-right corner into `[data-thread-panel-toggle]`
 *   (genie-style), fully hidden before the board opens, while the toggle answers with a pulse.
 * - `"stay-inline"`: opens a 104px corridor for the portal, then yields monotonically to native layout.
 */
export function computeSwarmDetailsCardPresentation(
  behavior: SwarmDetailsCardBehavior,
  timeMs: number,
  panelWidthPx: number,
  panelTargetWidth: number,
  tuckOffset: SwarmVec2 = DEFAULT_DETAILS_CARD_TUCK_OFFSET,
): SwarmDetailsCardPresentation {
  if (behavior === "none") return IDENTITY_DETAILS_CARD;
  const { revealAtMs } = SWARM_ENTRANCE_TIMING;
  if (behavior === "collapse") {
    const rawT = segment(timeMs, DETAILS_CARD_TUCK_START_MS, DETAILS_CARD_TUCK_END_MS);
    // The toggle lights up as the card arrives, peaks just after, then decays slowly.
    const pulsePeak = DETAILS_CARD_TUCK_END_MS + 40;
    const pulseEnd = revealAtMs + 320;
    const togglePulse =
      timeMs <= DETAILS_CARD_TUCK_END_MS - 140 || timeMs >= pulseEnd
        ? 0
        : timeMs <= pulsePeak
          ? easeOutCubic(segment(timeMs, DETAILS_CARD_TUCK_END_MS - 140, pulsePeak))
          : 1 - easeInOutCubic(segment(timeMs, pulsePeak, pulseEnd));
    if (rawT === 0) return { ...IDENTITY_DETAILS_CARD, togglePulse };
    const travel = easeInOutCubic(rawT);
    return {
      translateXPx: tuckOffset.x * travel,
      translateYPx: tuckOffset.y * travel,
      scale: lerp(1, DETAILS_CARD_TUCK_END_SCALE, travel),
      // Stays readable for the first third so the eye follows it into the toggle.
      opacity: rawT >= 1 ? 0 : 1 - easeInCubic(segment(rawT, 0.3, 1)),
      togglePulse,
    };
  }

  // "stay-inline": pre-nudge left so the honeycomb portal blooms in clear space, then blend to 0.
  const nudgeStart = Math.max(260, revealAtMs - 380);
  if (timeMs < revealAtMs) {
    const nudgeT = easeInOutCubic(segment(timeMs, nudgeStart, revealAtMs));
    return {
      translateXPx: nudgeT === 0 ? 0 : -DETAILS_CARD_PORTAL_CORRIDOR_PX * nudgeT,
      translateYPx: 0,
      scale: 1,
      opacity: 1,
      togglePulse: 0,
    };
  }
  const progress = clamp01(panelWidthPx / Math.max(1, panelTargetWidth));
  const remaining = progress >= 1 ? 0 : -DETAILS_CARD_PORTAL_CORRIDOR_PX * (1 - progress);
  return {
    translateXPx: remaining,
    translateYPx: 0,
    scale: 1,
    opacity: 1,
    togglePulse: 0,
  };
}

/**
 * Pure frame-accurate panel reveal synchronized pixel-for-pixel with the 6-bee chevron sweep.
 */
export function computeSwarmPanelPresentation(
  timeMs: number,
  panelTargetWidth: number,
): SwarmPanelPresentation {
  if (timeMs < SWARM_ENTRANCE_TIMING.revealAtMs) {
    return {
      revealed: false,
      widthPx: 0,
      violetGlowOpacity: 0,
      chevronClipPx: 0,
    };
  }
  const glideT = segment(timeMs, 840, 1740);
  const widthProgress = easeOutQuint(glideT);
  const widthPx = Math.round(panelTargetWidth * widthProgress);
  const chevronT = segment(timeMs, 840, 1650);
  const chevronClipPx =
    chevronT > 0 && chevronT < 1
      ? Math.round(
          Math.min(widthPx * 0.55, 76 * Math.sin(chevronT * Math.PI) * (1 - chevronT * 0.12)),
        )
      : 0;
  const shimmer =
    timeMs >= 840 && timeMs <= 2100 ? Math.sin(segment(timeMs, 840, 2100) * Math.PI) * 0.95 : 0;
  return {
    revealed: true,
    widthPx: glideT >= 1 ? panelTargetWidth : widthPx,
    violetGlowOpacity: shimmer,
    chevronClipPx,
  };
}

function defaultComposerRect(viewport: SwarmEntranceViewport): SwarmComposerRect {
  const width = Math.min(720, viewport.width * 0.62);
  return {
    left: (viewport.width - width) / 2,
    top: viewport.height - 138,
    width,
    height: 112,
  };
}

interface WorkerBeeFrame {
  readonly key: string;
  readonly bee: BeeColors;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly facing: "left" | "right";
  readonly rotateDeg: number;
  readonly opacity: number;
  readonly scale: number;
  readonly wingShiftY: number;
}

function AnimatedWorkerBee(props: { readonly frame: WorkerBeeFrame }) {
  const { frame } = props;
  if (frame.opacity <= 0.01) return null;
  const height = (frame.width * 10) / 12;
  const flipX = frame.facing === "right" ? -1 : 1;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        opacity: frame.opacity,
        transform: `translate3d(${(frame.x - frame.width / 2).toFixed(2)}px, ${(frame.y - height / 2).toFixed(2)}px, 0) rotate(${frame.rotateDeg.toFixed(2)}deg) scale(${(frame.scale * flipX).toFixed(3)}, ${frame.scale.toFixed(3)})`,
        transformOrigin: "center center",
        filter: "drop-shadow(0 3px 8px rgba(109, 40, 217, 0.34))",
      }}
    >
      <BeeSprite bee={frame.bee} width={frame.width} wingOffsetY={frame.wingShiftY * 0.65} />
    </div>
  );
}

/**
 * Pure time-addressed Honeycomb Portal entrance scene.
 * Accepts an explicit `timeMs` so live rAF playback and deterministic test renders match identically.
 */
export function SwarmEntranceScene(props: {
  readonly timeMs: number;
  readonly composerRect?: SwarmComposerRect | null | undefined;
  readonly viewport: SwarmEntranceViewport;
  readonly panelTargetWidth?: number | undefined;
  readonly panelPresentation?: SwarmPanelPresentation | undefined;
  readonly detailsCard?: SwarmDetailsCardContext | null | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}) {
  const {
    timeMs,
    viewport,
    panelTargetWidth = DEFAULT_PANEL_WIDTH,
    detailsCard,
    className,
    style,
  } = props;
  const composer = props.composerRect ?? defaultComposerRect(viewport);
  const panel = props.panelPresentation ?? computeSwarmPanelPresentation(timeMs, panelTargetWidth);

  const cardStaysInline = detailsCard?.behavior === "stay-inline";
  const cardRect = detailsCard?.rect ?? null;
  const cardBottom = cardRect ? cardRect.top + cardRect.height : 0;

  const startX = composer.left + composer.width * 0.72;
  const composerTop = composer.top;
  // Leaves room for the 1.18x spin pulse of the 54px mascot without clipping at the viewport edge.
  const edgeX = viewport.width - 34;
  const edgeY = viewport.height * 0.5;
  const panelLeftX = viewport.width - panel.widthPx;
  const panelFinalLeftX = viewport.width - panelTargetWidth;
  const chevronDepth = panel.chevronClipPx;

  const p0: Vec2 = { x: startX, y: composerTop + 28 };
  const p1: Vec2 = {
    x: startX + 36,
    y: cardStaysInline ? Math.max(cardBottom + 36, composerTop - 190) : composerTop - 210,
  };
  const p2: Vec2 = {
    x: lerp(startX, edgeX, 0.72),
    y:
      cardStaysInline && cardRect
        ? Math.min(viewport.height - 96, Math.max(edgeY + 34, cardBottom + 32))
        : edgeY - 90,
  };
  const p3: Vec2 = { x: edgeX, y: edgeY };

  const flyT = segment(timeMs, 40, 720);
  const spinT = segment(timeMs, 700, 920);
  const perchT = segment(timeMs, 920, 1180);
  const exitT = segment(timeMs, 1760, 2350);

  const perchBelowInlineCard =
    cardStaysInline &&
    cardRect !== null &&
    cardBottom + 96 < composerTop &&
    cardBottom + 110 < viewport.height;
  const hoverLeftX =
    cardStaysInline && cardRect !== null && !perchBelowInlineCard
      ? Math.max(80, panelFinalLeftX - THREAD_DETAILS_CARD_GAP - cardRect.width - 56)
      : panelFinalLeftX - 68;
  const hoverTopY = perchBelowInlineCard
    ? Math.min(viewport.height - 130, cardBottom + 44)
    : Math.max(94, viewport.height * 0.115);

  let mascotX = p0.x;
  let mascotY = p0.y;
  let mascotRotate = 0;
  let mascotFacing: "left" | "right" = "right";
  let mascotOpacity = 1;
  let mascotScale = 1;
  const clipBelowComposer = timeMs < 220;

  if (timeMs < 720) {
    const eased = easeInOutCubic(flyT);
    const pt = cubicBezier(p0, p1, p2, p3, eased);
    const tan = cubicBezierTangent(p0, p1, p2, p3, eased);
    mascotX = pt.x;
    mascotY = pt.y;
    mascotRotate = Math.max(-22, Math.min(20, ((Math.atan2(tan.y, tan.x) * 180) / Math.PI) * 0.35));
    mascotFacing = "right";
  } else if (timeMs < 920) {
    mascotX = edgeX;
    mascotY = edgeY;
    mascotFacing = spinT > 0.5 ? "left" : "right";
    mascotRotate = easeOutCubic(spinT) * 360;
    mascotScale = 1 + Math.sin(spinT * Math.PI) * 0.18;
  } else if (timeMs < 1760) {
    mascotFacing = "left";
    const eased = easeOutCubic(perchT);
    const arcLift = Math.sin(perchT * Math.PI) * (perchBelowInlineCard ? -32 : 48);
    mascotX = lerp(edgeX, hoverLeftX, eased);
    mascotY = lerp(edgeY, hoverTopY, eased) - arcLift + Math.sin(timeMs * 0.014) * 5;
    mascotRotate = lerp(perchBelowInlineCard ? 10 : -14, 0, eased);
  } else {
    mascotFacing = "left";
    mascotX = hoverLeftX - easeOutCubic(exitT) * (cardStaysInline ? 22 : 34);
    mascotY = hoverTopY + easeOutCubic(exitT) * (perchBelowInlineCard ? 36 : -40);
    mascotRotate = (perchBelowInlineCard ? 8 : -8) * exitT;
    mascotScale = 1 - exitT * 0.2;
    mascotOpacity = 1 - easeInOutCubic(exitT);
  }

  const mascotWings = wingBeat(timeMs, 0.06, 18);

  const ribbonFade = timeMs <= 720 ? 1 : 1 - segment(timeMs, 720, 1120);
  const ribbonPoints: Vec2[] = [];
  if (timeMs >= 60 && ribbonFade > 0.01) {
    const headT = easeInOutCubic(flyT);
    const tailT = Math.max(0, headT - 0.52);
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const s = lerp(tailT, headT, i / steps);
      ribbonPoints.push(cubicBezier(p0, p1, p2, p3, s));
    }
  }
  const ribbonPath =
    ribbonPoints.length > 1
      ? `M ${ribbonPoints.map((pt) => `${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(" L ")}`
      : "";

  const composerGlowOp = timeMs < 440 ? Math.sin(segment(timeMs, 0, 440) * Math.PI) * 0.85 : 0;

  // Feathered violet-gold honeycomb rift blooms below the top header bar (540..860ms) and dissolves by 1040ms.
  const riftOpenT = easeOutCubic(segment(timeMs, 540, 860));
  const riftFade = timeMs < 860 ? riftOpenT : 1 - segment(timeMs, 860, 1040);
  const portalTop = detailsCard?.toggleRect
    ? Math.max(52, Math.ceil(detailsCard.toggleRect.top + detailsCard.toggleRect.height + 12))
    : cardRect
      ? Math.max(52, Math.floor(cardRect.top - 4))
      : 52;
  const portalBottom = viewport.height - 12;
  const riftTop = lerp(edgeY, portalTop, riftOpenT);
  const riftBottom = lerp(edgeY, portalBottom, riftOpenT);
  const riftHeight = Math.max(0, riftBottom - riftTop);

  // Live right edge of the inline ThreadDetailsCard so worker bees never cross its 12px gutter.
  const panelProgress = clamp01(panel.widthPx / Math.max(1, panelTargetWidth));
  const liveCardRightX =
    panelLeftX - THREAD_DETAILS_CARD_GAP - DETAILS_CARD_PORTAL_CORRIDOR_PX * (1 - panelProgress);

  const fanRatios = [0.12, 0.27, 0.42, 0.58, 0.73, 0.88];
  const fanBeeIndices = [8, 3, 1, 0, 2, 6] as const;
  const fanBees: WorkerBeeFrame[] = [];
  const starDust: Array<{ key: string; x: number; y: number; opacity: number; size: number }> = [];

  if (timeMs >= 840) {
    const sweepT = segment(timeMs, 840, 1740);
    const peelT = segment(timeMs, 1660, 2350);

    for (let i = 0; i < fanRatios.length; i++) {
      const yRatio = fanRatios[i]!;
      const distFromMid = Math.abs(yRatio - 0.5) * 2;
      const norm = (yRatio - 0.5) * 2;
      const fanOpen = easeOutQuint(sweepT);
      const targetY = viewport.height * yRatio;
      const yFromCenter = lerp(edgeY + norm * 72, targetY, clamp01(fanOpen * 1.4));

      const seamXAtY = panelLeftX + distFromMid * chevronDepth;
      let bx = cardStaysInline ? Math.max(seamXAtY - 8, liveCardRightX + 26) : seamXAtY - 12;
      let by = yFromCenter + Math.sin(timeMs * 0.018 + i * 1.1) * 4;
      let rot = norm * 16 * (1 - fanOpen * 0.6) - 6;
      let op = clamp01(segment(timeMs, 840 + distFromMid * 55, 970 + distFromMid * 55));
      let sc = lerp(0.55, 1, clamp01(fanOpen * 2.2));

      if (peelT > 0) {
        const p = easeOutCubic(peelT);
        const dirY = norm < 0 ? -1 : 1;
        if (cardStaysInline) {
          // Peel vertically along the docked board border so bees never cross into ThreadDetailsCard.
          const peelBaseX = Math.max(
            panelFinalLeftX + 14,
            panelFinalLeftX - THREAD_DETAILS_CARD_GAP + 26,
          );
          bx = peelBaseX + Math.sin(p * Math.PI) * 6;
          by = targetY + dirY * p * (84 + distFromMid * 52);
          rot = dirY * 18 * p;
        } else {
          bx = panelFinalLeftX - 14 - p * (55 + (1 - distFromMid) * 35);
          by = targetY + dirY * p * (52 + distFromMid * 44);
          rot = dirY * 26 * p;
        }
        op = 1 - easeInOutCubic(peelT);
        sc = 1 - peelT * 0.25;
      }

      fanBees.push({
        key: `fan-${i}`,
        bee: pickWorkerBee(fanBeeIndices[i]!),
        x: bx,
        y: by,
        width: 28,
        facing: "left",
        rotateDeg: rot,
        opacity: op,
        scale: sc,
        wingShiftY: Math.sin(timeMs * 0.07 + i * 1.3) * 1.5,
      });

      // One pollen mote in each bee's wake, kept inside the seam veil so it never sits on board text.
      if (sweepT > 0.06 && peelT < 0.35) {
        const dustFade = peelT > 0 ? 1 - peelT / 0.35 : 1;
        starDust.push({
          key: `dust-${i}`,
          x: bx + 18 + Math.sin(timeMs * 0.02 + i) * 3,
          y: by + norm * 6 + Math.cos(timeMs * 0.016 + i * 2.3) * 4,
          opacity: op * 0.6 * dustFade,
          size: 8,
        });
      }
    }
  }

  // Pixel sparkles burst from the header toggle the moment the collapsing card lands in it.
  if (detailsCard?.behavior === "collapse") {
    const burstT = segment(timeMs, DETAILS_CARD_TUCK_END_MS - 30, DETAILS_CARD_TUCK_END_MS + 390);
    if (burstT > 0 && burstT < 1) {
      const offset = resolveSwarmDetailsCardTuckOffset(detailsCard.rect, detailsCard.toggleRect);
      const cx = detailsCard.rect.left + detailsCard.rect.width + offset.x;
      const cy = detailsCard.rect.top + offset.y;
      const spread = easeOutCubic(burstT);
      for (let k = 0; k < 4; k++) {
        const angle = Math.PI / 4 + (Math.PI / 2) * k;
        const reach = lerp(10, k % 2 === 0 ? 30 : 24, spread);
        starDust.push({
          key: `toggle-burst-${k}`,
          x: cx + Math.cos(angle) * reach,
          y: cy + Math.sin(angle) * reach,
          opacity: (1 - easeInCubic(burstT)) * 0.95,
          size: k % 2 === 0 ? 9 : 7,
        });
      }
    }
  }

  if (timeMs >= 100 && timeMs <= 1180) {
    for (let i = 0; i < 8; i++) {
      const at = 120 + i * 85;
      const age = timeMs - at;
      if (age < 0 || age > 420) continue;
      const pt = cubicBezier(p0, p1, p2, p3, easeInOutCubic(i / 8));
      const life = 1 - age / 420;
      starDust.push({
        key: `glide-star-${i}`,
        x: pt.x + Math.cos(i * 3.1) * 12,
        y: pt.y + Math.sin(i * 2.4) * 12 - (1 - life) * 10,
        opacity: life * 0.9,
        size: i % 2 === 0 ? 11 : 8,
      });
    }
  }

  const chevronEdgePath = `M ${(panelLeftX + chevronDepth).toFixed(1)} 0 L ${panelLeftX.toFixed(1)} ${(viewport.height * 0.5).toFixed(1)} L ${(panelLeftX + chevronDepth).toFixed(1)} ${viewport.height}`;
  const chevronGlowPolygon = `${(panelLeftX + chevronDepth).toFixed(1)},0 ${(panelLeftX + chevronDepth + 44).toFixed(1)},0 ${(panelLeftX + 44).toFixed(1)},${(viewport.height * 0.5).toFixed(1)} ${(panelLeftX + chevronDepth + 44).toFixed(1)},${viewport.height} ${(panelLeftX + chevronDepth).toFixed(1)},${viewport.height} ${panelLeftX.toFixed(1)},${(viewport.height * 0.5).toFixed(1)}`;

  return (
    <div
      data-swarm-entrance-overlay="honeycomb-portal"
      aria-hidden="true"
      className={className ?? "pointer-events-none fixed inset-0 z-50 overflow-hidden select-none"}
      style={style}
    >
      {composerGlowOp > 0.01 && (
        <div
          style={{
            position: "absolute",
            left: startX - 110,
            top: composerTop - 64,
            width: 220,
            height: 64,
            opacity: composerGlowOp,
            background:
              "radial-gradient(ellipse at 50% 100%, rgba(139, 92, 246, 0.55) 0%, rgba(196, 181, 253, 0.2) 48%, transparent 75%)",
          }}
        />
      )}

      <svg
        aria-hidden
        width={viewport.width}
        height={viewport.height}
        className="pointer-events-none absolute inset-0"
      >
        <defs>
          <linearGradient id="swarm-portal-ribbon" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={SWARM_FX.violet} stopOpacity="0" />
            <stop offset="50%" stopColor={SWARM_FX.lavender} stopOpacity="0.65" />
            <stop offset="100%" stopColor={SWARM_FX.goldPale} stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="swarm-portal-seam" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={SWARM_FX.violet} stopOpacity="0.2" />
            <stop offset="22%" stopColor={SWARM_FX.violetLight} stopOpacity="0.95" />
            <stop offset="50%" stopColor={SWARM_FX.goldPale} stopOpacity="1" />
            <stop offset="78%" stopColor={SWARM_FX.violetLight} stopOpacity="0.95" />
            <stop offset="100%" stopColor={SWARM_FX.violet} stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="swarm-chevron-veil" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={SWARM_FX.violetSoft} stopOpacity="0.48" />
            <stop offset="45%" stopColor={SWARM_FX.violet} stopOpacity="0.16" />
            <stop offset="100%" stopColor={SWARM_FX.violet} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="swarm-portal-rift-glow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={SWARM_FX.violet} stopOpacity="0" />
            <stop offset="52%" stopColor={SWARM_FX.violetSoft} stopOpacity="0.22" />
            <stop offset="86%" stopColor={SWARM_FX.gold} stopOpacity="0.34" />
            <stop offset="100%" stopColor={SWARM_FX.goldPale} stopOpacity="0.58" />
          </linearGradient>
          <linearGradient id="swarm-portal-rift-alpha" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={SWARM_FX.goldLight} stopOpacity="0" />
            <stop offset="40%" stopColor={SWARM_FX.goldLight} stopOpacity="0.32" />
            <stop offset="78%" stopColor={SWARM_FX.goldLight} stopOpacity="0.92" />
            <stop offset="100%" stopColor={SWARM_FX.goldLight} stopOpacity="1" />
          </linearGradient>
          <mask id="swarm-portal-rift-mask">
            <rect
              x={viewport.width - 110}
              y={0}
              width={110}
              height={viewport.height}
              fill="url(#swarm-portal-rift-alpha)"
            />
          </mask>
          <pattern id="swarm-portal-hex" width="22" height="38" patternUnits="userSpaceOnUse">
            <path
              d="M11 0L22 6.3V19L11 25.3L0 19V6.3Z M22 19L33 25.3V38L22 44.3L11 38V25.3Z M0 19L11 25.3V38L0 44.3L-11 38V25.3Z"
              fill="none"
              stroke={SWARM_FX.lavender}
              strokeWidth="1.2"
            />
          </pattern>
        </defs>

        {ribbonPath && (
          <>
            <path
              d={ribbonPath}
              fill="none"
              stroke="url(#swarm-portal-ribbon)"
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={ribbonFade * 0.28}
            />
            <path
              d={ribbonPath}
              fill="none"
              stroke="url(#swarm-portal-ribbon)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={ribbonFade * 0.92}
            />
          </>
        )}

        {riftFade > 0.01 && (
          <g opacity={riftFade}>
            <rect
              x={viewport.width - 110}
              y={riftTop}
              width={110}
              height={riftHeight}
              fill="url(#swarm-portal-rift-glow)"
              mask="url(#swarm-portal-rift-mask)"
            />
            <rect
              x={viewport.width - 110}
              y={riftTop}
              width={110}
              height={riftHeight}
              fill="url(#swarm-portal-hex)"
              mask="url(#swarm-portal-rift-mask)"
              opacity={0.78}
            />
            <line
              x1={viewport.width - 6}
              y1={riftTop}
              x2={viewport.width - 6}
              y2={riftBottom}
              stroke={SWARM_FX.gold}
              strokeWidth={16}
              strokeLinecap="round"
              opacity={0.32}
            />
            <line
              x1={viewport.width - 4}
              y1={riftTop}
              x2={viewport.width - 4}
              y2={riftBottom}
              stroke="url(#swarm-portal-seam)"
              strokeWidth={4.5}
              strokeLinecap="round"
            />
          </g>
        )}

        {panel.revealed && panel.violetGlowOpacity > 0.01 && (
          <g opacity={panel.violetGlowOpacity}>
            <polygon points={chevronGlowPolygon} fill="url(#swarm-chevron-veil)" />
            <path
              d={chevronEdgePath}
              fill="none"
              stroke={SWARM_FX.violetSoft}
              strokeWidth={7}
              opacity={0.26}
            />
            <path
              d={chevronEdgePath}
              fill="none"
              stroke="url(#swarm-portal-seam)"
              strokeWidth={2.8}
              strokeLinejoin="round"
            />
          </g>
        )}
      </svg>

      {starDust.map((s) => (
        <div
          key={s.key}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            opacity: s.opacity,
            transform: `translate3d(${(s.x - s.size / 2).toFixed(1)}px, ${(s.y - s.size / 2).toFixed(1)}px, 0)`,
          }}
        >
          <SwarmPixelSparkle size={s.size} />
        </div>
      ))}

      {fanBees.map((frame) => (
        <AnimatedWorkerBee key={frame.key} frame={frame} />
      ))}

      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: clipBelowComposer
            ? `inset(0px 0px ${Math.max(0, viewport.height - composerTop).toFixed(1)}px 0px)`
            : undefined,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            opacity: mascotOpacity,
            transform: `translate3d(${(mascotX - 27).toFixed(2)}px, ${(mascotY - 23).toFixed(2)}px, 0) rotate(${mascotRotate.toFixed(2)}deg) scale(${mascotScale.toFixed(3)})`,
            transformOrigin: "center center",
            filter: "drop-shadow(0 6px 16px rgba(139, 92, 246, 0.5))",
          }}
        >
          <SwarmcodeMascotBee
            width={54}
            facing={mascotFacing}
            wingAngle={mascotWings.angle}
            wingScaleY={mascotWings.scaleY}
          />
        </div>
      </div>
    </div>
  );
}

type StyleSnapshot = ReadonlyArray<
  readonly [element: HTMLElement, property: string, value: string]
>;

const PANEL_STYLE_PROPERTIES = ["transition-property", "width", "clip-path"] as const;
const DETAILS_CARD_STYLE_PROPERTIES = [
  "transition-property",
  "transform",
  "transform-origin",
  "opacity",
  "will-change",
  "pointer-events",
] as const;
const TOGGLE_STYLE_PROPERTIES = [
  "transition-property",
  "transform",
  "box-shadow",
  "border-radius",
] as const;

function snapshotStyles(
  element: HTMLElement | null,
  properties: ReadonlyArray<string>,
): StyleSnapshot {
  if (!element) return [];
  return properties.map((property) => [
    element,
    property,
    element.style.getPropertyValue(property),
  ]);
}

function restoreStyles(snapshot: StyleSnapshot): void {
  for (const [element, property, value] of snapshot) {
    if (value === "") element.style.removeProperty(property);
    else element.style.setProperty(property, value);
  }
}

interface PanelHandle {
  readonly element: HTMLElement;
  readonly snapshot: StyleSnapshot;
}

function bindPanelHandle(element: HTMLElement): PanelHandle {
  const snapshot = snapshotStyles(element, PANEL_STYLE_PROPERTIES);
  // Same switch the resize drag uses: the shell owns transition-duration, so only the property is muted.
  element.style.transitionProperty = "none";
  return { element, snapshot };
}

function applyPanelPresentation(panel: PanelHandle, pres: SwarmPanelPresentation): void {
  panel.element.style.width = `${pres.widthPx}px`;
  panel.element.style.clipPath = buildChevronClipPath(pres.chevronClipPx) ?? "";
}

function applyDetailsCardPresentation(
  element: HTMLElement,
  pres: SwarmDetailsCardPresentation,
): void {
  const hasTransform =
    Math.abs(pres.translateXPx) > 0.05 ||
    Math.abs(pres.translateYPx) > 0.05 ||
    Math.abs(pres.scale - 1) > 0.001;
  element.style.transform = hasTransform
    ? `translate3d(${pres.translateXPx.toFixed(2)}px, ${pres.translateYPx.toFixed(2)}px, 0) scale(${pres.scale.toFixed(4)})`
    : "";
  element.style.opacity = pres.opacity < 0.999 ? pres.opacity.toFixed(3) : "";
  element.style.pointerEvents = pres.opacity < 0.15 ? "none" : "";
}

function applyTogglePulse(element: HTMLElement, pulse: number): void {
  element.style.transform = `scale(${(1 + pulse * 0.12).toFixed(4)})`;
  element.style.boxShadow = `0 0 0 2px rgba(167, 139, 250, ${(pulse * 0.85).toFixed(3)}), 0 0 14px rgba(139, 92, 246, ${(pulse * 0.55).toFixed(3)})`;
}

/**
 * When the real layout keeps the "collapse" card inline after the board settles (its width
 * differed from the estimate), unfold it back out of the toggle instead of leaving it hidden.
 */
export function recoverStrandedDetailsCard(
  planned: SwarmDetailsCardPresentation,
  sinceStrandedMs: number,
): SwarmDetailsCardPresentation {
  const back = easeOutCubic(segment(sinceStrandedMs, 120, 420));
  if (back === 0) return planned;
  return {
    translateXPx: lerp(planned.translateXPx, 0, back),
    translateYPx: lerp(planned.translateYPx, 0, back),
    scale: lerp(planned.scale, 1, back),
    opacity: lerp(planned.opacity, 1, back),
    togglePulse: planned.togglePulse,
  };
}

function estimatePanelTargetWidth(
  threadKey: string,
  viewportWidth: number,
  canvasWidth: number,
): number {
  let width = DEFAULT_PANEL_WIDTH;
  try {
    const raw = window.localStorage.getItem(`t3code:preview-panel-width:${threadKey}`);
    if (raw !== null) {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) width = parsed;
    }
  } catch {
    // Ignore restricted storage environments.
  }
  const fractionCap = Math.floor(viewportWidth * MAX_PANEL_WIDTH_FRACTION);
  const containerCap =
    canvasWidth > 0 ? Math.floor(canvasWidth) - SIBLING_COLUMN_MIN_WIDTH : Infinity;
  const maxWidth = Math.max(MIN_PANEL_WIDTH, Math.min(fractionCap, containerCap));
  return Math.max(MIN_PANEL_WIDTH, Math.min(width, maxWidth));
}

function readRect(element: Element | null): SwarmComposerRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

interface InitialEntranceLayout {
  readonly panelTargetWidth: number;
  readonly detailsCardContext: SwarmDetailsCardContext | null;
}

function measureInitialEntranceLayout(threadKey: string): InitialEntranceLayout {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { panelTargetWidth: DEFAULT_PANEL_WIDTH, detailsCardContext: null };
  }
  const canvasEl = document.querySelector<HTMLElement>("[data-chat-canvas]");
  const initialCanvasWidth = canvasEl?.clientWidth ?? window.innerWidth;
  const panelTargetWidth = estimatePanelTargetWidth(
    threadKey,
    window.innerWidth,
    initialCanvasWidth,
  );
  const rect = readRect(document.querySelector('[data-thread-details-panel="inline"]'));
  if (!rect) return { panelTargetWidth, detailsCardContext: null };
  const behavior = resolveSwarmDetailsCardBehavior({
    hasInlineDetailsCard: true,
    canvasWidth: initialCanvasWidth,
    panelTargetWidth,
    detailsCardWidth: rect.width,
  });
  return {
    panelTargetWidth,
    detailsCardContext: {
      behavior,
      rect,
      toggleRect: readRect(document.querySelector("[data-thread-panel-toggle]")),
    },
  };
}

function readViewport(): SwarmEntranceViewport {
  return {
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  };
}

function SwarmEntranceRunner(props: { readonly entrance: ActiveSwarmEntrance }) {
  const { entrance } = props;
  const [timeMs, setTimeMs] = useState(0);
  const [viewport, setViewport] = useState(readViewport);
  const [initialLayout] = useState(() => measureInitialEntranceLayout(entrance.threadKey));
  const [panelTargetWidth, setPanelTargetWidth] = useState(initialLayout.panelTargetWidth);
  const revealedRef = useRef(false);
  const runRef = useRef(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives finite rAF animation timeline synchronized with the right panel and thread details card DOM
  useEffect(() => {
    const run = ++runRef.current;
    const reveal = () => {
      if (revealedRef.current) return;
      revealedRef.current = true;
      entrance.onRevealBoard();
    };
    const skipMotion =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.visibilityState === "hidden";
    if (skipMotion) {
      reveal();
      finishSwarmEntrance(entrance.id);
      return;
    }

    const startAt = performance.now();
    let rafId = 0;
    let finished = false;
    let targetWidth = initialLayout.panelTargetWidth;
    let viewportWidth = window.innerWidth;
    let viewportHeight = window.innerHeight;

    let panel: PanelHandle | null = null;
    let panelMaximized = false;
    const bindPanel = () => {
      if (panel?.element.isConnected) return panel;
      if (panelMaximized) return null;
      const element = document.querySelector<HTMLElement>('[data-right-panel-shell="true"]');
      if (!element) return null;
      if (element.dataset.previewPanelMaximized === "true") {
        panelMaximized = true;
        return null;
      }
      if (panel) restoreStyles(panel.snapshot);
      panel = bindPanelHandle(element);
      const width = Number.parseFloat(element.style.getPropertyValue(RESIZABLE_WIDTH_PROPERTY));
      if (Number.isFinite(width) && width >= MIN_PANEL_WIDTH && width !== targetWidth) {
        targetWidth = width;
        setPanelTargetWidth(width);
      }
      return panel;
    };

    const detailsContext = initialLayout.detailsCardContext;
    const detailsBehavior = detailsContext?.behavior ?? "none";
    const tuckOffset = detailsContext
      ? resolveSwarmDetailsCardTuckOffset(detailsContext.rect, detailsContext.toggleRect)
      : undefined;
    const detailsEl =
      detailsBehavior === "none"
        ? null
        : document.querySelector<HTMLElement>('[data-thread-details-panel="inline"]');
    const detailsSnapshot = snapshotStyles(detailsEl, DETAILS_CARD_STYLE_PROPERTIES);
    if (detailsEl) {
      detailsEl.style.transitionProperty = "none";
      detailsEl.style.transformOrigin = "top right";
      detailsEl.style.willChange = "transform, opacity";
    }
    let strandedAtMs: number | null = null;

    let toggle: { readonly element: HTMLElement; readonly snapshot: StyleSnapshot } | null = null;
    const releaseToggle = () => {
      if (toggle) restoreStyles(toggle.snapshot);
      toggle = null;
    };
    const pulseToggle = (pulse: number) => {
      if (pulse <= 0.01) {
        releaseToggle();
        return;
      }
      if (!toggle?.element.isConnected) {
        releaseToggle();
        const element = document.querySelector<HTMLElement>("[data-thread-panel-toggle]");
        if (!element) return;
        toggle = { element, snapshot: snapshotStyles(element, TOGGLE_STYLE_PROPERTIES) };
        element.style.transitionProperty = "none";
        element.style.borderRadius = "8px";
      }
      applyTogglePulse(toggle.element, pulse);
    };

    const restoreAll = () => {
      if (finished) return;
      finished = true;
      window.cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (panel) restoreStyles(panel.snapshot);
      restoreStyles(detailsSnapshot);
      releaseToggle();
    };
    const complete = () => {
      restoreAll();
      reveal();
      finishSwarmEntrance(entrance.id);
    };
    // rAF stops in hidden tabs; open the board right away instead of waiting for the user to return.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") complete();
    };

    const tick = (now: number) => {
      const elapsed = Math.min(SWARM_ENTRANCE_TIMING.durationMs, now - startAt);
      if (window.innerWidth !== viewportWidth || window.innerHeight !== viewportHeight) {
        viewportWidth = window.innerWidth;
        viewportHeight = window.innerHeight;
        setViewport({ width: viewportWidth, height: viewportHeight });
      }
      setTimeMs(elapsed);

      if (elapsed >= SWARM_ENTRANCE_TIMING.revealAtMs) reveal();

      const pres = computeSwarmPanelPresentation(elapsed, targetWidth);
      if (pres.revealed) {
        const boundPanel = bindPanel();
        if (boundPanel) applyPanelPresentation(boundPanel, pres);
      }

      if (detailsBehavior !== "none") {
        let cardPres = computeSwarmDetailsCardPresentation(
          detailsBehavior,
          elapsed,
          pres.widthPx,
          targetWidth,
          tuckOffset,
        );
        if (detailsEl?.isConnected) {
          if (detailsBehavior === "collapse" && pres.widthPx >= targetWidth) {
            strandedAtMs ??= elapsed;
            cardPres = recoverStrandedDetailsCard(cardPres, elapsed - strandedAtMs);
          }
          applyDetailsCardPresentation(detailsEl, cardPres);
        }
        pulseToggle(cardPres.togglePulse);
      }

      if (elapsed >= SWARM_ENTRANCE_TIMING.durationMs) {
        complete();
        return;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    rafId = window.requestAnimationFrame(tick);
    return () => {
      restoreAll();
      // StrictMode re-runs this effect immediately; only a real teardown (cancel, unmount) reveals.
      queueMicrotask(() => {
        if (runRef.current === run) reveal();
      });
    };
  }, [entrance, initialLayout]);

  return (
    <SwarmEntranceScene
      timeMs={timeMs}
      composerRect={entrance.composerRect}
      viewport={viewport}
      panelTargetWidth={panelTargetWidth}
      detailsCard={initialLayout.detailsCardContext}
    />
  );
}

/** Mounted once at the top of ChatView; unmounts completely when no entrance is playing. */
export function SwarmEntranceOverlay() {
  const entrance = useActiveSwarmEntrance();
  if (!entrance) return null;
  return <SwarmEntranceRunner key={entrance.id} entrance={entrance} />;
}
