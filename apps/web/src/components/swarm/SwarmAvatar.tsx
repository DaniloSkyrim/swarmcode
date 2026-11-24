import type { AgySwarmMemberState } from "@t3tools/contracts";
import { msg, useMessages } from "gt-react";

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
  x?: number;
  y?: number;
  width: number;
  className?: string;
}) {
  const paths = props.bee.queen ? QUEEN_PATHS : WORKER_PATHS;
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

/** A member's bee on its tinted tile, decorative: callers render the name beside it. */
export function SwarmAvatar(props: {
  bee: BeeColors;
  cue?: BeeCue | undefined;
  working?: boolean | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  const small = props.size === "sm";
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-md",
        small ? "size-5" : "size-7",
        props.bee.tile,
        props.className,
      )}
    >
      <BeeSprite bee={props.bee} cue={props.cue} working={props.working} width={small ? 18 : 24} />
    </span>
  );
}

/** Filled while a member works or waits on you, hollow while it waits on the board. Never animated. */
export function SwarmStateDot(props: { state: AgySwarmMemberState; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[props.state], props.className)}
    />
  );
}
