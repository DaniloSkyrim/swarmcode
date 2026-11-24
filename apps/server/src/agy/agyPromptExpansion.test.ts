import { assert, it } from "@effect/vitest";

import { expandAgyCommandText } from "./agyPromptExpansion.ts";

const claude = { driver: "claudeAgent", nativeGoals: true };
const cursor = { driver: "cursor", nativeGoals: false };

it("stacked commands expand into their instructions, and the text no longer reads as a command", () => {
  const text = expandAgyCommandText("/plan /grill-me add OAuth login", cursor);
  assert.isNotNull(text);
  assert.include(text!, "<plan_mode>");
  assert.include(text!, "<grill_me>");
  assert.include(text!, "add OAuth login");
  assert.isFalse(text!.trimStart().startsWith("/"));
});

it("swarm-shaped commands carry the coordinator rules once", () => {
  const text = expandAgyCommandText("/boost /swarm fix the flaky test", cursor) ?? "";
  assert.strictEqual(text.split("<swarm_coordinator>").length - 1, 1);
  assert.include(text, "<boost>");
});

it("a provider's native command wins", () => {
  assert.isNull(
    expandAgyCommandText("/swarm build it", { driver: "antigravity", nativeGoals: true }),
  );
  assert.isNull(expandAgyCommandText("/goal ship it", claude));
  assert.include(expandAgyCommandText("/goal ship it", cursor) ?? "", "<goal_mode>");
  assert.isNull(expandAgyCommandText("/goal ship it", { driver: "opencode", nativeGoals: false }));
});

it("other text and the swarm board UI command pass through", () => {
  assert.isNull(expandAgyCommandText("please /plan this", cursor));
  assert.isNull(expandAgyCommandText("/compact", cursor));
  assert.isNull(expandAgyCommandText("/swarm board", cursor));
  assert.isNull(expandAgyCommandText("/planner x", cursor));
});
