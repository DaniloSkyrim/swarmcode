import type * as EffectAcpSchema from "effect-acp/compat";
import { describe, expect, it } from "@effect/vitest";
import {
  ANTIGRAVITY_ORCHESTRATOR_MODEL,
  ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";

import { buildAntigravityModelsFromSession } from "../provider/AntigravityProvider.ts";
import {
  antigravityCatalogModels,
  normalizeAntigravityCatalogModels,
} from "./antigravityOrchestratorModel.ts";

const modelConfig = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: "gemini-4-neon",
  options: [],
} satisfies EffectAcpSchema.SessionConfigOption;

describe("Antigravity Orchestrator catalog entry", () => {
  it("hides legacy orchestrator slugs and appends synthetic antigravity-orchestrator seeded from settings", () => {
    const models = buildAntigravityModelsFromSession(
      {
        configOptions: [
          {
            ...modelConfig,
            currentValue: "gemini-pro-orchestrator-neon",
            options: [
              { value: "gemini-4-neon", name: "Gemini 4 Neon" },
              { value: "gemini-4-carbon", name: "Gemini 4 Carbon" },
              { value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" },
              { value: "gemini-pro-orchestrator-neon", name: "Orchestrator (Neon)" },
              { value: "gemini-pro-orchestrator", name: "Orchestrator (Carbon)" },
              { value: "gemini-pro-orchestrator-g1-pro", name: "Orchestrator (Argon)" },
            ],
          },
        ],
      },
      new Map(),
      {
        orchestratorSettings: {
          plannerModel: "gemini-4-carbon",
          plannerEffort: "xhigh",
          executorModel: "gemini-4-neon",
          executorEffort: "low",
        },
      },
    );

    expect(models.map((model) => model.slug)).toEqual([
      "gemini-4-neon",
      "gemini-4-carbon",
      "gemini-4-hydrogen",
      ANTIGRAVITY_ORCHESTRATOR_MODEL,
    ]);
    expect(models.find((model) => model.isDefault)?.slug).toBe("gemini-4-neon");

    const orchestrator = models.find((model) => model.slug === ANTIGRAVITY_ORCHESTRATOR_MODEL);
    expect(orchestrator?.name).toBe("Orchestrator");
    const descriptors = orchestrator?.capabilities?.optionDescriptors ?? [];
    expect(descriptors.map((descriptor) => descriptor.id)).toEqual([
      ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerModel,
      ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerEffort,
      ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorModel,
      ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorEffort,
    ]);
    expect(descriptors[0]).toMatchObject({
      type: "select",
      currentValue: "gemini-4-carbon",
      options: [
        { id: "gemini-4-neon", label: "Gemini 4 Neon" },
        { id: "gemini-4-carbon", label: "Gemini 4 Carbon" },
      ],
    });
    // Carbon clamps xhigh -> high.
    expect(descriptors[1]).toMatchObject({
      type: "select",
      currentValue: "high",
      role: "reasoning",
    });
    expect(descriptors[2]).toMatchObject({
      type: "select",
      currentValue: "gemini-4-neon",
      options: [
        { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen" },
        { id: "gemini-4-carbon", label: "Gemini 4 Carbon" },
        { id: "gemini-4-neon", label: "Gemini 4 Neon" },
      ],
    });
    expect(descriptors[3]).toMatchObject({
      type: "select",
      currentValue: "low",
    });

    const normalizedCached = normalizeAntigravityCatalogModels(
      [
        { slug: "gemini-4-neon", name: "Gemini 4 Neon", isCustom: false, capabilities: null },
        { slug: "gemini-4-carbon", name: "Gemini 4 Carbon", isCustom: false, capabilities: null },
        {
          slug: "gemini-4-hydrogen",
          name: "Gemini 4 Hydrogen",
          isCustom: false,
          capabilities: null,
        },
        {
          slug: "gemini-pro-orchestrator-neon",
          name: "Orchestrator (Neon)",
          isCustom: false,
          capabilities: null,
        },
        {
          slug: "gemini-pro-orchestrator-g1-pro",
          name: "Orchestrator (Argon)",
          isCustom: false,
          capabilities: null,
        },
      ],
      {
        plannerModel: "gemini-4-carbon",
        plannerEffort: "high",
        executorModel: "gemini-4-hydrogen",
        executorEffort: "low",
      },
    );
    expect(normalizedCached.map((model) => model.slug)).toEqual([
      "gemini-4-neon",
      "gemini-4-carbon",
      "gemini-4-hydrogen",
      ANTIGRAVITY_ORCHESTRATOR_MODEL,
    ]);
  });

  it("omits synthetic antigravity-orchestrator when no eligible planner exists", () => {
    const models = buildAntigravityModelsFromSession({
      configOptions: [
        {
          ...modelConfig,
          currentValue: "gemini-4-hydrogen",
          options: [{ value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" }],
        },
      ],
    });
    expect(models.map((model) => model.slug)).toEqual(["gemini-4-hydrogen"]);
  });

  it("normalizes cached Antigravity catalogs and leaves other providers alone", () => {
    const model = (slug: string): ServerProviderModel => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: null,
    });
    const cached = [
      model("gemini-4-neon"),
      model("gemini-4-carbon"),
      model("gemini-4-hydrogen"),
      model("gemini-pro-orchestrator-neon"),
      model("gemini-pro-orchestrator"),
      model("gemini-pro-orchestrator-g1-pro"),
    ];

    expect(
      antigravityCatalogModels({ driver: ProviderDriverKind.make("antigravity") }, cached).map(
        (entry) => entry.slug,
      ),
    ).toEqual([
      "gemini-4-neon",
      "gemini-4-carbon",
      "gemini-4-hydrogen",
      ANTIGRAVITY_ORCHESTRATOR_MODEL,
    ]);
    expect(antigravityCatalogModels({ driver: ProviderDriverKind.make("codex") }, cached)).toBe(
      cached,
    );
  });
});
