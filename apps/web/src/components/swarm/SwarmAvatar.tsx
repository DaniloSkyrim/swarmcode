import type { AgySwarmMemberState } from "@t3tools/contracts";
import { msg, useMessages } from "gt-react";
import { useId } from "react";

import { cn } from "~/lib/utils";
import type { BeeColors, BeeCue } from "./swarmBoard.logic";

const STATE_LABELS = {
  working: msg("Working", { $context: "swarm member state" }),
  waiting: msg("Waiting", { $context: "swarm member state" }),
  "needs-input": msg("Needs input", { $context: "swarm member state" }),
  stopped: msg("Stopped", { $context: "swarm member state" }),
  killed: msg("Retired", { $context: "swarm member state" }),
} as const;

// The thread list's colours for the same states, so a member reads like a thread does.
export const MEMBER_STATE_TEXT: Record<AgySwarmMemberState, string> = {
  working: "text-info-foreground",
  "needs-input": "text-warning-foreground",
  waiting: "text-muted-foreground",
  stopped: "text-muted-foreground",
  killed: "text-muted-foreground/70",
};

const STATE_DOT: Record<AgySwarmMemberState, string> = {
  working: "bg-info",
  "needs-input": "bg-warning",
  waiting: "border border-muted-foreground/60",
  stopped: "border border-muted-foreground/40",
  killed: "bg-muted-foreground/30",
};

export function useMemberStateLabel() {
  const resolve = useMessages();
  return (state: AgySwarmMemberState) => resolve(STATE_LABELS[state]);
}

// A 12 by 10 pixel bee facing left, drawn in the app icon's family. o outline, h head, b body,
// s ink stripe, w wing, a antenna, P pupil, E eye glint, c cheek, i stinger, k K crown.
const WORKER_SPRITE = [
  "............",
  "..a..a......",
  "...aa..ww...",
  "..oooowwww..",
  ".ohhhhowwwo.",
  "ohhhhbsbbsbo",
  "ohPEhbsbbsbo",
  "ohPhhbsbbsbi",
  ".ochhbsbbso.",
  "..ooooooooo.",
];
const QUEEN_SPRITE = [".k.k.k......", ".kkkkk......", ".KKKKK.ww...", ...WORKER_SPRITE.slice(3)];
const SLEEPING_WORKER_SPRITE = [
  "............",
  "..a..a......",
  "...aa.......",
  "..ooooooo...",
  ".ohhhhwwww..",
  "ohhhhbsbbsbo",
  "ohPPhbsbbsbo",
  "ohhhhbsbbsbi",
  ".ochhbsbbso.",
  "..ooooooooo.",
];
const SLEEPING_QUEEN_SPRITE = [
  ".k.k.k......",
  ".kkkkk......",
  ".KKKKK......",
  ...SLEEPING_WORKER_SPRITE.slice(3),
];

type Layer =
  | "outline"
  | "head"
  | "body"
  | "ink"
  | "wing"
  | "glint"
  | "cheek"
  | "crown"
  | "crownShade";
const LAYER_OF: Record<string, Layer> = {
  o: "outline",
  a: "outline",
  i: "outline",
  h: "head",
  b: "body",
  s: "ink",
  P: "ink",
  w: "wing",
  E: "glint",
  c: "cheek",
  k: "crown",
  K: "crownShade",
};
const FIXED_FILL: Partial<Record<Layer, string>> = {
  ink: "fill-stone-900",
  wing: "fill-slate-400 dark:fill-slate-300",
  glint: "fill-white",
  cheek: "fill-pink-300",
  crown: "fill-yellow-300",
  crownShade: "fill-amber-600",
};

/** One path per colour, each row's runs merged, built once per sprite. */
function spritePaths(sprite: ReadonlyArray<string>) {
  const paths = new Map<Layer, string>();
  sprite.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const layer = LAYER_OF[row[x]!];
      let end = x + 1;
      while (end < row.length && row[end] === row[x]) end += 1;
      if (layer) paths.set(layer, `${paths.get(layer) ?? ""}M${x} ${y}h${end - x}v1h${x - end}z`);
      x = end;
    }
  });
  return [...paths];
}
const WORKER_PATHS = spritePaths(WORKER_SPRITE);
const QUEEN_PATHS = spritePaths(QUEEN_SPRITE);
const SLEEPING_WORKER_PATHS = spritePaths(SLEEPING_WORKER_SPRITE);
const SLEEPING_QUEEN_PATHS = spritePaths(SLEEPING_QUEEN_SPRITE);
const SLEEPING_Z_PATH = "M0 0h5v1h-5zM3 1h1v1h-1zM2 2h1v1h-1zM1 3h1v1h-1zM0 4h5v1h-5z";

const STEP = (count: number) => `steps(${count}, jump-none)`;

// Finite and only on an event, so nothing repaints while the board sits still.
function playCue(svg: SVGSVGElement | null, kind: BeeCue["kind"]) {
  if (!svg || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const bee = svg.querySelector("[data-bee]");
  const wing = svg.querySelector("[data-bee-wing]");
  if (kind === "flap") {
    wing?.animate([{ transform: "translateY(0)" }, { transform: "translateY(-1px)" }], {
      duration: 80,
      iterations: 6,
      direction: "alternate",
      easing: STEP(2),
    });
    bee?.animate(
      [
        { transform: "translateY(0)" },
        { transform: "translateY(-1px)" },
        { transform: "translateY(0)" },
      ],
      {
        duration: 480,
        easing: STEP(3),
      },
    );
    return;
  }
  wing?.animate([{ transform: "translateY(-1px)" }, { transform: "translateY(0)" }], {
    duration: 90,
    iterations: 4,
    direction: "alternate",
    easing: STEP(2),
  });
  bee?.animate([{ transform: "translateY(-2px)" }, { transform: "translateY(0)" }], {
    duration: 360,
    easing: STEP(3),
  });
}
const flap = (svg: SVGSVGElement | null) => playCue(svg, "flap");
const settle = (svg: SVGSVGElement | null) => playCue(svg, "settle");

// The one loop, as Antigravity's working bees flap: user-approved exception to the no-repaint
// rule, held to a 2-frame step about 4 times a second and cancelled when the member stops.
function workingWings(wing: SVGPathElement | null) {
  if (!wing || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const loop = wing.animate([{ transform: "translateY(0)" }, { transform: "translateY(-1px)" }], {
    duration: 500,
    iterations: Infinity,
    direction: "alternate",
    easing: STEP(2),
  });
  return () => loop.cancel();
}

/**
 * The bare sprite, usable inside HTML or another SVG. A `cue` plays once when it mounts or its
 * key changes; callers only pass one for something that happened while the view was open.
 * `working` flaps the wings until it turns false; pass it only in a roster, one bee per member.
 */
export function BeeSprite(props: {
  bee: BeeColors;
  cue?: BeeCue | undefined;
  working?: boolean | undefined;
  sleeping?: boolean | undefined;
  wingOffsetY?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
  width: number;
  className?: string | undefined;
}) {
  const sleeping = props.sleeping === true && props.working !== true;
  const paths = props.bee.queen
    ? sleeping
      ? SLEEPING_QUEEN_PATHS
      : QUEEN_PATHS
    : sleeping
      ? SLEEPING_WORKER_PATHS
      : WORKER_PATHS;
  return (
    <svg
      key={props.cue?.key}
      ref={props.cue === undefined ? undefined : props.cue.kind === "flap" ? flap : settle}
      aria-hidden
      x={props.x}
      y={props.y}
      width={props.width}
      height={(props.width * 10) / 12}
      viewBox="0 0 12 10"
      shapeRendering="crispEdges"
      overflow="visible"
      className={cn("shrink-0", props.className)}
    >
      <g data-bee>
        {paths.map(([layer, d]) => (
          <path
            key={layer}
            d={d}
            data-bee-wing={layer === "wing" ? "" : undefined}
            transform={
              layer === "wing" && props.wingOffsetY !== undefined
                ? `translate(0 ${props.wingOffsetY.toFixed(2)})`
                : undefined
            }
            ref={layer === "wing" && props.working ? workingWings : undefined}
            className={
              layer === "outline" || layer === "head" || layer === "body"
                ? props.bee[layer]
                : FIXED_FILL[layer]
            }
          />
        ))}
      </g>
    </svg>
  );
}

function HoneycombPattern() {
  const patternId = useId();
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full text-foreground/[0.09] dark:text-foreground/[0.11]"
    >
      <defs>
        <pattern
          id={patternId}
          width="16"
          height="28"
          patternUnits="userSpaceOnUse"
          patternTransform="scale(0.9)"
        >
          <path
            d="M8 0L16 4.6V13.8L8 18.4L0 13.8V4.6Z M16 14L24 18.6V27.8L16 32.4L8 27.8V18.6Z M0 14L8 18.6V27.8L0 32.4L-8 27.8V18.6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}

function SleepingZGlyph(props: { className?: string | undefined }) {
  return (
    <svg
      aria-hidden
      width="8"
      height="8"
      viewBox="0 0 5 5"
      shapeRendering="crispEdges"
      className={cn("pointer-events-none absolute fill-muted-foreground/75", props.className)}
    >
      <path d={SLEEPING_Z_PATH} />
    </svg>
  );
}

export type SwarmAvatarSize = "sm" | "md" | "lg" | "tile" | "spotlight";

const AVATAR_SIZE_STYLES: Record<
  SwarmAvatarSize,
  { readonly box: string; readonly beeWidth: number; readonly zOffset: string }
> = {
  sm: { box: "size-5 rounded-md", beeWidth: 18, zOffset: "top-0.5 left-0.5 size-1.5" },
  md: { box: "size-7 rounded-md", beeWidth: 24, zOffset: "top-0.5 left-0.5 size-2" },
  lg: { box: "size-9 rounded-lg", beeWidth: 26, zOffset: "top-1 left-1 size-2" },
  tile: { box: "size-13 rounded-xl", beeWidth: 34, zOffset: "top-1.5 left-1.5 size-2" },
  spotlight: { box: "size-18 rounded-xl", beeWidth: 46, zOffset: "top-2 left-2 size-2.5" },
};

/** A member's bee on its tinted tile, decorative: callers render the name beside it. */
export function SwarmAvatar(props: {
  bee: BeeColors;
  cue?: BeeCue | undefined;
  working?: boolean | undefined;
  sleeping?: boolean | undefined;
  honeycomb?: boolean | undefined;
  bordered?: boolean | undefined;
  size?: SwarmAvatarSize | undefined;
  className?: string | undefined;
}) {
  const size = props.size ?? "md";
  const spec = AVATAR_SIZE_STYLES[size];
  const showSleeping = props.sleeping === true && props.working !== true;
  const showHoneycomb = props.honeycomb === true;
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden",
        spec.box,
        showHoneycomb ? "bg-muted/70 dark:bg-card" : props.bee.tile,
        props.bordered &&
          (showHoneycomb ? "border border-border/80" : cn("border", props.bee.border)),
        props.className,
      )}
    >
      {showHoneycomb ? <HoneycombPattern /> : null}
      {showSleeping && (size === "tile" || size === "spotlight" || size === "lg") ? (
        <SleepingZGlyph className={spec.zOffset} />
      ) : null}
      <BeeSprite
        bee={props.bee}
        cue={props.cue}
        working={props.working}
        sleeping={showSleeping}
        width={spec.beeWidth}
        className="relative"
      />
    </span>
  );
}

/** Three-bee cluster tile representing all workers in Overview's team selector. */
export function SwarmAllTile(props: {
  bees: ReadonlyArray<BeeColors>;
  className?: string | undefined;
}) {
  const first = props.bees[0];
  const second = props.bees[1] ?? first;
  const third = props.bees[2] ?? second;
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid size-13 shrink-0 place-items-center overflow-hidden rounded-xl border border-border/70 bg-muted/60 dark:bg-card",
        props.className,
      )}
    >
      {first ? (
        <span className="relative h-8 w-10">
          <BeeSprite bee={first} width={17} className="absolute top-0 left-0.5" />
          {second ? (
            <BeeSprite bee={second} width={17} className="absolute top-0 right-0.5" />
          ) : null}
          {third ? (
            <BeeSprite
              bee={third}
              width={17}
              className="absolute bottom-0 left-1/2 -translate-x-1/2"
            />
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/** Filled while a member works or waits on you, hollow while it waits on the board. Never animated. */
export function SwarmStateDot(props: {
  state: AgySwarmMemberState;
  className?: string | undefined;
}) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[props.state], props.className)}
    />
  );
}
