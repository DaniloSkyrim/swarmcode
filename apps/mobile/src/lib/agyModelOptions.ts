// Fork: how the Antigravity Orchestrator entry reads in the mobile model list, as the pair it
// runs ("Orchestrator · Neon → Hydrogen") instead of the catalog's plain name.
import {
  formatAntigravityOrchestratorShortPair,
  formatAntigravityOrchestratorTriggerLabel,
  readAntigravityOrchestratorDefaultsFromModels,
  resolveAntigravityOrchestratorPair,
} from "@t3tools/client-runtime/antigravity-orchestrator";
import {
  isAntigravityOrchestratorModel,
  type ModelSelection,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { msg } from "gt-react-native";

import { m } from "../i18n/messages";

const isOrchestrator = (driver: string, model: string) =>
  driver === "antigravity" && isAntigravityOrchestratorModel(model);

/** Overrides for the Orchestrator catalog row, showing its default pair. */
export function agyOrchestratorCatalogEntry(
  provider: Pick<ServerProvider, "driver" | "models">,
  model: { readonly slug: string },
): { label: string; shortName: string; subtitle: string } | Record<string, never> {
  if (!isOrchestrator(provider.driver, model.slug)) return {};
  const pair = resolveAntigravityOrchestratorPair(
    null,
    readAntigravityOrchestratorDefaultsFromModels(provider.models),
    provider.models,
  );
  return {
    label: m(msg("Orchestrator")),
    shortName: formatAntigravityOrchestratorTriggerLabel(pair, m),
    subtitle: formatAntigravityOrchestratorShortPair(pair),
  };
}

/** Overrides for the active Orchestrator selection, showing the pair it actually picked. */
export function agyOrchestratorSelectionEntry(
  driver: string,
  selection: ModelSelection,
  config: ServerConfig | null | undefined,
): { shortName: string; subtitle: string } | Record<string, never> {
  if (!isOrchestrator(driver, selection.model)) return {};
  const models = config?.providers.find(
    (candidate) => candidate.instanceId === selection.instanceId,
  )?.models;
  const pair = resolveAntigravityOrchestratorPair(
    selection,
    readAntigravityOrchestratorDefaultsFromModels(models),
    models,
  );
  return {
    shortName: formatAntigravityOrchestratorTriggerLabel(pair, m),
    subtitle: formatAntigravityOrchestratorShortPair(pair),
  };
}
