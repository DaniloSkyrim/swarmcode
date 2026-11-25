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

it("active swarm coordinators receive a short reminder on plain messages, not on commands or wakes", () => {
  const activeAntigravity = {
    driver: "antigravity",
    nativeGoals: true,
    activeSwarmCoordinator: true,
  };
  const reminded = expandAgyCommandText("Add two workers for the tests", activeAntigravity);
  assert.isNotNull(reminded);
  assert.include(reminded!, "<swarm_coordinator_reminder>");
  assert.include(reminded!, "Add two workers for the tests");

  // Explicit /swarm expands the full coordinator prompt without duplicating the reminder.
  const explicitSwarm = expandAgyCommandText("/swarm add two workers", activeAntigravity) ?? "";
  assert.include(explicitSwarm, "<swarm_coordinator>");
  assert.notInclude(explicitSwarm, "<swarm_coordinator_reminder>");

  // Explicit slash commands and board wakeups are left untouched.
  assert.isNull(expandAgyCommandText("/plan rethink architecture", activeAntigravity));
  assert.isNull(expandAgyCommandText("/compact", activeAntigravity));
  assert.isNull(expandAgyCommandText("/swarm board", activeAntigravity));
  assert.isNull(
    expandAgyCommandText("[swarm] New on the board for you, coordinator:", activeAntigravity),
  );
});
