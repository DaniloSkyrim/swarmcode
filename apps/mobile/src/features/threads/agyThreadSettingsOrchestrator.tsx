import {
  ANTIGRAVITY_ORCHESTRATOR_MODEL,
  ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS,
  isAntigravityOrchestratorExecutorModel,
  isAntigravityOrchestratorModel,
  isAntigravityOrchestratorPlannerModel,
  isAntigravityThinkingLevel,
  type AntigravityOrchestratorPlannerModel,
  type AntigravityOrchestratorSettings,
  type ModelSelection,
  type ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  antigravityOrchestratorShortName,
  availableAntigravityOrchestratorExecutors,
  availableAntigravityOrchestratorPlanners,
  buildAntigravityOrchestratorSelection,
  formatAntigravityOrchestratorShortPair,
  formatAntigravityOrchestratorTriggerLabel,
  getAntigravityExecutorGuide,
  getAntigravityPlannerGuide,
  readAntigravityOrchestratorDefaultsFromModels,
  resolveAntigravityOrchestratorPair,
  thinkingLevelsForAntigravityModel,
  updateAntigravityOrchestratorSelection,
} from "@t3tools/client-runtime/antigravity-orchestrator";
import * as Haptics from "expo-haptics";
import { useGT, useMessages } from "gt-react-native";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { READABLE_WIDTH_STYLE } from "../../components/ui/listMetrics";
import { cn } from "../../lib/cn";
import type { ModelOption } from "../../lib/modelOptions";
import { rememberModelOptions } from "../../state/use-model-option-memory";

// The Antigravity Orchestrator in the mobile thread settings sheet: a catalog row with
// the current planner and executor pair, a two-step picker, and option changes that keep
// the pair consistent. Kept out of ThreadSettingsSheet so that upstream file only carries
// hook lines.

export type AgyOrchestratorSubmenu =
  | {
      readonly kind: "antigravityOrchestratorPlanner";
      readonly instanceId: ProviderInstanceId;
      readonly optionKey: string;
    }
  | {
      readonly kind: "antigravityOrchestratorExecutor";
      readonly instanceId: ProviderInstanceId;
      readonly optionKey: string;
      readonly plannerModel: AntigravityOrchestratorPlannerModel;
    };

export function isAgyOrchestratorSubmenu(submenu: {
  readonly kind: string;
}): submenu is AgyOrchestratorSubmenu {
  return (
    submenu.kind === "antigravityOrchestratorPlanner" ||
    submenu.kind === "antigravityOrchestratorExecutor"
  );
}

export function useAgyOrchestratorSubmenuTitle() {
  const gt = useGT();
  return (submenu: AgyOrchestratorSubmenu) =>
    submenu.kind === "antigravityOrchestratorExecutor"
      ? gt("Choose Executor")
      : gt("Choose Orchestrator");
}

export type AgyOrchestratorCatalogItem = {
  readonly kind: "antigravityOrchestrator";
  readonly key: string;
  readonly option: ModelOption;
};

/** Moves an Antigravity provider's Orchestrator out of its model list into its own row. */
export function splitAgyOrchestratorOption(
  driver: string,
  collapsed: boolean,
  models: ReadonlyArray<ModelOption>,
) {
  const option =
    !collapsed && driver === "antigravity"
      ? (models.find((model) => model.selection.model === ANTIGRAVITY_ORCHESTRATOR_MODEL) ?? null)
      : null;
  const items: AgyOrchestratorCatalogItem[] = option
    ? [{ kind: "antigravityOrchestrator", key: `antigravity-orchestrator:${option.key}`, option }]
    : [];
  return {
    models: option ? models.filter((model) => model.key !== option.key) : models,
    items,
  };
}

/** The sheet session's Orchestrator half; built by its provider from its own state. */
export function createAgyOrchestratorSession(input: {
  readonly providers:
    | ReadonlyArray<{
        readonly instanceId: ProviderInstanceId;
        readonly models: ReadonlyArray<ServerProviderModel>;
      }>
    | undefined;
  readonly modelOptions: ReadonlyArray<ModelOption>;
  readonly messages: ReturnType<typeof useMessages>;
  readonly displayedDriver: string | undefined;
  readonly activeSelection: ModelSelection | null;
  readonly pendingModel: ModelOption | null;
  readonly setPendingModel: (option: ModelOption) => void;
  readonly setPendingPrompt: (prompt: string | null) => void;
  readonly onUpdateOptionSelections: (selections: ReadonlyArray<ProviderOptionSelection>) => void;
}) {
  const getProviderModels = (instanceId: ProviderInstanceId): ReadonlyArray<ServerProviderModel> =>
    input.providers?.find((provider) => provider.instanceId === instanceId)?.models ?? [];

  const pendingFor = (
    option: ModelOption,
    pair: AntigravityOrchestratorSettings,
    selection: ModelSelection,
  ): ModelOption => ({
    ...option,
    shortName: formatAntigravityOrchestratorTriggerLabel(pair, input.messages),
    subtitle: formatAntigravityOrchestratorShortPair(pair),
    selection,
  });

  const selectPair = (option: ModelOption, pair: AntigravityOrchestratorSettings) => {
    void Haptics.selectionAsync();
    const selection = buildAntigravityOrchestratorSelection(option.selection.instanceId, pair);
    rememberModelOptions(
      option.selection.instanceId,
      option.selection.model,
      selection.options ?? [],
    );
    input.setPendingPrompt(null);
    input.setPendingModel(pendingFor(option, pair, selection));
  };

  /** Applies an Orchestrator option change; false when the change is not one. */
  const applyOptionChange = (id: string, value: string | boolean): boolean => {
    const selection = input.activeSelection;
    if (
      !selection ||
      input.displayedDriver !== "antigravity" ||
      !isAntigravityOrchestratorModel(selection.model) ||
      typeof value !== "string"
    ) {
      return false;
    }
    const patch: Partial<AntigravityOrchestratorSettings> | null =
      id === ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerModel &&
      isAntigravityOrchestratorPlannerModel(value)
        ? { plannerModel: value }
        : id === ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorModel &&
            isAntigravityOrchestratorExecutorModel(value)
          ? { executorModel: value }
          : id === ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerEffort &&
              isAntigravityThinkingLevel(value)
            ? { plannerEffort: value }
            : id === ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorEffort &&
                isAntigravityThinkingLevel(value)
              ? { executorEffort: value }
              : null;
    if (!patch) return false;
    const liveModels = getProviderModels(selection.instanceId);
    const defaults = readAntigravityOrchestratorDefaultsFromModels(liveModels);
    const updated = updateAntigravityOrchestratorSelection(selection, patch, defaults, liveModels);
    const nextOptions = updated.options ?? [];
    const pending = input.pendingModel;
    if (pending) {
      rememberModelOptions(pending.selection.instanceId, pending.selection.model, nextOptions);
      input.setPendingModel(
        pendingFor(
          pending,
          resolveAntigravityOrchestratorPair(updated, defaults, liveModels),
          updated,
        ),
      );
    } else {
      input.onUpdateOptionSelections(nextOptions);
    }
    return true;
  };

  return {
    getProviderModels,
    findModelOptionByKey: (key: string) =>
      input.modelOptions.find((option) => option.key === key) ?? null,
    selectPair,
    applyOptionChange,
  };
}

export type AgyOrchestratorSession = ReturnType<typeof createAgyOrchestratorSession>;

interface SessionView {
  readonly displayedModelSelection: ModelSelection | null;
  readonly isDisplayed: (option: ModelOption) => boolean;
  readonly agyOrchestrator: AgyOrchestratorSession;
}

/** Limits an Orchestrator effort menu to the levels its planner or executor model supports. */
export function filterAgyOrchestratorEffortChoices<C extends { readonly id: string }>(
  descriptor: ProviderOptionDescriptor,
  choices: ReadonlyArray<C>,
  session: SessionView,
): ReadonlyArray<C> {
  const selection = session.displayedModelSelection;
  const isPlanner = descriptor.id === ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerEffort;
  if (
    !selection ||
    !isAntigravityOrchestratorModel(selection.model) ||
    (!isPlanner && descriptor.id !== ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorEffort)
  ) {
    return choices;
  }
  const liveModels = session.agyOrchestrator.getProviderModels(selection.instanceId);
  const pair = resolveAntigravityOrchestratorPair(
    selection,
    readAntigravityOrchestratorDefaultsFromModels(liveModels),
    liveModels,
  );
  const allowed = new Set<string>(
    thinkingLevelsForAntigravityModel(
      isPlanner ? pair.plannerModel : pair.executorModel,
      liveModels,
    ),
  );
  return choices.filter((choice) => allowed.has(choice.id));
}

export function AgyOrchestratorCatalogRow(props: {
  readonly option: ModelOption;
  readonly session: SessionView;
  readonly onOpenSubmenu: (submenu: AgyOrchestratorSubmenu) => void;
}) {
  const gt = useGT();
  const { option, session } = props;
  const liveModels = session.agyOrchestrator.getProviderModels(option.selection.instanceId);
  const defaults = readAntigravityOrchestratorDefaultsFromModels(liveModels);
  const isSelected = session.isDisplayed(option);
  const activePair = isSelected
    ? resolveAntigravityOrchestratorPair(session.displayedModelSelection, defaults, liveModels)
    : defaults;
  return (
    <View className="mx-4 mt-2.5 overflow-hidden rounded-2xl bg-grouped-card">
      <View className="flex-row items-center gap-2 px-4 py-3">
        <Pressable
          accessibilityRole="button"
          className="min-w-0 flex-1 flex-row items-center gap-2.5"
          onPress={() =>
            props.onOpenSubmenu({
              kind: "antigravityOrchestratorPlanner",
              instanceId: option.selection.instanceId,
              optionKey: option.key,
            })
          }
        >
          <View className="min-w-0 flex-1 gap-0.5">
            <View className="flex-row items-center gap-1.5">
              <Text textRole="body" className="font-t3-medium text-foreground" numberOfLines={1}>
                {gt("Orchestrator")}
              </Text>
              {isSelected ? (
                <SymbolView
                  name="checkmark"
                  size={14}
                  tintColorClassName="accent-icon"
                  type="monochrome"
                  weight="semibold"
                />
              ) : null}
            </View>
            <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
              {formatAntigravityOrchestratorShortPair(activePair)}
            </Text>
          </View>
          <SymbolView
            name="chevron.right"
            size={13}
            tintColorClassName="accent-icon-muted"
            type="monochrome"
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Use default ({pair})", {
            pair: formatAntigravityOrchestratorShortPair(defaults),
          })}
          className="rounded-full border border-border-subtle px-2.5 py-1 active:opacity-70"
          onPress={() => session.agyOrchestrator.selectPair(option, defaults)}
        >
          <Text textRole="footnote" className="font-t3-medium text-foreground-muted">
            {gt("Default", { $context: "quick action to use default orchestrator models" })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Step 1 picks the planner and pushes step 2, which picks the executor and finishes. */
export function AgyOrchestratorChoicePage(props: {
  readonly submenu: AgyOrchestratorSubmenu;
  readonly session: SessionView;
  readonly onOpenSubmenu?: ((submenu: AgyOrchestratorSubmenu) => void) | undefined;
  readonly onFinish?: (() => void) | undefined;
}) {
  const insets = useSafeAreaInsets();
  const gt = useGT();
  const m = useMessages();
  const { submenu, session } = props;
  const liveModels = session.agyOrchestrator.getProviderModels(submenu.instanceId);
  const defaults = readAntigravityOrchestratorDefaultsFromModels(liveModels);
  const currentPair = resolveAntigravityOrchestratorPair(
    session.displayedModelSelection,
    defaults,
    liveModels,
  );

  const cards =
    submenu.kind === "antigravityOrchestratorPlanner"
      ? availableAntigravityOrchestratorPlanners(liveModels).map((slug) => {
          const guide = getAntigravityPlannerGuide(slug, m, liveModels);
          return {
            slug,
            guide,
            title: gt("Orchestrator ({model})", { model: antigravityOrchestratorShortName(slug) }),
            idealFor: gt("Ideal for: {detail}", { detail: guide.idealFor }),
            isCurrent: currentPair.plannerModel === slug,
            onPress: () => {
              void Haptics.selectionAsync();
              props.onOpenSubmenu?.({
                kind: "antigravityOrchestratorExecutor",
                instanceId: submenu.instanceId,
                optionKey: submenu.optionKey,
                plannerModel: slug,
              });
            },
          };
        })
      : availableAntigravityOrchestratorExecutors(liveModels).map((slug) => {
          const guide = getAntigravityExecutorGuide(slug, m, liveModels);
          return {
            slug,
            guide,
            title: guide.name,
            idealFor: gt("Ideal as executor for: {detail}", { detail: guide.idealFor }),
            isCurrent: currentPair.executorModel === slug,
            onPress: () => {
              const option = session.agyOrchestrator.findModelOptionByKey(submenu.optionKey);
              if (option) {
                session.agyOrchestrator.selectPair(
                  option,
                  resolveAntigravityOrchestratorPair(
                    buildAntigravityOrchestratorSelection(submenu.instanceId, {
                      plannerModel: submenu.plannerModel,
                      plannerEffort: currentPair.plannerEffort,
                      executorModel: slug,
                      executorEffort: currentPair.executorEffort,
                    }),
                    defaults,
                    liveModels,
                  ),
                );
              }
              props.onFinish?.();
            },
          };
        });

  return (
    <ScrollView
      className="flex-1 bg-sheet"
      style={READABLE_WIDTH_STYLE}
      contentContainerStyle={{
        paddingBottom: insets.bottom + 16,
        paddingHorizontal: 16,
        paddingTop: 12,
        gap: 12,
      }}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      <Text textRole="footnote" className="px-1 text-foreground-muted">
        {submenu.kind === "antigravityOrchestratorPlanner"
          ? gt(
              "Step 1 of 2 · Plans the work, makes architectural decisions, and reviews the final result.",
            )
          : gt("Step 2 of 2 · Orchestrator: {planner}. Carries out searches, edits, and tests.", {
              planner: antigravityOrchestratorShortName(submenu.plannerModel),
            })}
      </Text>
      <View className="gap-3">
        {cards.map((card) => (
          <Pressable
            key={card.slug}
            accessibilityRole="button"
            className={cn(
              "rounded-2xl bg-grouped-card p-4 gap-2 border",
              card.isCurrent ? "border-foreground/30" : "border-border-subtle",
            )}
            onPress={card.onPress}
          >
            <View className="flex-row items-center justify-between gap-2">
              <Text textRole="body" className="font-t3-semibold text-foreground">
                {card.title}
              </Text>
              {card.guide.badge ? (
                <Text textRole="footnote" className="text-foreground-muted">
                  {card.guide.badge}
                </Text>
              ) : null}
            </View>
            {card.guide.pros.map((pro) => (
              <Text key={pro} textRole="footnote" className="text-foreground-muted">
                {`• ${pro}`}
              </Text>
            ))}
            <Text textRole="footnote" className="text-foreground">
              {card.idealFor}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
