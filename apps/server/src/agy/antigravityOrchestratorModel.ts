// Fork: the Antigravity "Orchestrator" catalog entry. It pairs a planner and an executor model,
// each with its own thinking level, and replaces the legacy orchestrator slugs the agent lists.
import {
  ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS,
  ANTIGRAVITY_ORCHESTRATOR_MODEL,
  ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS,
  ANTIGRAVITY_ORCHESTRATOR_PLANNER_MODELS,
  DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
  isAntigravityLegacyOrchestratorModel,
  normalizeAntigravityThinkingLevel,
  ProviderDriverKind,
  supportedAntigravityThinkingLevels,
  type AntigravityOrchestratorSettings,
  type ProviderOptionDescriptor,
  type ServerProvider,
  type ServerProviderModel,
  type ServerSettings,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";

import type { AntigravityThinkingLevels } from "../provider/AntigravityProvider.ts";

type ThinkingConfig = NonNullable<
  AntigravityThinkingLevels extends ReadonlyMap<string, infer Config> ? Config : never
>;

const THINKING_LEVEL_NAMES: Readonly<Record<string, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
};

function thinkingLevelChoicesForModel(
  modelSlug: (typeof ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS)[number],
  thinkingLevels: AntigravityThinkingLevels,
): ReadonlyArray<{ readonly id: string; readonly label: string }> {
  const observed: ThinkingConfig | null | undefined = thinkingLevels.get(modelSlug);
  const observedValues =
    observed?.options.flatMap((entry) =>
      "value" in entry ? [entry.value] : entry.options.map((option) => option.value),
    ) ?? [];
  const values =
    observedValues.length > 0 ? observedValues : supportedAntigravityThinkingLevels(modelSlug);
  return values.map((id) => ({ id, label: THINKING_LEVEL_NAMES[id] ?? id }));
}

function buildAntigravityOrchestratorModel(
  standardModels: ReadonlyArray<ServerProviderModel>,
  thinkingLevels: AntigravityThinkingLevels,
  settings: AntigravityOrchestratorSettings = DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
): ServerProviderModel | undefined {
  const bySlug = new Map(standardModels.map((model) => [model.slug, model] as const));
  const planners = ANTIGRAVITY_ORCHESTRATOR_PLANNER_MODELS.filter((slug) => bySlug.has(slug));
  const executors = ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS.filter((slug) => bySlug.has(slug));
  if (planners.length === 0 || executors.length === 0) return undefined;

  const plannerModel = planners.includes(settings.plannerModel)
    ? settings.plannerModel
    : planners[0]!;
  const executorModel = executors.includes(settings.executorModel)
    ? settings.executorModel
    : executors[0]!;
  const plannerEffort = normalizeAntigravityThinkingLevel(plannerModel, settings.plannerEffort);
  const executorEffort = normalizeAntigravityThinkingLevel(executorModel, settings.executorEffort);

  const optionDescriptors: ReadonlyArray<ProviderOptionDescriptor> = [
    {
      id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerModel,
      type: "select",
      label: "Orchestrator",
      options: planners.map((slug) => ({ id: slug, label: bySlug.get(slug)?.name ?? slug })),
      currentValue: plannerModel,
    },
    {
      id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerEffort,
      type: "select",
      label: "Orchestrator Thinking",
      role: "reasoning",
      options: thinkingLevelChoicesForModel(plannerModel, thinkingLevels),
      currentValue: plannerEffort,
    },
    {
      id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorModel,
      type: "select",
      label: "Executor",
      options: executors.map((slug) => ({ id: slug, label: bySlug.get(slug)?.name ?? slug })),
      currentValue: executorModel,
    },
    {
      id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorEffort,
      type: "select",
      label: "Executor Thinking",
      options: thinkingLevelChoicesForModel(executorModel, thinkingLevels),
      currentValue: executorEffort,
    },
  ];

  return {
    slug: ANTIGRAVITY_ORCHESTRATOR_MODEL,
    name: "Orchestrator",
    isCustom: false,
    capabilities: createModelCapabilities({ optionDescriptors }),
  };
}

/** Appends the Orchestrator entry when the catalog has a planner and an executor for it. */
export function withAntigravityOrchestratorModel(
  standardModels: ReadonlyArray<ServerProviderModel>,
  thinkingLevels: AntigravityThinkingLevels,
  settings?: AntigravityOrchestratorSettings,
): ReadonlyArray<ServerProviderModel> {
  const orchestratorModel = buildAntigravityOrchestratorModel(
    standardModels,
    thinkingLevels,
    settings,
  );
  return orchestratorModel ? [...standardModels, orchestratorModel] : standardModels;
}

export const isStandardAntigravityEntry = (entry: { readonly value: string }): boolean =>
  !isAntigravityLegacyOrchestratorModel(entry.value);

/** The session's current model, or the first standard one when it is a legacy orchestrator. */
export const standardAntigravityCurrentModel = (
  currentValue: string | undefined,
  entries: ReadonlyArray<{ readonly value: string }>,
): string | undefined =>
  currentValue && !isAntigravityLegacyOrchestratorModel(currentValue)
    ? currentValue
    : entries[0]?.value;

function readAntigravityOrchestratorSettingsFromConfig(
  config: unknown,
): AntigravityOrchestratorSettings {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS;
  }
  const raw = (config as Record<string, unknown>).orchestrator;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS;
  }
  const record = raw as Record<string, unknown>;
  const plannerModel =
    typeof record.plannerModel === "string" &&
    (ANTIGRAVITY_ORCHESTRATOR_PLANNER_MODELS as ReadonlyArray<string>).includes(record.plannerModel)
      ? (record.plannerModel as AntigravityOrchestratorSettings["plannerModel"])
      : DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.plannerModel;
  const executorModel =
    typeof record.executorModel === "string" &&
    (ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS as ReadonlyArray<string>).includes(
      record.executorModel,
    )
      ? (record.executorModel as AntigravityOrchestratorSettings["executorModel"])
      : DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.executorModel;
  return {
    plannerModel,
    plannerEffort: normalizeAntigravityThinkingLevel(
      plannerModel,
      typeof record.plannerEffort === "string" ? record.plannerEffort : undefined,
      DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.plannerEffort,
    ),
    executorModel,
    executorEffort: normalizeAntigravityThinkingLevel(
      executorModel,
      typeof record.executorEffort === "string" ? record.executorEffort : undefined,
      DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.executorEffort,
    ),
  };
}

/** Drops legacy orchestrator slugs and rebuilds the Orchestrator entry from the settings. */
export function normalizeAntigravityCatalogModels(
  models: ReadonlyArray<ServerProviderModel>,
  orchestratorSettings?: AntigravityOrchestratorSettings,
): ReadonlyArray<ServerProviderModel> {
  const standardModels = models.filter(
    (model) =>
      !isAntigravityLegacyOrchestratorModel(model.slug) &&
      model.slug !== ANTIGRAVITY_ORCHESTRATOR_MODEL,
  );
  return withAntigravityOrchestratorModel(standardModels, new Map(), orchestratorSettings);
}

/** `normalizeAntigravityCatalogModels` for an Antigravity provider; other providers pass through. */
export const antigravityCatalogModels = (
  provider: Pick<ServerProvider, "driver">,
  models: ReadonlyArray<ServerProviderModel>,
  orchestratorSettings?: AntigravityOrchestratorSettings,
): ReadonlyArray<ServerProviderModel> =>
  provider.driver === ProviderDriverKind.make("antigravity")
    ? normalizeAntigravityCatalogModels(models, orchestratorSettings)
    : models;

/** The provider with its Antigravity catalog normalized against the instance's saved settings. */
export const withAntigravityCatalog = <P extends ServerProvider>(
  provider: P,
  settings: ServerSettings | undefined,
): P =>
  provider.driver === ProviderDriverKind.make("antigravity")
    ? {
        ...provider,
        models: normalizeAntigravityCatalogModels(
          provider.models,
          readAntigravityOrchestratorSettingsFromConfig(
            settings?.providerInstances[provider.instanceId]?.config,
          ),
        ),
      }
    : provider;
