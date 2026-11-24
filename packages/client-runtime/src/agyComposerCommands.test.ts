import { describe, expect, it } from "vite-plus/test";

import {
  agyCommandsMayStack,
  agyHelpCommandNames,
  agyInteractionModeForText,
  agyMenuCommands,
  agyNativeCommandNames,
  agyUiCommandRunsOnSelect,
  parseAgyUiCommand,
} from "./agyComposerCommands.ts";

const allUi = new Set(["diff", "rename", "swarm board", "usage", "help", "new"]);
const noNative = agyNativeCommandNames([]);
const names = (input: Parameters<typeof agyMenuCommands>[0]) =>
  agyMenuCommands(input).map((command) => command.name);

describe("agyMenuCommands", () => {
  it("offers prompt and available UI commands at the start of an empty prompt", () => {
    const result = names({ textBeforeTrigger: "", nativeNames: noNative, uiAvailable: allUi });
    expect(result).toContain("plan");
    expect(result).toContain("swarm");
    expect(result).toContain("diff");
    expect(result).not.toContain("rewind");
  });

  it("hides a command the provider already advertises", () => {
    const native = agyNativeCommandNames([{ name: "Plan" }, { name: "goal" }]);
    const result = names({ textBeforeTrigger: "", nativeNames: native, uiAvailable: allUi });
    expect(result).not.toContain("plan");
    expect(result).not.toContain("goal");
    expect(result).toContain("boost");
  });

  it("hides the swarm board when the provider owns /swarm", () => {
    const native = agyNativeCommandNames([{ name: "swarm" }]);
    const result = names({ textBeforeTrigger: "", nativeNames: native, uiAvailable: allUi });
    expect(result).not.toContain("swarm");
    expect(result).not.toContain("swarm board");
  });

  it("stacks prompt commands after earlier ones and drops the ones already used", () => {
    const result = names({
      textBeforeTrigger: "/plan ",
      nativeNames: noNative,
      uiAvailable: allUi,
    });
    expect(result).toContain("grill-me");
    expect(result).not.toContain("plan");
    expect(result).not.toContain("diff");
  });

  it("offers nothing after ordinary text", () => {
    expect(
      names({ textBeforeTrigger: "fix this /", nativeNames: noNative, uiAvailable: allUi }),
    ).toEqual([]);
    expect(agyCommandsMayStack("/model ")).toBe(false);
  });

  it("resolves descriptions through the given resolver", () => {
    const [first] = agyMenuCommands({
      textBeforeTrigger: "",
      nativeNames: noNative,
      uiAvailable: new Set(),
    });
    expect(first?.name).toBe("plan");
    expect(first?.description).toContain("implementation plan");
  });
});

describe("agyInteractionModeForText", () => {
  it("uses plan mode when /plan leads, alone or stacked", () => {
    expect(agyInteractionModeForText("/plan build it")).toBe("plan");
    expect(agyInteractionModeForText("/grill-me /plan build it")).toBe("plan");
    expect(agyInteractionModeForText("/plan")).toBe("plan");
  });

  it("keeps default mode for everything else", () => {
    expect(agyInteractionModeForText("build it")).toBe("default");
    expect(agyInteractionModeForText("/grill-me build it")).toBe("default");
    expect(agyInteractionModeForText("please /plan this")).toBe("default");
  });
});

describe("parseAgyUiCommand", () => {
  it("parses a bare UI command and the swarm board", () => {
    expect(parseAgyUiCommand("/diff", noNative, allUi)).toEqual({ name: "diff", argument: "" });
    expect(parseAgyUiCommand("/swarm board", noNative, allUi)).toEqual({
      name: "swarm board",
      argument: "",
    });
  });

  it("requires a name for /rename and rejects arguments on the others", () => {
    expect(parseAgyUiCommand("/rename New title", noNative, allUi)).toEqual({
      name: "rename",
      argument: "New title",
    });
    expect(parseAgyUiCommand("/rename", noNative, allUi)).toBeNull();
    expect(parseAgyUiCommand("/diff now", noNative, allUi)).toBeNull();
  });

  it("ignores unavailable, native-owned, prompt, and plain text", () => {
    expect(parseAgyUiCommand("/fork", noNative, allUi)).toBeNull();
    expect(parseAgyUiCommand("/diff", agyNativeCommandNames([{ name: "diff" }]), allUi)).toBeNull();
    expect(parseAgyUiCommand("/swarm build x", noNative, allUi)).toBeNull();
    expect(parseAgyUiCommand("diff", noNative, allUi)).toBeNull();
  });
});

describe("helpers", () => {
  it("runs UI commands on select except /rename", () => {
    expect(agyUiCommandRunsOnSelect("diff")).toBe(true);
    expect(agyUiCommandRunsOnSelect("rename")).toBe(false);
    expect(agyUiCommandRunsOnSelect("plan")).toBe(false);
  });

  it("lists slash names for /help", () => {
    expect(agyHelpCommandNames(noNative, new Set(["diff"]))).toContain("/diff");
  });
});
