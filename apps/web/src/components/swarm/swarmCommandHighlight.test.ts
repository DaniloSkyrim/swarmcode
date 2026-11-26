import { describe, expect, it } from "vite-plus/test";

import { findSwarmCommandRanges, hasSwarmCommand } from "./swarmCommandHighlight";

describe("findSwarmCommandRanges", () => {
  it("matches standalone /swarm at start, middle, and end of text", () => {
    expect(findSwarmCommandRanges("/swarm")).toEqual([{ start: 0, end: 6 }]);
    expect(findSwarmCommandRanges("/swarm build the overview")).toEqual([{ start: 0, end: 6 }]);
    expect(findSwarmCommandRanges("/plan /swarm refactor")).toEqual([{ start: 6, end: 12 }]);
    expect(findSwarmCommandRanges("please run /swarm")).toEqual([{ start: 11, end: 17 }]);
  });

  it("matches multiple occurrences and punctuation boundaries", () => {
    expect(findSwarmCommandRanges("/swarm first, then (/swarm)!")).toEqual([
      { start: 0, end: 6 },
      { start: 20, end: 26 },
    ]);
  });

  it("ignores URLs, file paths, and longer slash commands", () => {
    expect(findSwarmCommandRanges("https://example.com/swarm")).toEqual([]);
    expect(findSwarmCommandRanges("src/components/swarm/SwarmPanel.tsx")).toEqual([]);
    expect(findSwarmCommandRanges("/swarmcode /swarms /teamwork /boost")).toEqual([]);
    expect(hasSwarmCommand("just normal text")).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(findSwarmCommandRanges("/Swarm go")).toEqual([{ start: 0, end: 6 }]);
  });
});
