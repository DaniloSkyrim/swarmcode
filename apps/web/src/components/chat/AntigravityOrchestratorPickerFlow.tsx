import {
  antigravityOrchestratorShortName,
  availableAntigravityOrchestratorExecutors,
  availableAntigravityOrchestratorPlanners,
  getAntigravityExecutorGuide,
  getAntigravityPlannerGuide,
  type AntigravityOrchestratorModelGuide,
} from "@t3tools/client-runtime/antigravity-orchestrator";
import {
  normalizeAntigravityThinkingLevel,
  type AntigravityOrchestratorExecutorModel,
  type AntigravityOrchestratorPlannerModel,
  type AntigravityOrchestratorSettings,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";
import { ArrowLeftIcon, CheckIcon, ChevronRightIcon } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";

interface AntigravityOrchestratorPickerFlowProps {
  readonly liveModels: ReadonlyArray<ServerProviderModel>;
  readonly currentPair: AntigravityOrchestratorSettings;
  readonly isActiveOrchestrator: boolean;
  readonly onBack: () => void;
  readonly onComplete: (pair: AntigravityOrchestratorSettings) => void;
}

function GuideOptionCard({
  guide,
  title,
  idealForLabel,
  isCurrent,
  showNextChevron,
  buttonRef,
  onSelect,
  onKeyDown,
}: {
  readonly guide: AntigravityOrchestratorModelGuide;
  readonly title: string;
  readonly idealForLabel: string;
  readonly isCurrent: boolean;
  readonly showNextChevron: boolean;
  readonly buttonRef: (node: HTMLButtonElement | null) => void;
  readonly onSelect: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-orchestrator-option={guide.slug}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        "group flex w-full cursor-pointer flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors outline-none",
        isCurrent
          ? "border-foreground/30 bg-foreground/[0.06] hover:bg-foreground/[0.09] focus-visible:bg-foreground/[0.09]"
          : "border-border/70 bg-background/40 hover:border-border hover:bg-foreground/[0.06] focus-visible:border-ring focus-visible:bg-foreground/[0.06]",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">{title}</span>
        {guide.badge ? (
          <Badge variant="outline" size="sm">
            {guide.badge}
          </Badge>
        ) : null}
        {isCurrent ? (
          <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-foreground" />
        ) : showNextChevron ? (
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        ) : null}
      </div>
      <ul className="space-y-0.5 text-muted-foreground text-xs leading-snug">
        {guide.pros.map((pro) => (
          <li key={pro} className="flex items-start gap-1.5">
            <span
              aria-hidden="true"
              className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/70"
            />
            <span>{pro}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground/90 text-xs leading-snug">
        <span className="font-medium text-foreground/85">{idealForLabel}</span> {guide.idealFor}
      </p>
    </button>
  );
}

export function AntigravityOrchestratorPickerFlow({
  liveModels,
  currentPair,
  isActiveOrchestrator,
  onBack,
  onComplete,
}: AntigravityOrchestratorPickerFlowProps) {
  const gt = useGT();
  const messages = useMessages();
  const [step, setStep] = useState<"planner" | "executor">("planner");
  const [selectedPlanner, setSelectedPlanner] = useState<AntigravityOrchestratorPlannerModel>(
    currentPair.plannerModel,
  );
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const planners = availableAntigravityOrchestratorPlanners(liveModels);
  const executors = availableAntigravityOrchestratorExecutors(liveModels);

  const focusOptionAt = (index: number, count: number) => {
    if (count === 0) return;
    const bounded = (index + count) % count;
    optionRefs.current[bounded]?.focus({ preventScroll: true });
  };

  const handleBackStep = () => {
    if (step === "executor") {
      setStep("planner");
      window.requestAnimationFrame(() => optionRefs.current[0]?.focus({ preventScroll: true }));
      return;
    }
    onBack();
  };

  const handleSelectPlanner = (plannerModel: AntigravityOrchestratorPlannerModel) => {
    setSelectedPlanner(plannerModel);
    setStep("executor");
    window.requestAnimationFrame(() => optionRefs.current[0]?.focus({ preventScroll: true }));
  };

  const handleSelectExecutor = (executorModel: AntigravityOrchestratorExecutorModel) => {
    onComplete({
      plannerModel: selectedPlanner,
      plannerEffort: normalizeAntigravityThinkingLevel(selectedPlanner, currentPair.plannerEffort),
      executorModel,
      executorEffort: normalizeAntigravityThinkingLevel(executorModel, currentPair.executorEffort),
    });
  };

  const makeCardKeyDown =
    (index: number, count: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        focusOptionAt(index + 1, count);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        focusOptionAt(index - 1, count);
      } else if (event.key === "Escape" || event.key === "Backspace" || event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        handleBackStep();
      }
    };

  return (
    <div
      data-antigravity-orchestrator-flow={step}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/40"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          handleBackStep();
        }
      }}
    >
      {/* Matches the search row height so the horizontal divider stays aligned with the effort column. */}
      <div className="shrink-0 px-2.5 pt-2.5">
        <div className="flex h-8.25 -translate-y-px items-center gap-2 border-b border-border/70 pb-1.5">
          <button
            type="button"
            onClick={handleBackStep}
            aria-label={gt("Back")}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/[0.09] hover:text-foreground focus-visible:bg-foreground/[0.09] focus-visible:text-foreground"
          >
            <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          </button>
          <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">
            {step === "planner" ? gt("Choose Orchestrator") : gt("Choose Executor")}
          </span>
          {step === "executor" ? (
            <Badge variant="outline" size="sm">
              {antigravityOrchestratorShortName(selectedPlanner)}
            </Badge>
          ) : null}
          <span className="shrink-0 font-mono text-muted-foreground text-xs">
            {step === "planner" ? "1/2" : "2/2"}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain px-2.5 py-2">
        <p className="text-muted-foreground text-xs leading-snug">
          {step === "planner"
            ? gt("Plans the work, makes architectural decisions, and reviews edits.")
            : gt("Carries out the plan: searches files, applies edits, and runs tests.")}
        </p>

        {step === "planner"
          ? planners.map((slug, index) => {
              const guide = getAntigravityPlannerGuide(slug, messages, liveModels);
              return (
                <GuideOptionCard
                  key={slug}
                  guide={guide}
                  title={gt("Orchestrator ({model})", { model: guide.shortName })}
                  idealForLabel={gt("Ideal for:")}
                  isCurrent={isActiveOrchestrator && currentPair.plannerModel === slug}
                  showNextChevron
                  buttonRef={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  onSelect={() => handleSelectPlanner(slug)}
                  onKeyDown={makeCardKeyDown(index, planners.length)}
                />
              );
            })
          : executors.map((slug, index) => {
              const guide = getAntigravityExecutorGuide(slug, messages, liveModels);
              return (
                <GuideOptionCard
                  key={slug}
                  guide={guide}
                  title={guide.name}
                  idealForLabel={gt("Ideal as executor for:")}
                  isCurrent={
                    isActiveOrchestrator &&
                    currentPair.plannerModel === selectedPlanner &&
                    currentPair.executorModel === slug
                  }
                  showNextChevron={false}
                  buttonRef={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  onSelect={() => handleSelectExecutor(slug)}
                  onKeyDown={makeCardKeyDown(index, executors.length)}
                />
              );
            })}
      </div>
    </div>
  );
}
