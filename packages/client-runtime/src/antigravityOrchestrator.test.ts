import {
  ANTIGRAVITY_ORCHESTRATOR_MODEL,
  ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS,
  DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
  ProviderInstanceId,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { describe, expect, it } from "vite-plus/test";
import {
  buildAntigravityOrchestratorSelection,
  formatAntigravityOrchestratorEffortSummary,
  formatAntigravityOrchestratorShortPair,
  formatAntigravityOrchestratorTriggerLabel,
  getAntigravityExecutorGuide,
  getAntigravityPlannerGuide,
  readAntigravityOrchestratorSettings,
  resolveAntigravityOrchestratorPair,
  updateAntigravityOrchestratorSelection,
} from "./antigravityOrchestrator.ts";

const INSTANCE_ID = ProviderInstanceId.make("antigravity");

const SAMPLE_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gemini-4-neon",
    name: "Gemini 4 Neon",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        {
          id: "thought_level",
          type: "select",
          label: "Thinking Level",
          role: "reasoning",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
            { id: "xhigh", label: "Extra" },
          ],
          currentValue: "medium",
        },
      ],
    }),
  },
  {
    slug: "gemini-4-carbon",
    name: "Gemini 4 Carbon",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        {
          id: "thought_level",
          type: "select",
          label: "Thinking Level",
          role: "reasoning",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
          currentValue: "medium",
        },
      ],
    }),
  },
  {
    slug: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        {
          id: "thought_level",
          type: "select",
          label: "Thinking Level",
          role: "reasoning",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
            { id: "xhigh", label: "Extra" },
          ],
          currentValue: "medium",
        },
      ],
    }),
  },
];

describe("antigravityOrchestrator client-runtime helpers", () => {
  it("reads provider config orchestrator settings with defaults and Carbon clamping", () => {
    expect(readAntigravityOrchestratorSettings(undefined)).toEqual(
      DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
    );
    expect(
      readAntigravityOrchestratorSettings({
        orchestrator: {
          plannerModel: "gemini-4-carbon",
          plannerEffort: "xhigh",
          executorModel: "gemini-4-neon",
          executorEffort: "xhigh",
        },
      }),
    ).toEqual({
      plannerModel: "gemini-4-carbon",
      plannerEffort: "high",
      executorModel: "gemini-4-neon",
      executorEffort: "xhigh",
    });
  });

  it("builds, resolves, updates, and formats orchestrator selections", () => {
    const selection = buildAntigravityOrchestratorSelection(INSTANCE_ID, {
      plannerModel: "gemini-4-neon",
      plannerEffort: "xhigh",
      executorModel: "gemini-4-hydrogen",
      executorEffort: "low",
    });
    expect(selection).toEqual({
      instanceId: INSTANCE_ID,
      model: ANTIGRAVITY_ORCHESTRATOR_MODEL,
      options: [
        { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerModel, value: "gemini-4-neon" },
        { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerEffort, value: "xhigh" },
        { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorModel, value: "gemini-4-hydrogen" },
        { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorEffort, value: "low" },
      ],
    });

    const switched = updateAntigravityOrchestratorSelection(
      selection,
      { plannerModel: "gemini-4-carbon" },
      DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
      SAMPLE_MODELS,
    );
    const resolved = resolveAntigravityOrchestratorPair(
      switched,
      DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
      SAMPLE_MODELS,
    );
    expect(resolved).toEqual({
      plannerModel: "gemini-4-carbon",
      plannerEffort: "high",
      executorModel: "gemini-4-hydrogen",
      executorEffort: "low",
    });
    expect(formatAntigravityOrchestratorShortPair(resolved)).toBe("Carbon → Hydrogen");
    expect(formatAntigravityOrchestratorTriggerLabel(resolved)).toBe(
      "Orchestrator · Carbon → Hydrogen",
    );
    expect(formatAntigravityOrchestratorEffortSummary(resolved)).toBe("High / Low");
    expect(
      formatAntigravityOrchestratorEffortSummary({
        plannerEffort: "medium",
        executorEffort: "medium",
      }),
    ).toBe("Medium");
  });

  it("migrates legacy orchestrator slugs to their planner model", () => {
    const resolved = resolveAntigravityOrchestratorPair(
      { instanceId: INSTANCE_ID, model: "gemini-pro-orchestrator" },
      DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
      SAMPLE_MODELS,
    );
    expect(resolved.plannerModel).toBe("gemini-4-carbon");
    expect(resolved.executorModel).toBe("gemini-4-hydrogen");
  });

  it("provides guidance metadata for planners and executors", () => {
    const neonPlanner = getAntigravityPlannerGuide("gemini-4-neon");
    expect(neonPlanner.badge).toBe("Recommended");
    expect(neonPlanner.pros.length).toBeGreaterThanOrEqual(2);
    expect(neonPlanner.idealFor.length).toBeGreaterThan(0);

    const hydrogenExecutor = getAntigravityExecutorGuide("gemini-4-hydrogen");
    expect(hydrogenExecutor.badge).toBe("Recommended");
    expect(hydrogenExecutor.pros.length).toBeGreaterThanOrEqual(2);
  });
});
