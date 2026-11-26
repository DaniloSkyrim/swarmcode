import {
  antigravityThinkingLevelLabel,
  availableAntigravityOrchestratorExecutors,
  availableAntigravityOrchestratorPlanners,
  getAntigravityExecutorGuide,
  getAntigravityPlannerGuide,
  readAntigravityOrchestratorSettings,
  thinkingLevelsForAntigravityModel,
  type AntigravityOrchestratorModelGuide,
} from "@t3tools/client-runtime/antigravity-orchestrator";
import {
  isAntigravityOrchestratorExecutorModel,
  isAntigravityOrchestratorPlannerModel,
  isAntigravityThinkingLevel,
  normalizeAntigravityThinkingLevel,
  type AntigravityOrchestratorSettings,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { CheckIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ModelGuideDetails({
  guide,
  roleLabel,
}: {
  readonly guide: AntigravityOrchestratorModelGuide;
  readonly roleLabel: string;
}) {
  return (
    <div className="mt-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-foreground">{guide.name}</span>
        {guide.badge ? (
          <Badge variant="outline" size="sm">
            {guide.badge}
          </Badge>
        ) : null}
      </div>
      <ul className="mt-1.5 space-y-1 text-muted-foreground">
        {guide.pros.map((pro) => (
          <li key={pro} className="flex items-start gap-1.5 leading-snug">
            <CheckIcon aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-foreground/70" />
            <span>{pro}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-muted-foreground/90 leading-snug">
        <span className="font-medium text-foreground/85">{roleLabel}</span> {guide.idealFor}
      </p>
    </div>
  );
}

export function AntigravityOrchestratorSettingsSection({
  instanceId,
  config,
  liveModels,
  readOnly = false,
  onChange,
}: {
  readonly instanceId: string;
  readonly config: unknown;
  readonly liveModels: ReadonlyArray<ServerProviderModel> | undefined;
  readonly readOnly?: boolean;
  readonly onChange: (nextConfig: Record<string, unknown> | undefined) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const current = readAntigravityOrchestratorSettings(isPlainRecord(config) ? config : null);
  const planners = availableAntigravityOrchestratorPlanners(liveModels);
  const executors = availableAntigravityOrchestratorExecutors(liveModels);
  const plannerLevels = thinkingLevelsForAntigravityModel(current.plannerModel, liveModels);
  const executorLevels = thinkingLevelsForAntigravityModel(current.executorModel, liveModels);
  const activePlannerGuide = getAntigravityPlannerGuide(current.plannerModel, messages, liveModels);
  const activeExecutorGuide = getAntigravityExecutorGuide(
    current.executorModel,
    messages,
    liveModels,
  );

  const commit = (patch: Partial<AntigravityOrchestratorSettings>) => {
    const plannerModel = patch.plannerModel ?? current.plannerModel;
    const executorModel = patch.executorModel ?? current.executorModel;
    const plannerEffort = normalizeAntigravityThinkingLevel(
      plannerModel,
      patch.plannerEffort ?? current.plannerEffort,
    );
    const executorEffort = normalizeAntigravityThinkingLevel(
      executorModel,
      patch.executorEffort ?? current.executorEffort,
    );
    const nextPair: AntigravityOrchestratorSettings = {
      plannerModel,
      plannerEffort,
      executorModel,
      executorEffort,
    };
    const base = isPlainRecord(config) ? { ...config } : {};
    base.orchestrator = nextPair;
    onChange(base);
  };

  return (
    <SettingsSection
      title={gt("Orchestrator Settings")}
      inert={readOnly}
      aria-disabled={readOnly || undefined}
      className={cn(readOnly && "opacity-50 select-none")}
    >
      <div className="border-b border-border/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground sm:px-4">
        <T>
          Choose the models Orchestrator uses. A larger, smarter orchestrator model with a faster,
          cheaper executor gives high quality for fewer tokens.
        </T>
      </div>

      <SettingsRow
        title={gt("Orchestrator Model")}
        description={gt(
          "Plans the work, makes design decisions, and reviews the result. Pick a top-tier model. You can also pick one per conversation from the Orchestrator row in the model menu.",
        )}
      >
        <div className="mt-2.5 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`provider-instance-${instanceId}-orchestrator-planner-model`}
              className="text-muted-foreground text-xs"
            >
              {gt("Model")}
            </label>
            <Select
              value={current.plannerModel}
              disabled={readOnly}
              onValueChange={(next) => {
                if (typeof next === "string" && isAntigravityOrchestratorPlannerModel(next)) {
                  commit({ plannerModel: next });
                }
              }}
            >
              <SelectTrigger
                id={`provider-instance-${instanceId}-orchestrator-planner-model`}
                size="sm"
                className="w-48"
                aria-label={gt("Orchestrator Model")}
              >
                <SelectValue>{activePlannerGuide.name}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                {planners.map((slug) => {
                  const guide = getAntigravityPlannerGuide(slug, messages, liveModels);
                  return (
                    <SelectItem key={slug} value={slug}>
                      <span className="flex items-center gap-1.5">
                        <span>{guide.name}</span>
                        {guide.badge ? (
                          <Badge variant="outline" size="sm">
                            {guide.badge}
                          </Badge>
                        ) : null}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectPopup>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`provider-instance-${instanceId}-orchestrator-planner-effort`}
              className="text-muted-foreground text-xs"
            >
              {gt("Thinking Level")}
            </label>
            <Select
              value={current.plannerEffort}
              disabled={readOnly}
              onValueChange={(next) => {
                if (typeof next === "string" && isAntigravityThinkingLevel(next)) {
                  commit({ plannerEffort: next });
                }
              }}
            >
              <SelectTrigger
                id={`provider-instance-${instanceId}-orchestrator-planner-effort`}
                size="sm"
                className="w-32"
                aria-label={gt("Orchestrator thinking level")}
              >
                <SelectValue>
                  {antigravityThinkingLevelLabel(current.plannerEffort, messages)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                {plannerLevels.map((level) => (
                  <SelectItem key={level} value={level}>
                    {antigravityThinkingLevelLabel(level, messages)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </div>
        <ModelGuideDetails guide={activePlannerGuide} roleLabel={gt("Ideal for:")} />
      </SettingsRow>

      <SettingsRow
        title={gt("Executor Model")}
        description={gt(
          "Carries out the plan: searches, edits, builds, and tests. Pick a faster, cheaper model.",
        )}
      >
        <div className="mt-2.5 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`provider-instance-${instanceId}-orchestrator-executor-model`}
              className="text-muted-foreground text-xs"
            >
              {gt("Model")}
            </label>
            <Select
              value={current.executorModel}
              disabled={readOnly}
              onValueChange={(next) => {
                if (typeof next === "string" && isAntigravityOrchestratorExecutorModel(next)) {
                  commit({ executorModel: next });
                }
              }}
            >
              <SelectTrigger
                id={`provider-instance-${instanceId}-orchestrator-executor-model`}
                size="sm"
                className="w-48"
                aria-label={gt("Executor Model")}
              >
                <SelectValue>{activeExecutorGuide.name}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                {executors.map((slug) => {
                  const guide = getAntigravityExecutorGuide(slug, messages, liveModels);
                  return (
                    <SelectItem key={slug} value={slug}>
                      <span className="flex items-center gap-1.5">
                        <span>{guide.name}</span>
                        {guide.badge ? (
                          <Badge variant="outline" size="sm">
                            {guide.badge}
                          </Badge>
                        ) : null}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectPopup>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`provider-instance-${instanceId}-orchestrator-executor-effort`}
              className="text-muted-foreground text-xs"
            >
              {gt("Thinking Level")}
            </label>
            <Select
              value={current.executorEffort}
              disabled={readOnly}
              onValueChange={(next) => {
                if (typeof next === "string" && isAntigravityThinkingLevel(next)) {
                  commit({ executorEffort: next });
                }
              }}
            >
              <SelectTrigger
                id={`provider-instance-${instanceId}-orchestrator-executor-effort`}
                size="sm"
                className="w-32"
                aria-label={gt("Executor thinking level")}
              >
                <SelectValue>
                  {antigravityThinkingLevelLabel(current.executorEffort, messages)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                {executorLevels.map((level) => (
                  <SelectItem key={level} value={level}>
                    {antigravityThinkingLevelLabel(level, messages)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </div>
        <ModelGuideDetails guide={activeExecutorGuide} roleLabel={gt("Ideal as executor for:")} />
      </SettingsRow>
    </SettingsSection>
  );
}
