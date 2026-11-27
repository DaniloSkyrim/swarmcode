import type { CSSProperties, SVGProps } from "react";

import { cn } from "~/lib/utils";

// Official 32x32 pixel-art bee extracted from scripts/agy/brand/swarmcode-512.png,
// split into body and wing layers so the icy-blue wings can flap cleanly in flight.
const BEE_BODY_LAYERS: ReadonlyArray<readonly [fill: string, d: string]> = [
  [
    "#22161e",
    "M4 6h2v1h-2zM10 6h2v1h-2zM3 7h4v1h-4zM9 7h4v1h-4zM3 8h3v1h-3zM10 8h3v1h-3zM4 9h3v1h-3zM10 9h4v1h-4zM5 10h3v1h-3zM10 10h3v1h-3zM6 11h7v1h-7zM6 12h3v1h-3zM10 12h6v1h-6zM21 12h3v1h-3zM5 13h1v1h-1zM24 13h1v1h-1zM4 14h1v1h-1zM25 14h1v1h-1zM4 15h1v1h-1zM26 15h1v1h-1zM3 16h1v1h-1zM8 16h1v1h-1zM27 16h1v1h-1zM3 17h1v1h-1zM7 17h2v1h-2zM27 17h1v1h-1zM3 18h1v1h-1zM27 18h2v1h-2zM4 19h1v1h-1zM27 19h3v1h-3zM4 20h1v1h-1zM27 20h2v1h-2zM5 21h1v1h-1zM26 21h1v1h-1zM6 22h3v1h-3zM10 22h2v1h-2zM25 22h1v1h-1zM9 23h1v1h-1zM12 23h1v1h-1zM24 23h1v1h-1zM13 24h3v1h-3zM21 24h3v1h-3zM16 25h5v1h-5z",
  ],
  [
    "#ffee8c",
    "M9 12h1v1h-1zM18 12h3v1h-3zM6 13h3v1h-3zM10 13h6v1h-6zM23 13h1v1h-1zM5 14h1v1h-1zM24 14h1v1h-1zM25 15h1v1h-1zM4 16h1v1h-1zM26 16h1v1h-1z",
  ],
  [
    "#2a1a16",
    "M16 12h2v1h-2zM16 13h2v1h-2zM21 13h2v1h-2zM16 14h2v1h-2zM21 14h2v1h-2zM16 15h2v1h-2zM21 15h2v1h-2zM16 16h2v1h-2zM21 16h2v1h-2zM16 17h2v1h-2zM21 17h2v1h-2zM16 18h2v1h-2zM21 18h2v1h-2zM16 19h2v1h-2zM21 19h2v1h-2zM16 20h2v1h-2zM21 20h2v1h-2zM16 21h2v1h-2zM21 21h2v1h-2zM16 22h2v1h-2zM21 22h2v1h-2zM16 23h2v1h-2zM21 23h2v1h-2zM16 24h2v1h-2z",
  ],
  [
    "#ffce2e",
    "M9 13h1v1h-1zM18 13h3v1h-3zM6 14h10v1h-10zM18 14h3v1h-3zM23 14h1v1h-1zM5 15h11v1h-11zM18 15h3v1h-3zM23 15h2v1h-2zM5 16h2v1h-2zM9 16h7v1h-7zM18 16h3v1h-3zM23 16h3v1h-3zM5 17h2v1h-2zM9 17h7v1h-7zM18 17h3v1h-3zM23 17h4v1h-4zM5 18h11v1h-11zM18 18h3v1h-3zM23 18h4v1h-4zM6 19h3v1h-3zM11 19h5v1h-5zM18 19h3v1h-3zM23 19h3v1h-3zM9 20h1v1h-1zM12 20h4v1h-4zM18 20h3v1h-3zM23 20h2v1h-2zM13 21h3v1h-3zM18 21h3v1h-3zM23 21h1v1h-1zM18 22h3v1h-3z",
  ],
  ["#ffffff", "M7 16h1v1h-1z"],
  [
    "#e89614",
    "M4 17h1v1h-1zM4 18h1v1h-1zM5 19h1v1h-1zM26 19h1v1h-1zM5 20h4v1h-4zM10 20h2v1h-2zM25 20h2v1h-2zM6 21h7v1h-7zM24 21h2v1h-2zM9 22h1v1h-1zM12 22h4v1h-4zM23 22h2v1h-2zM13 23h3v1h-3zM18 23h3v1h-3zM23 23h1v1h-1zM18 24h3v1h-3z",
  ],
  ["#ff8096", "M9 19h2v1h-2z"],
];

const BEE_WING_LAYERS: ReadonlyArray<readonly [fill: string, d: string]> = [
  [
    "#22161e",
    "M17 3h3v1h-3zM16 4h1v1h-1zM20 4h1v1h-1zM15 5h1v1h-1zM21 5h4v1h-4zM14 6h1v1h-1zM25 6h1v1h-1zM14 7h1v1h-1zM26 7h1v1h-1zM14 8h1v1h-1zM26 8h1v1h-1zM27 9h1v1h-1zM14 10h1v1h-1zM27 10h1v1h-1zM14 11h1v1h-1zM27 11h1v1h-1zM26 12h1v1h-1zM26 13h1v1h-1z",
  ],
  [
    "#d6f0ff",
    "M17 4h3v1h-3zM16 5h5v1h-5zM15 6h2v1h-2zM19 6h3v1h-3zM15 7h2v1h-2zM18 7h4v1h-4zM15 8h1v1h-1zM17 8h5v1h-5zM14 9h9v1h-9zM15 10h7v1h-7zM15 11h7v1h-7zM15 12h1v1h-1zM21 12h1v1h-1z",
  ],
  ["#ffffff", "M17 6h2v1h-2zM17 7h1v1h-1zM23 7h1v1h-1zM16 8h1v1h-1zM22 8h1v1h-1z"],
  [
    "#96c4eb",
    "M22 6h3v1h-3zM22 7h1v1h-1zM24 7h2v1h-2zM23 8h3v1h-3zM23 9h4v1h-4zM22 10h5v1h-5zM22 11h5v1h-5zM22 12h4v1h-4zM24 13h2v1h-2z",
  ],
];

const SWARMCODE_BEE_ASPECT = 25 / 29;

export function SwarmcodeMascotBee(props: {
  width: number;
  facing?: "left" | "right" | undefined;
  wingAngle?: number | undefined;
  wingScaleY?: number | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}) {
  const { width, facing = "left", wingAngle = 0, wingScaleY = 1, className, style } = props;
  const height = width * SWARMCODE_BEE_ASPECT;
  const wingTransform =
    wingAngle !== 0 || wingScaleY !== 1
      ? `translate(19 12) rotate(${wingAngle.toFixed(2)}) scale(1 ${wingScaleY.toFixed(3)}) translate(-19 -12)`
      : undefined;

  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox="2 2 29 25"
      shapeRendering="crispEdges"
      overflow="visible"
      className={cn("shrink-0 select-none", className)}
      style={style}
    >
      <g transform={facing === "right" ? "translate(33 0) scale(-1 1)" : undefined}>
        <g data-mascot-body>
          {BEE_BODY_LAYERS.map(([fill, d]) => (
            <path key={fill} d={d} fill={fill} />
          ))}
        </g>
        <g data-mascot-wings transform={wingTransform}>
          {BEE_WING_LAYERS.map(([fill, d]) => (
            <path key={fill} d={d} fill={fill} />
          ))}
        </g>
      </g>
    </svg>
  );
}

/** Square UI icon version of the official Swarmcode bee for tabs, badges, and menus. */
export function SwarmcodeBeeIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden
      viewBox="2 0 29 29"
      overflow="visible"
      className={cn("shrink-0 select-none", className)}
      {...props}
    >
      <g>
        {BEE_BODY_LAYERS.map(([fill, d]) => (
          <path key={fill} d={d} fill={fill} />
        ))}
      </g>
      <g>
        {BEE_WING_LAYERS.map(([fill, d]) => (
          <path key={fill} d={d} fill={fill} />
        ))}
      </g>
    </svg>
  );
}

/** 3x3 pixel-art 4-point sparkle matching the Swarmcode app icon's ambient stars. */
export function SwarmPixelSparkle(props: {
  size: number;
  tone?: "icon" | "violet" | "gold" | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}) {
  const { size, tone = "icon", className, style } = props;
  const centerFill = tone === "violet" ? "#e9d5ff" : "#ffee8c";
  const tipFill = tone === "gold" ? "#ffce2e" : "#c9a7ff";

  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 3 3"
      shapeRendering="crispEdges"
      className={cn("shrink-0 select-none", className)}
      style={style}
    >
      <path d="M1 0h1v1h-1zM0 1h1v1h-1zM2 1h1v1h-1zM1 2h1v1h-1z" fill={tipFill} />
      <rect x={1} y={1} width={1} height={1} fill={centerFill} />
    </svg>
  );
}
