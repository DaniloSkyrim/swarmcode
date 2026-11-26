import {
  ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS,
  ANTIGRAVITY_ORCHESTRATOR_MODEL,
  ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS,
  ANTIGRAVITY_ORCHESTRATOR_PLANNER_MODELS,
  DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
  isAntigravityOrchestratorExecutorModel,
  isAntigravityOrchestratorPlannerModel,
  isAntigravityThinkingLevel,
  legacyAntigravityOrchestratorPlannerModel,
  normalizeAntigravityThinkingLevel,
  supportedAntigravityThinkingLevels,
  type AntigravityOrchestratorExecutorModel,
  type AntigravityOrchestratorPlannerModel,
  type AntigravityOrchestratorSettings,
  type AntigravityThinkingLevel,
  type ModelSelection,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

export type AntigravityOrchestratorAnyModel =
  | AntigravityOrchestratorPlannerModel
  | AntigravityOrchestratorExecutorModel;

export interface AntigravityOrchestratorModelGuide {
  readonly slug: AntigravityOrchestratorAnyModel;
  readonly name: string;
  readonly shortName: string;
  readonly badge?: string;
  readonly pros: ReadonlyArray<string>;
  readonly idealFor: string;
}

const MODEL_NAMES: Record<AntigravityOrchestratorAnyModel, { name: string; shortName: string }> = {
  "gemini-4-neon": { name: "Gemini 4 Neon", shortName: "Neon" },
  "gemini-4-carbon": { name: "Gemini 4 Carbon", shortName: "Carbon" },
  "gemini-4-hydrogen": { name: "Gemini 4 Hydrogen", shortName: "Hydrogen" },
};

const THINKING_LEVEL_LABELS: Record<AntigravityThinkingLevel, string> = {
  low: msg("Low"),
  medium: msg("Medium"),
  high: msg("High"),
  xhigh: msg("Extra"),
};

interface RawGuideEntry {
  readonly slug: AntigravityOrchestratorAnyModel;
  readonly badge?: string;
  readonly pros: ReadonlyArray<string>;
  readonly idealFor: string;
}

const PLANNER_GUIDES: Record<AntigravityOrchestratorPlannerModel, RawGuideEntry> = {
  "gemini-4-neon": {
    slug: "gemini-4-neon",
    badge: msg("Recommended"),
    pros: [
      msg("Deepest reasoning for multi-file architecture and complex trade-offs"),
      msg("Catches subtle edge cases during planning and final code review"),
    ],
    idealFor: msg("Large refactors, tricky bugs, and architectural design"),
  },
  "gemini-4-carbon": {
    slug: "gemini-4-carbon",
    pros: [
      msg("Fast, balanced planning with lower latency and token overhead"),
      msg("Clear step-by-step plans for well-scoped changes"),
    ],
    idealFor: msg("Feature additions, daily iterations, and focused fixes"),
  },
};

const EXECUTOR_GUIDES: Record<AntigravityOrchestratorExecutorModel, RawGuideEntry> = {
  "gemini-4-hydrogen": {
    slug: "gemini-4-hydrogen",
    badge: msg("Recommended"),
    pros: [
      msg("Fastest execution and lowest token cost for edits, searches, and tests"),
      msg("Ideal speed-to-cost pairing when guided by a top-tier planner"),
    ],
    idealFor: msg("Most coding tasks, routine edits, and fast test loops"),
  },
  "gemini-4-carbon": {
    slug: "gemini-4-carbon",
    pros: [
      msg("Strong balance of coding reliability and execution speed"),
      msg("Handles multi-file edits cleanly with fewer review cycles"),
    ],
    idealFor: msg("Medium-to-complex implementations and structured refactors"),
  },
  "gemini-4-neon": {
    slug: "gemini-4-neon",
    pros: [
      msg("Maximum coding precision for delicate logic and strict invariants"),
      msg("Minimizes mistakes on complex type systems or tricky algorithms"),
    ],
    idealFor: msg("High-risk changes, complex types, and subtle bug fixes"),
  },
};

function antigravityOrchestratorModelName(
  slug: AntigravityOrchestratorAnyModel,
  liveModels?: ReadonlyArray<ServerProviderModel>,
): string {
  const live = liveModels?.find((model) => model.slug === slug)?.name?.trim();
  return live || MODEL_NAMES[slug].name;
}

export function antigravityOrchestratorShortName(slug: AntigravityOrchestratorAnyModel): string {
  return MODEL_NAMES[slug].shortName;
}

export function antigravityThinkingLevelLabel(
  level: AntigravityThinkingLevel,
  resolve: MFunctionType = mFallback,
): string {
  return resolve(THINKING_LEVEL_LABELS[level]);
}

export function getAntigravityPlannerGuide(
  slug: AntigravityOrchestratorPlannerModel,
  resolve: MFunctionType = mFallback,
  liveModels?: ReadonlyArray<ServerProviderModel>,
): AntigravityOrchestratorModelGuide {
  const entry = PLANNER_GUIDES[slug];
  return {
    slug,
    name: antigravityOrchestratorModelName(slug, liveModels),
    shortName: antigravityOrchestratorShortName(slug),
    ...(entry.badge ? { badge: resolve(entry.badge) } : {}),
    pros: entry.pros.map((item) => resolve(item)),
    idealFor: resolve(entry.idealFor),
  };
}

export function getAntigravityExecutorGuide(
  slug: AntigravityOrchestratorExecutorModel,
  resolve: MFunctionType = mFallback,
  liveModels?: ReadonlyArray<ServerProviderModel>,
): AntigravityOrchestratorModelGuide {
  const entry = EXECUTOR_GUIDES[slug];
  return {
    slug,
    name: antigravityOrchestratorModelName(slug, liveModels),
    shortName: antigravityOrchestratorShortName(slug),
    ...(entry.badge ? { badge: resolve(entry.badge) } : {}),
    pros: entry.pros.map((item) => resolve(item)),
    idealFor: resolve(entry.idealFor),
  };
}

export function readAntigravityOrchestratorSettings(
  config: Readonly<Record<string, unknown>> | null | undefined,
): AntigravityOrchestratorSettings {
  const raw =
    config && typeof config.orchestrator === "object" && config.orchestrator !== null
      ? (config.orchestrator as Record<string, unknown>)
      : undefined;
  const plannerModel =
    typeof raw?.plannerModel === "string" && isAntigravityOrchestratorPlannerModel(raw.plannerModel)
      ? raw.plannerModel
      : DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.plannerModel;
  const executorModel =
    typeof raw?.executorModel === "string" &&
    isAntigravityOrchestratorExecutorModel(raw.executorModel)
      ? raw.executorModel
      : DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.executorModel;
  const plannerEffort = normalizeAntigravityThinkingLevel(
    plannerModel,
    typeof raw?.plannerEffort === "string" ? raw.plannerEffort : undefined,
    DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.plannerEffort,
  );
  const executorEffort = normalizeAntigravityThinkingLevel(
    executorModel,
    typeof raw?.executorEffort === "string" ? raw.executorEffort : undefined,
    DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.executorEffort,
  );
  return { plannerModel, plannerEffort, executorModel, executorEffort };
}

export function readAntigravityOrchestratorDefaultsFromModels(
  models: ReadonlyArray<ServerProviderModel> | undefined,
): AntigravityOrchestratorSettings {
  const orchestrator = models?.find((model) => model.slug === ANTIGRAVITY_ORCHESTRATOR_MODEL);
  const descriptors = orchestrator?.capabilities?.optionDescriptors;
  if (!descriptors || descriptors.length === 0) {
    return DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS;
  }
  const valueOf = (id: string): string | undefined => {
    const descriptor = descriptors.find((entry) => entry.id === id && entry.type === "select");
    return descriptor?.type === "select" ? descriptor.currentValue : undefined;
  };
  const plannerRaw = valueOf(ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerModel);
  const executorRaw = valueOf(ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorModel);
  const plannerModel =
    plannerRaw && isAntigravityOrchestratorPlannerModel(plannerRaw)
      ? plannerRaw
      : DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.plannerModel;
  const executorModel =
    executorRaw && isAntigravityOrchestratorExecutorModel(executorRaw)
      ? executorRaw
      : DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.executorModel;
  const plannerEffort = normalizeAntigravityThinkingLevel(
    plannerModel,
    valueOf(ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerEffort),
    DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.plannerEffort,
  );
  const executorEffort = normalizeAntigravityThinkingLevel(
    executorModel,
    valueOf(ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorEffort),
    DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.executorEffort,
  );
  return { plannerModel, plannerEffort, executorModel, executorEffort };
}

export function availableAntigravityOrchestratorPlanners(
  models: ReadonlyArray<ServerProviderModel> | undefined,
): ReadonlyArray<AntigravityOrchestratorPlannerModel> {
  if (!models || models.length === 0) return ANTIGRAVITY_ORCHESTRATOR_PLANNER_MODELS;
  const slugs = new Set(models.map((model) => model.slug));
  const available = ANTIGRAVITY_ORCHESTRATOR_PLANNER_MODELS.filter((slug) => slugs.has(slug));
  return available.length > 0 ? available : ANTIGRAVITY_ORCHESTRATOR_PLANNER_MODELS;
}

export function availableAntigravityOrchestratorExecutors(
  models: ReadonlyArray<ServerProviderModel> | undefined,
): ReadonlyArray<AntigravityOrchestratorExecutorModel> {
  if (!models || models.length === 0) return ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS;
  const slugs = new Set(models.map((model) => model.slug));
  const available = ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS.filter((slug) => slugs.has(slug));
  return available.length > 0 ? available : ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS;
}

export function thinkingLevelsForAntigravityModel(
  model: AntigravityOrchestratorAnyModel,
  liveModels?: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<AntigravityThinkingLevel> {
  const liveModel = liveModels?.find((candidate) => candidate.slug === model);
  const descriptor = liveModel?.capabilities?.optionDescriptors?.find(
    (option) =>
      option.type === "select" &&
      (option.role === "reasoning" ||
        option.id === "thought_level" ||
        option.id === "thinking_level"),
  );
  if (descriptor?.type === "select") {
    const advertised = descriptor.options
      .map((option) => option.id)
      .filter((value): value is AntigravityThinkingLevel => isAntigravityThinkingLevel(value));
    if (advertised.length > 0) return advertised;
  }
  return supportedAntigravityThinkingLevels(model);
}

function readStringOption(
  selection: ModelSelection | null | undefined,
  id: string,
): string | undefined {
  const raw = selection?.options?.find((entry) => entry.id === id)?.value;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

function clampToAvailableThinkingLevel(
  model: AntigravityOrchestratorAnyModel,
  effort: string | undefined,
  fallback: AntigravityThinkingLevel,
  liveModels?: ReadonlyArray<ServerProviderModel>,
): AntigravityThinkingLevel {
  const normalized = normalizeAntigravityThinkingLevel(model, effort, fallback);
  const available = thinkingLevelsForAntigravityModel(model, liveModels);
  if (available.includes(normalized)) return normalized;
  if (normalized === "xhigh" && available.includes("high")) return "high";
  return available.includes(fallback) ? fallback : (available[0] ?? "medium");
}

export function resolveAntigravityOrchestratorPair(
  selection: ModelSelection | null | undefined,
  defaults: AntigravityOrchestratorSettings = DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
  availableModels?: ReadonlyArray<ServerProviderModel>,
): AntigravityOrchestratorSettings {
  const planners = availableAntigravityOrchestratorPlanners(availableModels);
  const executors = availableAntigravityOrchestratorExecutors(availableModels);

  const optionPlanner = readStringOption(
    selection,
    ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerModel,
  );
  const legacyPlanner = selection
    ? legacyAntigravityOrchestratorPlannerModel(selection.model)
    : undefined;
  const candidatePlanner =
    optionPlanner && isAntigravityOrchestratorPlannerModel(optionPlanner)
      ? optionPlanner
      : (legacyPlanner ?? defaults.plannerModel);
  const plannerModel = planners.includes(candidatePlanner)
    ? candidatePlanner
    : planners.includes(defaults.plannerModel)
      ? defaults.plannerModel
      : (planners[0] ?? DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.plannerModel);

  const optionExecutor = readStringOption(
    selection,
    ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorModel,
  );
  const candidateExecutor =
    optionExecutor && isAntigravityOrchestratorExecutorModel(optionExecutor)
      ? optionExecutor
      : defaults.executorModel;
  const executorModel = executors.includes(candidateExecutor)
    ? candidateExecutor
    : executors.includes(defaults.executorModel)
      ? defaults.executorModel
      : (executors[0] ?? DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.executorModel);

  const plannerEffort = clampToAvailableThinkingLevel(
    plannerModel,
    readStringOption(selection, ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerEffort),
    defaults.plannerEffort,
    availableModels,
  );
  const executorEffort = clampToAvailableThinkingLevel(
    executorModel,
    readStringOption(selection, ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorEffort),
    defaults.executorEffort,
    availableModels,
  );

  return { plannerModel, plannerEffort, executorModel, executorEffort };
}

export function buildAntigravityOrchestratorSelection(
  instanceId: ProviderInstanceId,
  pair: AntigravityOrchestratorSettings,
): ModelSelection {
  const plannerEffort = normalizeAntigravityThinkingLevel(pair.plannerModel, pair.plannerEffort);
  const executorEffort = normalizeAntigravityThinkingLevel(pair.executorModel, pair.executorEffort);
  const options: ReadonlyArray<ProviderOptionSelection> = [
    { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerModel, value: pair.plannerModel },
    { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerEffort, value: plannerEffort },
    { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorModel, value: pair.executorModel },
    { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorEffort, value: executorEffort },
  ];
  return {
    instanceId,
    model: ANTIGRAVITY_ORCHESTRATOR_MODEL,
    options,
  };
}

export function updateAntigravityOrchestratorSelection(
  selection: ModelSelection,
  patch: Partial<AntigravityOrchestratorSettings>,
  defaults: AntigravityOrchestratorSettings = DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
  availableModels?: ReadonlyArray<ServerProviderModel>,
): ModelSelection {
  const current = resolveAntigravityOrchestratorPair(selection, defaults, availableModels);
  const plannerModel = patch.plannerModel ?? current.plannerModel;
  const executorModel = patch.executorModel ?? current.executorModel;
  const plannerEffort = clampToAvailableThinkingLevel(
    plannerModel,
    patch.plannerEffort ?? current.plannerEffort,
    defaults.plannerEffort,
    availableModels,
  );
  const executorEffort = clampToAvailableThinkingLevel(
    executorModel,
    patch.executorEffort ?? current.executorEffort,
    defaults.executorEffort,
    availableModels,
  );
  return buildAntigravityOrchestratorSelection(selection.instanceId, {
    plannerModel,
    plannerEffort,
    executorModel,
    executorEffort,
  });
}

export function formatAntigravityOrchestratorShortPair(
  pair: Pick<AntigravityOrchestratorSettings, "plannerModel" | "executorModel">,
): string {
  return `${antigravityOrchestratorShortName(pair.plannerModel)} → ${antigravityOrchestratorShortName(pair.executorModel)}`;
}

export function formatAntigravityOrchestratorTriggerLabel(
  pair: Pick<AntigravityOrchestratorSettings, "plannerModel" | "executorModel">,
  resolve: MFunctionType = mFallback,
): string {
  return `${resolve(msg("Orchestrator"))} · ${formatAntigravityOrchestratorShortPair(pair)}`;
}

export function formatAntigravityOrchestratorEffortSummary(
  pair: Pick<AntigravityOrchestratorSettings, "plannerEffort" | "executorEffort">,
  resolve: MFunctionType = mFallback,
): string {
  const planner = antigravityThinkingLevelLabel(pair.plannerEffort, resolve);
  const executor = antigravityThinkingLevelLabel(pair.executorEffort, resolve);
  return planner === executor ? planner : `${planner} / ${executor}`;
}
