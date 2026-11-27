// Fork: swarm tools stay eagerly listed in `deferred-proxy` mode (Antigravity) alongside upstream's direct set.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as McpToolExposure from "../mcp/McpToolExposure.ts";

describe("swarm tool exposure", () => {
  it("lists swarm tools directly in deferred-proxy mode without adding them to deferred mode", () => {
    const exposure = McpToolExposure.make(
      () => [],
      () => Effect.void,
    );

    const swarmTools = ["t3_swarm", "post_message", "read_board", "swarm_wait"] as const;
    for (const tool of swarmTools) {
      expect(exposure.isListed("session-1", tool, "deferred-proxy"), tool).toBe(true);
      expect(exposure.isListed("session-1", tool, "deferred"), tool).toBe(false);
    }

    expect(exposure.isListed("session-1", McpToolExposure.TOOL_CALL, "deferred-proxy")).toBe(true);
    expect(exposure.isListed("session-1", McpToolExposure.TOOL_SEARCH, "deferred-proxy")).toBe(
      true,
    );
    expect(exposure.isListed("session-1", "preview_open", "deferred-proxy")).toBe(false);
  });
});
