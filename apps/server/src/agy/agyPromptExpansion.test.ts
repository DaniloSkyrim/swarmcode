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

it("a provider's native command wins, except the board commands", () => {
  const antigravity = { driver: "antigravity", nativeGoals: true };
  assert.isNull(expandAgyCommandText("/plan build it", antigravity));
  assert.isNull(expandAgyCommandText("/plan /goal build it", antigravity));
  assert.include(expandAgyCommandText("/swarm build it", antigravity) ?? "", "<swarm_coordinator>");
  assert.include(expandAgyCommandText("/boost build it", antigravity) ?? "", "<boost>");
  assert.isNull(expandAgyCommandText("/goal ship it", claude));
  assert.include(expandAgyCommandText("/goal ship it", cursor) ?? "", "<goal_mode>");
  assert.isNull(expandAgyCommandText("/goal ship it", { driver: "opencode", nativeGoals: false }));
});

it("stacked native and board commands still expand the board command cleanly", () => {
  const antigravity = { driver: "antigravity", nativeGoals: true };
  for (const prompt of ["/plan /swarm build it", "/swarm /plan build it"]) {
    const expanded = expandAgyCommandText(prompt, antigravity);
    assert.isNotNull(expanded);
    assert.include(expanded!, "<plan_mode>");
    assert.include(expanded!, "<swarm_coordinator>");
    assert.include(expanded!, "<user_request>\nbuild it\n</user_request>");
    assert.isFalse(expanded!.trimStart().startsWith("/"));
  }
  const claudeGoalSwarm = expandAgyCommandText("/goal /swarm ship it", claude);
  assert.isNotNull(claudeGoalSwarm);
  assert.include(claudeGoalSwarm!, "<goal_mode>");
  assert.include(claudeGoalSwarm!, "<swarm_coordinator>");
  assert.include(claudeGoalSwarm!, "<user_request>\nship it\n</user_request>");
  assert.isNull(expandAgyCommandText("/plan /swarm board", antigravity));
});

it("other text and the swarm board UI command pass through", () => {
  assert.isNull(expandAgyCommandText("please /plan this", cursor));
  assert.isNull(expandAgyCommandText("/compact", cursor));
  assert.isNull(expandAgyCommandText("/swarm board", cursor));
  assert.isNull(expandAgyCommandText("/planner x", cursor));
});
