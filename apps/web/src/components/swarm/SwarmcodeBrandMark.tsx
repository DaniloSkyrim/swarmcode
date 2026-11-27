import { useId } from "react";

import { cn } from "~/lib/utils";
import { SwarmcodeBeeIcon, SwarmPixelSparkle } from "./SwarmcodeMascotBee";

const BACKDROP_SWARM_TEXT_STYLE = {
  backgroundImage: "linear-gradient(180deg, #fff7cc 0%, #ffd447 52%, #f59e0b 100%)",
  filter: "drop-shadow(0 0 8px rgba(255, 206, 46, 0.28))",
} as const;

const BACKDROP_CODE_TEXT_STYLE = {
  color: "#d6f0ff",
} as const;

const BEE_SHADOW_STYLE = {
  filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45))",
} as const;

const HEX_FILL_STOPS: ReadonlyArray<readonly [offset: string, color: string]> = [
  ["0", "#3c2473"],
  ["0.55", "#24164a"],
  ["1", "#140d2b"],
];

const HEX_GLOW_STOPS: ReadonlyArray<readonly [offset: string, color: string, opacity: string]> = [
  ["0", "#ffce2e", "0.32"],
  ["1", "#ffce2e", "0"],
];

const HEX_STROKE_STOPS: ReadonlyArray<readonly [offset: string, color: string, opacity: string]> = [
  ["0", "#ffee8c", "0.85"],
  ["0.5", "#ffce2e", "0.55"],
  ["1", "#a78bfa", "0.6"],
];

/**
 * Custom Swarmcode brand mark for the sidebar header (swapped in by scripts/agy/apply-brand.ts).
 * Pairs a cosmic-violet honeycomb hex badge holding the official Swarmcode bee with a two-tone
 * honey-gold + icy-frost wordmark and a pixel sparkle accent. Static at rest; subtle hover lift.
 */
export function SwarmcodeBrandMark({ onBackdrop }: { readonly onBackdrop: boolean }) {
  const idPrefix = useId().replaceAll(":", "");
  const hexFillId = `${idPrefix}-swarm-hex-fill`;
  const hexGlowId = `${idPrefix}-swarm-hex-glow`;
  const hexStrokeId = `${idPrefix}-swarm-hex-stroke`;

  return (
    <span
      data-swarmcode-brand=""
      className={cn(
        "group inline-flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors duration-200",
        onBackdrop ? "hover:bg-white/10" : "hover:bg-accent/60",
      )}
    >
      <span className="relative grid size-5 shrink-0 place-items-center">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
        >
          <defs>
            <linearGradient
              id={hexFillId}
              x1="3"
              y1="2"
              x2="21"
              y2="22"
              gradientUnits="userSpaceOnUse"
            >
              {HEX_FILL_STOPS.map(([offset, color]) => (
                <stop key={offset} offset={offset} stopColor={color} />
              ))}
            </linearGradient>
            <radialGradient id={hexGlowId} cx="12" cy="12" r="9" gradientUnits="userSpaceOnUse">
              {HEX_GLOW_STOPS.map(([offset, color, opacity]) => (
                <stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
              ))}
            </radialGradient>
            <linearGradient
              id={hexStrokeId}
              x1="4"
              y1="2"
              x2="20"
              y2="22"
              gradientUnits="userSpaceOnUse"
            >
              {HEX_STROKE_STOPS.map(([offset, color, opacity]) => (
                <stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
              ))}
            </linearGradient>
          </defs>
          <path
            d="M10.8 1.5a2.4 2.4 0 0 1 2.4 0l7.3 4.2a2.4 2.4 0 0 1 1.2 2.08v8.44a2.4 2.4 0 0 1-1.2 2.08l-7.3 4.2a2.4 2.4 0 0 1-2.4 0l-7.3-4.2a2.4 2.4 0 0 1-1.2-2.08V7.78A2.4 2.4 0 0 1 3.5 5.7z"
            fill={`url(#${hexFillId})`}
            stroke={`url(#${hexStrokeId})`}
            strokeWidth="1.2"
          />
          <circle cx="12" cy="12" r="8.5" fill={`url(#${hexGlowId})`} />
        </svg>
        <SwarmcodeBeeIcon
          className="relative size-4 transition-transform duration-200 ease-out group-hover:-translate-y-px group-hover:-rotate-6"
          style={BEE_SHADOW_STYLE}
        />
      </span>

      <span className="inline-flex min-w-0 items-baseline text-sm leading-none">
        <span
          className={cn(
            "font-semibold tracking-tight",
            onBackdrop ? "bg-clip-text text-transparent" : "text-warning-foreground",
          )}
          style={onBackdrop ? BACKDROP_SWARM_TEXT_STYLE : undefined}
        >
          {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark */}
          {"Swarm"}
        </span>
        <span
          className={cn(
            "font-mono text-xs font-medium tracking-tight transition-[color,opacity] duration-200",
            onBackdrop
              ? "opacity-90 group-hover:opacity-100"
              : "text-muted-foreground group-hover:text-foreground",
          )}
          style={onBackdrop ? BACKDROP_CODE_TEXT_STYLE : undefined}
        >
          {"code"}
        </span>
      </span>

      <SwarmPixelSparkle
        size={6}
        tone="icon"
        className="-mt-2.5 -ml-1 opacity-80 transition-[opacity,transform] duration-200 group-hover:scale-110 group-hover:opacity-100"
      />
    </span>
  );
}
