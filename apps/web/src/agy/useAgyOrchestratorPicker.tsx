import {
  ANTIGRAVITY_ORCHESTRATOR_MODEL,
  isAntigravityOrchestratorModel,
  type AntigravityOrchestratorSettings,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
} from "@t3tools/contracts";
import {
  buildAntigravityOrchestratorSelection,
  formatAntigravityOrchestratorShortPair,
  readAntigravityOrchestratorDefaultsFromModels,
  resolveAntigravityOrchestratorPair,
} from "@t3tools/client-runtime/antigravity-orchestrator";
import { useGT } from "gt-react";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";

import { AntigravityOrchestratorPickerFlow } from "~/components/chat/AntigravityOrchestratorPickerFlow";
import { ProviderInstanceIcon } from "~/components/chat/ProviderInstanceIcon";
import { cn } from "~/lib/utils";
import type { ProviderInstanceEntry } from "~/providerInstances";

type ModelChange = (
  instanceId: ProviderInstanceId,
  model: string,
  modelOptions?: ReadonlyArray<ProviderOptionSelection>,
) => void;

interface PickerModel {
  readonly instanceId: ProviderInstanceId;
  readonly slug: string;
}

/**
 * The Antigravity Orchestrator in the model picker: picking it opens a planner and
 * executor flow in place of the model list, and a footer row pins it with its current
 * pair. Kept out of ModelPickerContent so that upstream file only carries hook lines.
 */
export function useAgyOrchestratorPicker(
  onInstanceModelChange: ModelChange,
  searchInputRef: RefObject<HTMLInputElement | null>,
) {
  const [flowInstanceId, setFlowInstanceId] = useState<ProviderInstanceId | null>(null);
  const gt = useGT();

  const apply = (instanceId: ProviderInstanceId, pair: AntigravityOrchestratorSettings) => {
    setFlowInstanceId(null);
    const selection = buildAntigravityOrchestratorSelection(instanceId, pair);
    onInstanceModelChange(instanceId, ANTIGRAVITY_ORCHESTRATOR_MODEL, selection.options);
  };

  /** Opens the flow instead of selecting the Orchestrator directly; true when it did. */
  const interceptSelect = (
    driverKind: ProviderDriverKind,
    instanceId: ProviderInstanceId,
    model: string,
  ): boolean => {
    if (driverKind !== "antigravity" || !isAntigravityOrchestratorModel(model)) return false;
    setFlowInstanceId(instanceId);
    return true;
  };

  const view = <T extends PickerModel>(input: {
    readonly entryByInstanceId: ReadonlyMap<ProviderInstanceId, ProviderInstanceEntry>;
    readonly selectedEntry: ProviderInstanceEntry | undefined;
    readonly isSearching: boolean;
    readonly filteredModels: ReadonlyArray<T>;
    readonly activeInstanceId: ProviderInstanceId;
    readonly activeModelSlug: string;
    readonly activeModelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
    readonly docked: boolean | undefined;
    readonly showSidebar: boolean;
    readonly getModelDisabledReason:
      | ((instanceId: ProviderInstanceId, model: string) => string | null)
      | undefined;
  }) => {
    const pairFor = (entry: ProviderInstanceEntry) => {
      const defaults = readAntigravityOrchestratorDefaultsFromModels(entry.models);
      const isActive =
        input.activeInstanceId === entry.instanceId &&
        isAntigravityOrchestratorModel(input.activeModelSlug);
      const current = isActive
        ? resolveAntigravityOrchestratorPair(
            {
              instanceId: entry.instanceId,
              model: ANTIGRAVITY_ORCHESTRATOR_MODEL,
              ...(input.activeModelOptions ? { options: input.activeModelOptions } : {}),
            },
            defaults,
            entry.models,
          )
        : defaults;
      return { defaults, isActive, current };
    };

    const flowEntry =
      flowInstanceId !== null ? (input.entryByInstanceId.get(flowInstanceId) ?? null) : null;
    const flowPane: ReactNode = flowEntry
      ? (() => {
          const { isActive, current } = pairFor(flowEntry);
          return (
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col overflow-hidden",
                input.showSidebar && "border-l border-border/70",
              )}
            >
              <AntigravityOrchestratorPickerFlow
                liveModels={flowEntry.models}
                currentPair={current}
                isActiveOrchestrator={isActive}
                onBack={() => {
                  setFlowInstanceId(null);
                  window.requestAnimationFrame(() =>
                    searchInputRef.current?.focus({ preventScroll: true }),
                  );
                }}
                onComplete={(pair) => apply(flowEntry.instanceId, pair)}
              />
            </div>
          );
        })()
      : null;

    const entry = input.selectedEntry;
    const pinnedItem =
      !input.isSearching && entry?.driverKind === "antigravity"
        ? input.filteredModels.find(
            (model) =>
              model.instanceId === entry.instanceId && isAntigravityOrchestratorModel(model.slug),
          )
        : undefined;
    const pinned = entry && pinnedItem ? { entry, item: pinnedItem, ...pairFor(entry) } : null;
    const pinnedDisabled =
      pinned !== null &&
      (input.getModelDisabledReason?.(pinned.entry.instanceId, pinned.item.slug) ?? null) !== null;

    const pinnedFooter: ReactNode = pinned ? (
      <div className="shrink-0 border-t border-border/70 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-antigravity-orchestrator-trigger="true"
            disabled={pinnedDisabled}
            onClick={() => setFlowInstanceId(pinned.entry.instanceId)}
            className={cn(
              "group flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-foreground/[0.09] focus-visible:bg-foreground/[0.09] disabled:cursor-not-allowed disabled:opacity-60",
              pinned.isActive && "bg-foreground/[0.06]",
            )}
          >
            <ProviderInstanceIcon
              driverKind={pinned.entry.driverKind}
              displayName={pinned.entry.displayName}
              accentColor={pinned.entry.accentColor}
              className="size-4 shrink-0"
              iconClassName="size-4"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium text-foreground text-sm leading-tight">
                  {gt("Orchestrator")}
                </span>
                {pinned.isActive ? (
                  <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-foreground" />
                ) : null}
              </span>
              <span className="truncate text-muted-foreground text-xs leading-tight">
                {formatAntigravityOrchestratorShortPair(pinned.current)}
              </span>
            </span>
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            />
          </button>
          <button
            type="button"
            data-antigravity-orchestrator-use-default="true"
            disabled={pinnedDisabled}
            onClick={() => apply(pinned.entry.instanceId, pinned.defaults)}
            aria-label={gt("Use default ({pair})", {
              pair: formatAntigravityOrchestratorShortPair(pinned.defaults),
            })}
            className="shrink-0 cursor-pointer rounded-sm border border-border/70 bg-background/60 px-2 py-1 text-muted-foreground text-xs outline-none hover:bg-foreground/[0.09] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-60"
          >
            {gt("Default", { $context: "quick action to use default orchestrator models" })}
          </button>
        </div>
      </div>
    ) : null;

    return {
      flowPane,
      pinnedFooter,
      contentWidthClass: flowPane ? (input.docked ? "max-w-138" : "max-w-104") : "max-w-90",
      /** The pinned footer row replaces the Orchestrator's row in the list. */
      withoutPinned: (models: ReadonlyArray<T>): ReadonlyArray<T> =>
        pinned
          ? models.filter(
              (model) =>
                !(
                  model.instanceId === pinned.entry.instanceId &&
                  isAntigravityOrchestratorModel(model.slug)
                ),
            )
          : models,
    };
  };

  return { close: () => setFlowInstanceId(null), interceptSelect, view };
}
