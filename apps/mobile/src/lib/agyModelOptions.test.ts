import { describe, expect, it } from "vite-plus/test";

import {
  ANTIGRAVITY_ORCHESTRATOR_MODEL,
  ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS,
  ProviderInstanceId,
  type ModelSelection,
  type ServerConfig,
} from "@t3tools/contracts";

import { buildModelOptions } from "./modelOptions";

const instanceId = ProviderInstanceId.make("antigravity");

describe("mobile Antigravity Orchestrator model options", () => {
  it("formats Antigravity Orchestrator labels from catalog defaults and active overrides", () => {
    const orchestratorConfig = {
      providers: [
        {
          instanceId: instanceId,
          driver: "antigravity",
          displayName: "Google Work",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: ANTIGRAVITY_ORCHESTRATOR_MODEL,
              name: "Orchestrator",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerModel,
                    label: "Orchestrator Model",
                    type: "select",
                    options: [
                      { id: "gemini-4-neon", label: "Gemini 4 Neon", isDefault: true },
                      { id: "gemini-4-carbon", label: "Gemini 4 Carbon" },
                    ],
                    currentValue: "gemini-4-neon",
                  },
                  {
                    id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorModel,
                    label: "Executor Model",
                    type: "select",
                    options: [
                      { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen", isDefault: true },
                      { id: "gemini-4-carbon", label: "Gemini 4 Carbon" },
                      { id: "gemini-4-neon", label: "Gemini 4 Neon" },
                    ],
                    currentValue: "gemini-4-hydrogen",
                  },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const [defaultOption] = buildModelOptions(orchestratorConfig, null, undefined, null);
    expect(defaultOption).toMatchObject({
      label: "Orchestrator",
      shortName: "Orchestrator · Neon → Hydrogen",
      subtitle: "Neon → Hydrogen",
    });

    const activeSelection: ModelSelection = {
      instanceId: instanceId,
      model: ANTIGRAVITY_ORCHESTRATOR_MODEL,
      options: [
        { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerModel, value: "gemini-4-carbon" },
        { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorModel, value: "gemini-4-neon" },
      ],
    };
    const [activeOption] = buildModelOptions(orchestratorConfig, activeSelection, undefined, null);
    expect(activeOption).toMatchObject({
      label: "Orchestrator",
      shortName: "Orchestrator · Carbon → Neon",
      subtitle: "Carbon → Neon",
    });
  });
});
