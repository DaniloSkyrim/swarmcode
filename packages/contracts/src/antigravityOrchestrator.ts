import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** Virtual model slug for Swarmcode's dual-model Antigravity Orchestrator. Never sent raw to ACP. */
export const ANTIGRAVITY_ORCHESTRATOR_MODEL = "antigravity-orchestrator";

/** Native agy acp fixed presets replaced in the picker and migrated transparently on resume. */
export const ANTIGRAVITY_LEGACY_ORCHESTRATOR_MODELS = [
  "gemini-pro-orchestrator-neon",
  "gemini-pro-orchestrator",
  "gemini-pro-orchestrator-g1-pro",
  "gemini-pro-orchestrator-argon",
  "gemini-4-hydrogen-orchestrator",
] as const;

export const ANTIGRAVITY_ORCHESTRATOR_PLANNER_MODELS = [
  "gemini-4-neon",
  "gemini-4-carbon",
] as const;

export const ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS = [
  "gemini-4-hydrogen",
  "gemini-4-carbon",
  "gemini-4-neon",
] as const;

const ANTIGRAVITY_THINKING_LEVELS = ["low", "medium", "high", "xhigh"] as const;

export const AntigravityOrchestratorPlannerModel = Schema.Literals(
  ANTIGRAVITY_ORCHESTRATOR_PLANNER_MODELS,
);
export type AntigravityOrchestratorPlannerModel = typeof AntigravityOrchestratorPlannerModel.Type;

export const AntigravityOrchestratorExecutorModel = Schema.Literals(
  ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS,
);
export type AntigravityOrchestratorExecutorModel = typeof AntigravityOrchestratorExecutorModel.Type;

export const AntigravityThinkingLevel = Schema.Literals(ANTIGRAVITY_THINKING_LEVELS);
export type AntigravityThinkingLevel = typeof AntigravityThinkingLevel.Type;

export const ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS = {
  plannerModel: "orchestratorModel",
  plannerEffort: "orchestratorEffort",
  executorModel: "executorModel",
  executorEffort: "executorEffort",
} as const;

export const DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS = {
  plannerModel: "gemini-4-neon" as AntigravityOrchestratorPlannerModel,
  plannerEffort: "medium" as AntigravityThinkingLevel,
  executorModel: "gemini-4-hydrogen" as AntigravityOrchestratorExecutorModel,
  executorEffort: "medium" as AntigravityThinkingLevel,
} as const;

export const AntigravityOrchestratorSettings = Schema.Struct({
  plannerModel: AntigravityOrchestratorPlannerModel.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.plannerModel),
    ),
  ),
  plannerEffort: AntigravityThinkingLevel.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.plannerEffort),
    ),
  ),
  executorModel: AntigravityOrchestratorExecutorModel.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.executorModel),
    ),
  ),
  executorEffort: AntigravityThinkingLevel.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS.executorEffort),
    ),
  ),
});
export type AntigravityOrchestratorSettings = typeof AntigravityOrchestratorSettings.Type;

export function isAntigravityLegacyOrchestratorModel(slug: string): boolean {
  return (ANTIGRAVITY_LEGACY_ORCHESTRATOR_MODELS as ReadonlyArray<string>).includes(slug);
}

export function isAntigravityOrchestratorModel(slug: string): boolean {
  return slug === ANTIGRAVITY_ORCHESTRATOR_MODEL;
}

export function isAntigravityOrchestratorPlannerModel(
  slug: string,
): slug is AntigravityOrchestratorPlannerModel {
  return (ANTIGRAVITY_ORCHESTRATOR_PLANNER_MODELS as ReadonlyArray<string>).includes(slug);
}

export function isAntigravityOrchestratorExecutorModel(
  slug: string,
): slug is AntigravityOrchestratorExecutorModel {
  return (ANTIGRAVITY_ORCHESTRATOR_EXECUTOR_MODELS as ReadonlyArray<string>).includes(slug);
}

export function isAntigravityThinkingLevel(value: string): value is AntigravityThinkingLevel {
  return (ANTIGRAVITY_THINKING_LEVELS as ReadonlyArray<string>).includes(value);
}

export function supportedAntigravityThinkingLevels(
  model: AntigravityOrchestratorPlannerModel | AntigravityOrchestratorExecutorModel,
): ReadonlyArray<AntigravityThinkingLevel> {
  return model === "gemini-4-carbon"
    ? ["low", "medium", "high"]
    : ["low", "medium", "high", "xhigh"];
}

export function normalizeAntigravityThinkingLevel(
  model: AntigravityOrchestratorPlannerModel | AntigravityOrchestratorExecutorModel,
  effort: string | undefined,
  fallback: AntigravityThinkingLevel = "medium",
): AntigravityThinkingLevel {
  const supported = supportedAntigravityThinkingLevels(model);
  if (effort !== undefined && isAntigravityThinkingLevel(effort)) {
    if (supported.includes(effort)) return effort;
    if (effort === "xhigh") return "high";
  }
  return supported.includes(fallback) ? fallback : "high";
}

export function legacyAntigravityOrchestratorPlannerModel(
  slug: string,
): AntigravityOrchestratorPlannerModel | undefined {
  switch (slug) {
    case "gemini-pro-orchestrator-neon":
      return "gemini-4-neon";
    case "gemini-pro-orchestrator":
    case "gemini-pro-orchestrator-g1-pro":
    case "gemini-pro-orchestrator-argon":
    case "gemini-4-hydrogen-orchestrator":
      return "gemini-4-carbon";
    default:
      return undefined;
  }
}
