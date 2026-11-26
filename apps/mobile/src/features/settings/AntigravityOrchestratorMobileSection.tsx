import {
  antigravityThinkingLevelLabel,
  availableAntigravityOrchestratorExecutors,
  availableAntigravityOrchestratorPlanners,
  getAntigravityExecutorGuide,
  getAntigravityPlannerGuide,
  readAntigravityOrchestratorSettings,
  thinkingLevelsForAntigravityModel,
} from "@t3tools/client-runtime/antigravity-orchestrator";
import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  isAntigravityOrchestratorExecutorModel,
  isAntigravityOrchestratorPlannerModel,
  isAntigravityThinkingLevel,
  normalizeAntigravityThinkingLevel,
  type AntigravityOrchestratorSettings,
  type ServerProvider,
} from "@t3tools/contracts";
import type { MenuAction } from "@react-native-menu/menu";
import { T, useGT, useMessages } from "gt-react-native";
import { useRef, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { Menu } from "../../components/ui/Menu";
import { m } from "../../i18n/messages";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { SettingsTarget } from "./settings-environment-filter";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function AntigravityOrchestratorMobileSection({
  environment,
  provider,
}: {
  readonly environment: SettingsTarget;
  readonly provider: ServerProvider;
}) {
  const gt = useGT();
  const messages = useMessages();
  const mutate = useAtomCommand(serverEnvironment.mutateProviderInstance, {
    reportFailure: false,
    reportDefect: false,
  });
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const instance = environment.serverConfig.settings.providerInstances[provider.instanceId];
  const rawConfig = instance?.config;
  const current = readAntigravityOrchestratorSettings(isPlainRecord(rawConfig) ? rawConfig : null);
  const planners = availableAntigravityOrchestratorPlanners(provider.models);
  const executors = availableAntigravityOrchestratorExecutors(provider.models);
  const plannerLevels = thinkingLevelsForAntigravityModel(current.plannerModel, provider.models);
  const executorLevels = thinkingLevelsForAntigravityModel(current.executorModel, provider.models);
  const plannerGuide = getAntigravityPlannerGuide(current.plannerModel, messages, provider.models);
  const executorGuide = getAntigravityExecutorGuide(
    current.executorModel,
    messages,
    provider.models,
  );

  async function save(patch: Partial<AntigravityOrchestratorSettings>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const plannerModel = patch.plannerModel ?? current.plannerModel;
    const executorModel = patch.executorModel ?? current.executorModel;
    const nextOrchestrator: AntigravityOrchestratorSettings = {
      plannerModel,
      plannerEffort: normalizeAntigravityThinkingLevel(
        plannerModel,
        patch.plannerEffort ?? current.plannerEffort,
      ),
      executorModel,
      executorEffort: normalizeAntigravityThinkingLevel(
        executorModel,
        patch.executorEffort ?? current.executorEffort,
      ),
    };
    const nextConfig: Record<string, unknown> = isPlainRecord(rawConfig) ? { ...rawConfig } : {};
    nextConfig.orchestrator = nextOrchestrator;
    const result = await mutate({
      environmentId: environment.environmentId,
      input: {
        patch: {},
        providerInstanceMutation: {
          operation: "upsert",
          instanceId: provider.instanceId,
          instance: {
            ...(instance ?? { driver: provider.driver }),
            config: nextConfig,
          },
        },
      },
    });
    pendingRef.current = false;
    setPending(false);
    if (result._tag !== "Success" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(
        failure instanceof Error
          ? (errorDisplayMessage(failure, m) ?? failure.message)
          : gt("Could not save Orchestrator settings."),
      );
    }
  }

  const plannerModelActions: MenuAction[] = planners.map((slug) => {
    const guide = getAntigravityPlannerGuide(slug, messages, provider.models);
    return {
      id: `planner-model:${slug}`,
      title: guide.badge ? `${guide.name} (${guide.badge})` : guide.name,
      state: slug === current.plannerModel ? "on" : "off",
    };
  });
  const plannerEffortActions: MenuAction[] = plannerLevels.map((level) => ({
    id: `planner-effort:${level}`,
    title: antigravityThinkingLevelLabel(level, messages),
    state: level === current.plannerEffort ? "on" : "off",
  }));
  const executorModelActions: MenuAction[] = executors.map((slug) => {
    const guide = getAntigravityExecutorGuide(slug, messages, provider.models);
    return {
      id: `executor-model:${slug}`,
      title: guide.badge ? `${guide.name} (${guide.badge})` : guide.name,
      state: slug === current.executorModel ? "on" : "off",
    };
  });
  const executorEffortActions: MenuAction[] = executorLevels.map((level) => ({
    id: `executor-effort:${level}`,
    title: antigravityThinkingLevelLabel(level, messages),
    state: level === current.executorEffort ? "on" : "off",
  }));

  return (
    <View className="border-t border-border-subtle px-4 py-3 gap-3">
      <View className="gap-1">
        <Text textRole="headline" className="font-t3-medium text-foreground">
          {gt("Orchestrator Settings")}
        </Text>
        <Text textRole="footnote" className="text-foreground-muted">
          <T>
            Choose the models Orchestrator uses. A larger, smarter orchestrator model with a faster,
            cheaper executor gives high quality for fewer tokens.
          </T>
        </Text>
      </View>

      <View className="gap-2 rounded-xl bg-grouped-card-elevated/40 p-3 border border-border-subtle">
        <Text textRole="footnote" className="font-t3-medium text-foreground">
          {gt("Orchestrator Model")}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Menu
            accessible
            accessibilityRole="button"
            accessibilityLabel={gt("Orchestrator Model")}
            title={gt("Orchestrator Model")}
            actions={plannerModelActions}
            onPressAction={({ nativeEvent }) => {
              const slug = nativeEvent.event.replace("planner-model:", "");
              if (isAntigravityOrchestratorPlannerModel(slug)) {
                void save({ plannerModel: slug });
              }
            }}
          >
            <ControlPill label={plannerGuide.name} disabled={pending} />
          </Menu>
          <Menu
            accessible
            accessibilityRole="button"
            accessibilityLabel={gt("Orchestrator thinking level")}
            title={gt("Orchestrator thinking level")}
            actions={plannerEffortActions}
            onPressAction={({ nativeEvent }) => {
              const level = nativeEvent.event.replace("planner-effort:", "");
              if (isAntigravityThinkingLevel(level)) {
                void save({ plannerEffort: level });
              }
            }}
          >
            <ControlPill
              variant="pill"
              label={antigravityThinkingLevelLabel(current.plannerEffort, messages)}
              disabled={pending}
            />
          </Menu>
        </View>
        <Text textRole="footnote" className="text-foreground-muted">
          {gt("Ideal for: {detail}", { detail: plannerGuide.idealFor })}
        </Text>
      </View>

      <View className="gap-2 rounded-xl bg-grouped-card-elevated/40 p-3 border border-border-subtle">
        <Text textRole="footnote" className="font-t3-medium text-foreground">
          {gt("Executor Model")}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Menu
            accessible
            accessibilityRole="button"
            accessibilityLabel={gt("Executor Model")}
            title={gt("Executor Model")}
            actions={executorModelActions}
            onPressAction={({ nativeEvent }) => {
              const slug = nativeEvent.event.replace("executor-model:", "");
              if (isAntigravityOrchestratorExecutorModel(slug)) {
                void save({ executorModel: slug });
              }
            }}
          >
            <ControlPill label={executorGuide.name} disabled={pending} />
          </Menu>
          <Menu
            accessible
            accessibilityRole="button"
            accessibilityLabel={gt("Executor thinking level")}
            title={gt("Executor thinking level")}
            actions={executorEffortActions}
            onPressAction={({ nativeEvent }) => {
              const level = nativeEvent.event.replace("executor-effort:", "");
              if (isAntigravityThinkingLevel(level)) {
                void save({ executorEffort: level });
              }
            }}
          >
            <ControlPill
              variant="pill"
              label={antigravityThinkingLevelLabel(current.executorEffort, messages)}
              disabled={pending}
            />
          </Menu>
        </View>
        <Text textRole="footnote" className="text-foreground-muted">
          {gt("Ideal as executor for: {detail}", { detail: executorGuide.idealFor })}
        </Text>
      </View>

      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
