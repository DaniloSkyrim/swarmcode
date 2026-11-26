// Fork: the Antigravity orchestrator's effort, an orchestrator and an executor thinking level
// instead of one effort, in the composer trigger and the model picker's effort column.
import {
  type AntigravityOrchestratorAnyModel,
  antigravityOrchestratorShortName,
  antigravityThinkingLevelLabel,
  formatAntigravityOrchestratorEffortSummary,
  readAntigravityOrchestratorDefaultsFromModels,
  resolveAntigravityOrchestratorPair,
  thinkingLevelsForAntigravityModel,
  updateAntigravityOrchestratorSelection,
} from "@t3tools/client-runtime/antigravity-orchestrator";
import { isAntigravityOrchestratorModel, type AntigravityThinkingLevel } from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { MessageResolver } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import type { ComposerControlSize } from "../components/chat/ComposerControl";
import { type TraitsSelectionInput, useTraitsSelection } from "../components/chat/TraitsPicker";

const isOrchestrator = (traits: TraitsSelectionInput | null): traits is TraitsSelectionInput =>
  traits?.provider === "antigravity" && isAntigravityOrchestratorModel(traits.model ?? "");

function orchestratorPair(traits: TraitsSelectionInput) {
  const defaults = readAntigravityOrchestratorDefaultsFromModels(traits.models);
  const selection =
    traits.instanceId && traits.model
      ? { instanceId: traits.instanceId, model: traits.model, options: traits.modelOptions ?? [] }
      : null;
  return {
    defaults,
    selection,
    pair: resolveAntigravityOrchestratorPair(selection, defaults, traits.models),
  };
}

/** The composer trigger's effort suffix for the orchestrator, or null for any other model. */
export function describeAgyOrchestratorEffort(
  traits: TraitsSelectionInput,
  size: ComposerControlSize,
  resolve: MessageResolver,
): { suffix: ReactNode; detail: string | null } | null {
  if (!isOrchestrator(traits)) return null;
  const { pair } = orchestratorPair(traits);
  return {
    detail: resolve(
      msg("Orchestrator {plannerEffort} · Executor {executorEffort}", {
        plannerEffort: antigravityThinkingLevelLabel(pair.plannerEffort, resolve),
        executorEffort: antigravityThinkingLevelLabel(pair.executorEffort, resolve),
      }),
    ),
    suffix: (
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 text-muted-foreground group-hover/model-trigger:text-foreground group-data-pressed/model-trigger:text-foreground group-data-popup-open/model-trigger:text-foreground",
          size === "sm" && "-ms-0.5",
        )}
      >
        <span aria-hidden="true" className="text-muted-foreground/50">
          ·
        </span>
        <span data-composer-control-label className="max-w-28 truncate">
          {formatAntigravityOrchestratorEffortSummary(pair, resolve)}
        </span>
      </span>
    ),
  };
}

/** The effort column's heading and rows for the orchestrator, or null for any other model. */
export function useAgyOrchestratorEffortColumn(
  traits: TraitsSelectionInput | null,
  rowClassName: string,
): { heading: ReactNode; levels: ReactNode } | null {
  const gt = useGT();
  if (!isOrchestrator(traits)) return null;
  return {
    heading: <span className="whitespace-nowrap">{gt("Thinking Level")}</span>,
    levels: <OrchestratorEffortLevels traits={traits} rowClassName={rowClassName} />,
  };
}

function OrchestratorEffortLevels(props: { traits: TraitsSelectionInput; rowClassName: string }) {
  const gt = useGT();
  const traits = useTraitsSelection(props.traits);
  const { models } = props.traits;
  const { defaults, selection, pair } = orchestratorPair(props.traits);

  const updateEffort = (
    role: "plannerEffort" | "executorEffort",
    level: AntigravityThinkingLevel,
  ) => {
    if (!selection) return;
    const next = updateAntigravityOrchestratorSelection(
      selection,
      { [role]: level },
      defaults,
      models,
    );
    traits.replaceOptions(next.options);
  };

  return (
    <div className="flex flex-col gap-1" data-antigravity-orchestrator-effort>
      <RoleLevels
        role="planner"
        ariaLabel={gt("Orchestrator thinking level")}
        title={gt("Orchestrator")}
        model={pair.plannerModel}
        levels={thinkingLevelsForAntigravityModel(pair.plannerModel, models)}
        selected={pair.plannerEffort}
        rowClassName={props.rowClassName}
        onSelect={(level) => updateEffort("plannerEffort", level)}
      />
      <div className="my-0.5 border-t border-border/60" />
      <RoleLevels
        role="executor"
        ariaLabel={gt("Executor thinking level")}
        title={gt("Executor")}
        model={pair.executorModel}
        levels={thinkingLevelsForAntigravityModel(pair.executorModel, models)}
        selected={pair.executorEffort}
        rowClassName={props.rowClassName}
        onSelect={(level) => updateEffort("executorEffort", level)}
      />
    </div>
  );
}

function RoleLevels(props: {
  role: "planner" | "executor";
  ariaLabel: string;
  title: string;
  model: AntigravityOrchestratorAnyModel;
  levels: ReadonlyArray<AntigravityThinkingLevel>;
  selected: AntigravityThinkingLevel;
  rowClassName: string;
  onSelect: (level: AntigravityThinkingLevel) => void;
}) {
  const messages = useMessages();
  return (
    <div role="radiogroup" aria-label={props.ariaLabel}>
      <div className="flex items-center justify-between gap-1 px-2 pt-0.5 pb-1 text-muted-foreground text-xs">
        <span className="font-medium">{props.title}</span>
        <span className="truncate opacity-80">{antigravityOrchestratorShortName(props.model)}</span>
      </div>
      {props.levels.map((level) => {
        const selected = props.selected === level;
        return (
          <button
            key={`${props.role}-${level}`}
            type="button"
            role="radio"
            aria-checked={selected}
            data-effort-level
            data-effort-row
            // Only the orchestrator's checked row is a tab stop; arrows reach the rest.
            tabIndex={selected && props.role === "planner" ? 0 : -1}
            onClick={() => props.onSelect(level)}
            className={cn(
              props.rowClassName,
              "h-7 text-xs",
              selected
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {antigravityThinkingLevelLabel(level, messages)}
            </span>
            {selected ? (
              <CheckIcon aria-hidden="true" className="ms-auto size-3.5 shrink-0" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
