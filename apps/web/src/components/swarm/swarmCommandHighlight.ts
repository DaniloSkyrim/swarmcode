export interface SwarmCommandRange {
  readonly start: number;
  readonly end: number;
}

const SWARM_COMMAND_RE = /(^|[\s([{"'])\/swarm(?=$|[\s.,!?;:)\]}"'])/gi;

export const SWARM_COMMAND_HIGHLIGHT_CLASS =
  "inline rounded-[5px] bg-violet-500/12 px-1 py-px -mx-0.5 font-medium text-violet-600 ring-1 ring-inset ring-violet-500/20 dark:bg-violet-500/18 dark:text-violet-300 dark:ring-violet-400/25";

/**
 * Matches standalone `/swarm` slash commands in user prompt text while skipping
 * paths, URLs (`https://.../swarm`), and longer identifiers (`/swarmcode`).
 */
export function findSwarmCommandRanges(text: string): ReadonlyArray<SwarmCommandRange> {
  if (!text.includes("/") || !text.toLowerCase().includes("/swarm")) return [];
  const ranges: SwarmCommandRange[] = [];
  SWARM_COMMAND_RE.lastIndex = 0;
  for (const match of text.matchAll(SWARM_COMMAND_RE)) {
    const prefixLength = match[1]?.length ?? 0;
    const start = (match.index ?? 0) + prefixLength;
    ranges.push({ start, end: start + 6 });
  }
  return ranges;
}

export function hasSwarmCommand(text: string): boolean {
  return findSwarmCommandRanges(text).length > 0;
}
