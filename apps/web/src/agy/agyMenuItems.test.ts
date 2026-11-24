import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { m } from "../i18n/messages";
import { AGY_MENU_ITEM_ID_PREFIX, agySlashCommandItems } from "./agyMenuItems";

const provider = ProviderDriverKind.make("codex");

describe("agySlashCommandItems", () => {
  it("builds provider-command-shaped items and yields to native commands", () => {
    const items = agySlashCommandItems({
      provider,
      providerSlashCommands: [{ name: "plan" }],
      prompt: "/",
      rangeStart: 0,
      uiAvailable: new Set(["diff"]),
      resolve: m,
    });
    const labels = items.map((item) => item.label);
    expect(labels).not.toContain("/plan");
    expect(labels).toContain("/grill-me");
    expect(labels).toContain("/diff");
    expect(items.every((item) => item.id.startsWith(AGY_MENU_ITEM_ID_PREFIX))).toBe(true);
    expect(items.find((item) => item.label === "/swarm")?.command.input?.hint).toBe("<task>");
  });

  it("stacks after a leading prompt command", () => {
    const items = agySlashCommandItems({
      provider,
      providerSlashCommands: [],
      prompt: "/plan /",
      rangeStart: 6,
      uiAvailable: new Set(["diff"]),
      resolve: m,
    });
    expect(items.map((item) => item.label)).toContain("/grill-me");
    expect(items.map((item) => item.label)).not.toContain("/diff");
  });
});
