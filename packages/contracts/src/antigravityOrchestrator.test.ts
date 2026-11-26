import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  ANTIGRAVITY_LEGACY_ORCHESTRATOR_MODELS,
  ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS,
  ANTIGRAVITY_ORCHESTRATOR_MODEL,
  ANTIGRAVITY_ORCHESTRATOR_PLANNER_MODELS,
  AntigravityOrchestratorSettings,
  DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
  isAntigravityLegacyOrchestratorModel,
  isAntigravityOrchestratorExecutorModel,
  isAntigravityOrchestratorModel,
  isAntigravityOrchestratorPlannerModel,
  legacyAntigravityOrchestratorPlannerModel,
  normalizeAntigravityThinkingLevel,
  supportedAntigravityThinkingLevels,
} from "./antigravityOrchestrator.ts";
import { AntigravitySettings } from "./settings.ts";

const decodeOrchestratorSettings = Schema.decodeSync(AntigravityOrchestratorSettings);
const decodeUnknownOrchestratorSettings = Schema.decodeUnknownSync(AntigravityOrchestratorSettings);
const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);

describe("antigravityOrchestrator contracts", () => {
  it("restricts planner and executor models to the allowed Antigravity set", () => {
    expect(ANTIGRAVITY_ORCHESTRATOR_PLANNER_MODELS).toEqual(["gemini-4-neon", "gemini-4-carbon"]);
    expect(ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS).toEqual([
      "gemini-4-hydrogen",
      "gemini-4-carbon",
      "gemini-4-neon",
    ]);
    expect(isAntigravityOrchestratorModel(ANTIGRAVITY_ORCHESTRATOR_MODEL)).toBe(true);
    expect(isAntigravityOrchestratorModel("gemini-4-neon")).toBe(false);
    expect(isAntigravityOrchestratorPlannerModel("gemini-4-neon")).toBe(true);
    expect(isAntigravityOrchestratorPlannerModel("gemini-4-hydrogen")).toBe(false);
    expect(isAntigravityOrchestratorExecutorModel("gemini-4-hydrogen")).toBe(true);
    expect(isAntigravityOrchestratorExecutorModel("claude-sonnet-5-5")).toBe(false);
  });

  it("identifies and maps legacy native agy orchestrator presets", () => {
    for (const slug of ANTIGRAVITY_LEGACY_ORCHESTRATOR_MODELS) {
      expect(isAntigravityLegacyOrchestratorModel(slug)).toBe(true);
    }
    expect(legacyAntigravityOrchestratorPlannerModel("gemini-pro-orchestrator-neon")).toBe(
      "gemini-4-neon",
    );
    expect(legacyAntigravityOrchestratorPlannerModel("gemini-pro-orchestrator")).toBe(
      "gemini-4-carbon",
    );
    expect(legacyAntigravityOrchestratorPlannerModel("gemini-pro-orchestrator-g1-pro")).toBe(
      "gemini-4-carbon",
    );
    expect(legacyAntigravityOrchestratorPlannerModel("gemini-pro-orchestrator-argon")).toBe(
      "gemini-4-carbon",
    );
    expect(legacyAntigravityOrchestratorPlannerModel("gemini-4-hydrogen-orchestrator")).toBe(
      "gemini-4-carbon",
    );
    expect(legacyAntigravityOrchestratorPlannerModel("gemini-4-neon")).toBeUndefined();
  });

  it("clamps thinking levels for Carbon while allowing xhigh for Neon and Hydrogen", () => {
    expect(supportedAntigravityThinkingLevels("gemini-4-carbon")).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(supportedAntigravityThinkingLevels("gemini-4-neon")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(supportedAntigravityThinkingLevels("gemini-4-hydrogen")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);

    expect(normalizeAntigravityThinkingLevel("gemini-4-carbon", "xhigh")).toBe("high");
    expect(normalizeAntigravityThinkingLevel("gemini-4-neon", "xhigh")).toBe("xhigh");
    expect(normalizeAntigravityThinkingLevel("gemini-4-hydrogen", "invalid", "low")).toBe("low");
    expect(normalizeAntigravityThinkingLevel("gemini-4-carbon", undefined, "xhigh")).toBe("high");
  });

  it("decodes AntigravityOrchestratorSettings and AntigravitySettings with defaults", () => {
    const decoded = decodeOrchestratorSettings({});
    expect(decoded).toEqual(DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS);

    const providerSettings = decodeAntigravitySettings({});
    expect(providerSettings.orchestrator).toEqual(DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS);

    const customSettings = decodeAntigravitySettings({
      orchestrator: {
        plannerModel: "gemini-4-carbon",
        plannerEffort: "high",
        executorModel: "gemini-4-neon",
        executorEffort: "xhigh",
      },
    });
    expect(customSettings.orchestrator).toEqual({
      plannerModel: "gemini-4-carbon",
      plannerEffort: "high",
      executorModel: "gemini-4-neon",
      executorEffort: "xhigh",
    });

    expect(() =>
      decodeUnknownOrchestratorSettings({
        plannerModel: "gemini-4-hydrogen",
      }),
    ).toThrow();
    expect(() =>
      decodeUnknownOrchestratorSettings({
        executorModel: "claude-sonnet-5-5",
      }),
    ).toThrow();
  });
});
