import { assert, it } from "@effect/vitest";

import { detectAgyBoardCommandKind, expandAgyCommandText } from "./agyPromptExpansion.ts";

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

it("boost and teamwork are self-contained and do not stack swarm_coordinator unless /swarm is also passed", () => {
  const boostOnly = expandAgyCommandText("/boost fix the flaky test", cursor) ?? "";
  assert.include(boostOnly, "<boost>");
  assert.notInclude(boostOnly, "<swarm_coordinator>");

  const teamworkOnly = expandAgyCommandText("/teamwork build an app", cursor) ?? "";
  assert.include(teamworkOnly, "<teamwork>");
  assert.notInclude(teamworkOnly, "<swarm_coordinator>");

  const stacked = expandAgyCommandText("/boost /swarm fix the flaky test", cursor) ?? "";
  assert.strictEqual(stacked.split("<swarm_coordinator>").length - 1, 1);
  assert.include(stacked, "<boost>");

  assert.strictEqual(detectAgyBoardCommandKind("/boost investigate crash"), "boost");
  assert.strictEqual(detectAgyBoardCommandKind("/plan /teamwork build v2"), "teamwork");
  assert.strictEqual(detectAgyBoardCommandKind("/swarm ship it"), "swarm");
  assert.isNull(detectAgyBoardCommandKind("/swarm board"));
  assert.isNull(detectAgyBoardCommandKind("/plan design only"));
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

  // Kind-aware coordinator reminders tailor guidance for boost and teamwork boards.
  const boostReminded = expandAgyCommandText("Check round 1", {
    ...activeAntigravity,
    activeSwarmKind: "boost",
  });
  assert.include(boostReminded ?? "", "/boost");
  assert.include(boostReminded ?? "", "spot-checking");

  const teamworkReminded = expandAgyCommandText("What is milestone 2 status?", {
    ...activeAntigravity,
    activeSwarmKind: "teamwork",
  });
  assert.include(teamworkReminded ?? "", "/teamwork");
  assert.include(teamworkReminded ?? "", "Sentinel");
});
