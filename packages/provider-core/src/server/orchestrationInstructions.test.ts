import { assert, describe, it } from "@effect/vitest";

import {
  T3_CODE_DEVICE_TOOL_INSTRUCTIONS,
  T3_CODE_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH,
  T3_CODE_ORCHESTRATION_INSTRUCTIONS,
  t3AcpPromptWithInstructions,
  t3OrchestrationPrompt,
  t3OrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";

describe("T3 device instructions", () => {
  it("route device work through device_open and give Claude the line that loads the tools", () => {
    for (const intent of ["`device_list`", "`device_open`", "`agent-device`", "ssh", "`hostId`"]) {
      assert.include(T3_CODE_DEVICE_TOOL_INSTRUCTIONS, intent);
    }
    assert.notInclude(T3_CODE_DEVICE_TOOL_INSTRUCTIONS, "ToolSearch");
    const loadLine =
      " Load them with ToolSearch `select:mcp__t3-code__device_list,mcp__t3-code__device_open,mcp__t3-code__device_screenshot,mcp__t3-code__device_close`.";
    assert.include(T3_CODE_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH, loadLine);
    assert.equal(
      T3_CODE_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH.replace(loadLine, ""),
      T3_CODE_DEVICE_TOOL_INSTRUCTIONS,
    );
  });

  it("open the app before the returned command's snapshots, screenshots and input", () => {
    assert.include(
      T3_CODE_DEVICE_TOOL_INSTRUCTIONS,
      "its snapshots, screenshots and input need `open <app>` first,",
    );
  });

  it("keep the failure rule from taking over or closing a session another thread holds", () => {
    // agent-device's DEVICE_IN_USE advice is to rerun with the owner's --session or close it first.
    assert.include(
      T3_CODE_DEVICE_TOOL_INSTRUCTIONS,
      "follow its advice once, but never reuse or close another session unless the user explicitly asked; if it still fails,",
    );
  });

  it("reach OpenCode and Cursor only when the session holds device access", () => {
    assert.include(t3OrchestrationSystemPrompt(true, true), T3_CODE_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(t3OrchestrationSystemPrompt(true, false), "## T3 Code devices");
    assert.isUndefined(t3OrchestrationSystemPrompt(false, true));

    const firstRun = (hasDeviceTools: boolean) =>
      t3OrchestrationPrompt({
        prompt: "Check the login screen.",
        hasT3Mcp: true,
        hasDeviceTools,
        orchestrationDelivered: false,
        deviceInstructionsDelivered: false,
      });
    assert.include(firstRun(true), T3_CODE_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(firstRun(false), "## T3 Code devices");

    const laterRun = (deviceInstructionsDelivered: boolean) =>
      t3OrchestrationPrompt({
        prompt: "Check the login screen.",
        hasT3Mcp: true,
        hasDeviceTools: true,
        orchestrationDelivered: true,
        deviceInstructionsDelivered,
      });
    assert.include(laterRun(false), T3_CODE_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(laterRun(false), T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim());
    assert.equal(laterRun(true), "Check the login screen.");

    // A provider's own guidance reaches a conversation that already had the rest.
    const providerRun = (providerInstructionsDelivered: boolean) =>
      t3OrchestrationPrompt({
        prompt: "Check the login screen.",
        hasT3Mcp: true,
        hasDeviceTools: false,
        orchestrationDelivered: true,
        deviceInstructionsDelivered: false,
        providerInstructions: "Mark awaited shells.",
        providerInstructionsDelivered,
      });
    assert.include(providerRun(false), "Mark awaited shells.");
    assert.notInclude(providerRun(false), T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim());
    assert.equal(providerRun(true), "Check the login screen.");
  });

  it("reach ACP agents again when device access changes mid-thread", () => {
    const state = { interactionMode: "default", hasT3Mcp: true, hasDeviceTools: false } as const;
    const withDevices = t3AcpPromptWithInstructions({
      prompt: "Check the login screen.",
      state: { ...state, hasDeviceTools: true },
      previousState: state,
    });
    assert.include(withDevices, T3_CODE_DEVICE_TOOL_INSTRUCTIONS);
    assert.equal(
      t3AcpPromptWithInstructions({ prompt: "Again.", state, previousState: state }),
      "Again.",
    );
    assert.notInclude(t3AcpPromptWithInstructions({ prompt: "Hi.", state }), "## T3 Code devices");
  });

  it("instructs proxy-mode ACP sessions to use tool_search + t3_call instead of shell fallback", () => {
    const base = { interactionMode: "default", hasT3Mcp: true, hasDeviceTools: false } as const;
    const proxy = { ...base, mcpToolExposure: "proxy" as const };
    const text = t3AcpPromptWithInstructions({ prompt: "Open preview.", state: proxy });
    assert.include(text, "tool_search");
    assert.include(text, "t3_call");
    assert.notInclude(text, "T3_ACP_MCP_CALL");
    assert.notInclude(text, "Try the name once before you call it absent.");

    // Switching exposure mode triggers re-delivery; identical state skips.
    assert.equal(
      t3AcpPromptWithInstructions({ prompt: "Next.", state: proxy, previousState: proxy }),
      "Next.",
    );
    assert.include(
      t3AcpPromptWithInstructions({ prompt: "Next.", state: proxy, previousState: base }),
      "t3_call",
    );
  });

  it("emits compact swarm-member instructions across ACP, Prompt, and System helpers without changing non-swarm output", () => {
    const baseState = {
      interactionMode: "default",
      hasT3Mcp: true,
      hasDeviceTools: false,
    } as const;
    const regularAcp = t3AcpPromptWithInstructions({ prompt: "Do work.", state: baseState });
    const swarmAcp = t3AcpPromptWithInstructions({
      prompt: "Do work.",
      state: { ...baseState, isSwarmMember: true },
    });
    assert.isBelow(swarmAcp.length, regularAcp.length);
    assert.include(swarmAcp, "`t3_swarm`");
    assert.notInclude(swarmAcp, "## T3 Code browser");
    assert.notInclude(swarmAcp, "Visuals and preview");

    const regularProxy = t3AcpPromptWithInstructions({
      prompt: "Do work.",
      state: { ...baseState, mcpToolExposure: "proxy" },
    });
    const swarmProxy = t3AcpPromptWithInstructions({
      prompt: "Do work.",
      state: { ...baseState, mcpToolExposure: "proxy", isSwarmMember: true },
    });
    assert.isBelow(swarmProxy.length, regularProxy.length);
    assert.include(swarmProxy, "tool_search");
    assert.include(swarmProxy, "t3_call");
    assert.notInclude(swarmProxy, "delegate_task");

    const regularPrompt = t3OrchestrationPrompt({
      prompt: "Do work.",
      hasT3Mcp: true,
      hasDeviceTools: false,
      orchestrationDelivered: false,
      deviceInstructionsDelivered: false,
    });
    const swarmPrompt = t3OrchestrationPrompt({
      prompt: "Do work.",
      hasT3Mcp: true,
      hasDeviceTools: false,
      orchestrationDelivered: false,
      deviceInstructionsDelivered: false,
      isSwarmMember: true,
    });
    assert.isBelow(swarmPrompt.length, regularPrompt.length);
    assert.notInclude(swarmPrompt, "Visuals and preview");

    const regularSys = t3OrchestrationSystemPrompt(true, false)!;
    const swarmSys = t3OrchestrationSystemPrompt(true, false, true)!;
    assert.isBelow(swarmSys.length, regularSys.length);
    assert.include(swarmSys, "swarm worker");
  });
});
