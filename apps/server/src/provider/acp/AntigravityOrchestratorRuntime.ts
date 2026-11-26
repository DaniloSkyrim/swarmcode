import {
  ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS,
  DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
  isAntigravityOrchestratorExecutorModel,
  isAntigravityOrchestratorPlannerModel,
  legacyAntigravityOrchestratorPlannerModel,
  normalizeAntigravityThinkingLevel,
  type AntigravityOrchestratorSettings,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import { antigravityModelOptions, antigravityThinkingConfig } from "./AntigravityAcpSupport.ts";

const HANDOFF_OPEN_TAG = "<t3_orchestrator_handoff";
const HANDOFF_CLOSE_TAG = "</t3_orchestrator_handoff>";
const HANDOFF_ATTR_RE = /action\s*=\s*"(execute|replan)"/i;
const MAX_REPLAN_CYCLES = 1;

const MODEL_LABELS: Readonly<Record<string, string>> = {
  "gemini-4-neon": "Gemini 4 Neon",
  "gemini-4-carbon": "Gemini 4 Carbon",
  "gemini-4-hydrogen": "Gemini 4 Hydrogen",
};

const EFFORT_LABELS: Readonly<Record<string, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
};

const EDIT_OR_COMMAND_TITLE_RE =
  /\b(write|edit|patch|replace|create|delete|remove|rename|move|run|exec|shell|command|terminal)\b/i;

export interface ParsedOrchestratorHandoff {
  readonly action: "execute" | "replan";
  readonly summary: string;
}

/**
 * Strips `<t3_orchestrator_handoff ...>...</t3_orchestrator_handoff>` from streamed
 * planner chunks across arbitrary chunk boundaries so internal protocol tags never reach chat.
 */
export class HandoffStreamFilter {
  private pending = "";
  private capturing = false;
  private captured = "";
  private parsed: ParsedOrchestratorHandoff | undefined;

  push(chunk: string): string {
    if (!chunk) return "";
    let visible = "";
    let data = this.pending + chunk;
    this.pending = "";

    while (data.length > 0) {
      if (this.capturing) {
        const closeIndex = data.indexOf(HANDOFF_CLOSE_TAG);
        if (closeIndex !== -1) {
          this.captured += data.slice(0, closeIndex + HANDOFF_CLOSE_TAG.length);
          this.parseCaptured();
          this.capturing = false;
          this.captured = "";
          data = data.slice(closeIndex + HANDOFF_CLOSE_TAG.length);
          continue;
        }
        const safeSplit = Math.max(0, data.length - (HANDOFF_CLOSE_TAG.length - 1));
        this.captured += data.slice(0, safeSplit);
        this.pending = data.slice(safeSplit);
        break;
      }

      const openIndex = data.indexOf(HANDOFF_OPEN_TAG);
      if (openIndex !== -1) {
        visible += data.slice(0, openIndex);
        this.capturing = true;
        this.captured = "";
        data = data.slice(openIndex);
        continue;
      }

      const partialLength = longestSuffixPrefixMatch(data, HANDOFF_OPEN_TAG);
      if (partialLength > 0) {
        visible += data.slice(0, data.length - partialLength);
        this.pending = data.slice(data.length - partialLength);
      } else {
        visible += data;
      }
      break;
    }

    return visible;
  }

  flush(): { readonly visible: string; readonly handoff: ParsedOrchestratorHandoff | undefined } {
    if (this.capturing) {
      this.captured += this.pending;
      this.pending = "";
      this.parseCaptured();
      this.capturing = false;
      this.captured = "";
      return { visible: "", handoff: this.parsed };
    }
    const remaining = this.pending;
    this.pending = "";
    return { visible: remaining, handoff: this.parsed };
  }

  private parseCaptured(): void {
    const startEnd = this.captured.indexOf(">");
    if (startEnd === -1) return;
    const header = this.captured.slice(0, startEnd + 1);
    const match = HANDOFF_ATTR_RE.exec(header);
    if (!match) return;
    const action = match[1]?.toLowerCase() === "replan" ? "replan" : "execute";
    const closeIndex = this.captured.lastIndexOf(HANDOFF_CLOSE_TAG);
    const body =
      closeIndex > startEnd
        ? this.captured.slice(startEnd + 1, closeIndex).trim()
        : this.captured.slice(startEnd + 1).trim();
    this.parsed = { action, summary: body };
  }
}

function longestSuffixPrefixMatch(text: string, prefix: string): number {
  const maxCheck = Math.min(text.length, prefix.length - 1);
  for (let len = maxCheck; len >= 1; len--) {
    if (text.endsWith(prefix.slice(0, len))) return len;
  }
  return 0;
}

function readSelectionStringOption(modelSelection: ModelSelection, id: string): string | undefined {
  const raw = modelSelection.options?.find((entry) => entry.id === id)?.value;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

export function resolveAntigravityOrchestratorRuntimePair(input: {
  readonly configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
  readonly modelSelection: ModelSelection;
  readonly defaults?: AntigravityOrchestratorSettings;
}): Effect.Effect<AntigravityOrchestratorSettings, EffectAcpErrors.AcpError> {
  const defaults = input.defaults ?? DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS;
  const available = new Set(
    antigravityModelOptions(input.configOptions).map((entry) => entry.value),
  );

  const optionPlanner = readSelectionStringOption(
    input.modelSelection,
    ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerModel,
  );
  const legacyPlanner = legacyAntigravityOrchestratorPlannerModel(input.modelSelection.model);
  const plannerModel =
    optionPlanner && isAntigravityOrchestratorPlannerModel(optionPlanner)
      ? optionPlanner
      : (legacyPlanner ?? defaults.plannerModel);

  const optionExecutor = readSelectionStringOption(
    input.modelSelection,
    ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorModel,
  );
  const executorModel =
    optionExecutor && isAntigravityOrchestratorExecutorModel(optionExecutor)
      ? optionExecutor
      : defaults.executorModel;

  if (available.size > 0 && !available.has(plannerModel)) {
    return Effect.fail(
      EffectAcpErrors.AcpRequestError.invalidParams(
        `Antigravity Orchestrator planner '${plannerModel}' is unavailable for this Google account.`,
      ),
    );
  }
  if (available.size > 0 && !available.has(executorModel)) {
    return Effect.fail(
      EffectAcpErrors.AcpRequestError.invalidParams(
        `Antigravity Orchestrator executor '${executorModel}' is unavailable for this Google account.`,
      ),
    );
  }

  const plannerEffort = normalizeAntigravityThinkingLevel(
    plannerModel,
    readSelectionStringOption(
      input.modelSelection,
      ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerEffort,
    ),
    defaults.plannerEffort,
  );
  const executorEffort = normalizeAntigravityThinkingLevel(
    executorModel,
    readSelectionStringOption(
      input.modelSelection,
      ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorEffort,
    ),
    defaults.executorEffort,
  );

  return Effect.succeed({
    plannerModel,
    plannerEffort,
    executorModel,
    executorEffort,
  });
}

function addOptionalNumber(
  left: number | null | undefined,
  right: number | null | undefined,
): number | undefined {
  if (typeof left === "number" && typeof right === "number") return left + right;
  if (typeof left === "number") return left;
  if (typeof right === "number") return right;
  return undefined;
}

function mergeAcpPromptUsage(
  left: EffectAcpSchema.PromptResponse["usage"],
  right: EffectAcpSchema.PromptResponse["usage"],
): EffectAcpSchema.PromptResponse["usage"] {
  if (!left) return right;
  if (!right) return left;
  const cachedReadTokens = addOptionalNumber(left.cachedReadTokens, right.cachedReadTokens);
  const cachedWriteTokens = addOptionalNumber(left.cachedWriteTokens, right.cachedWriteTokens);
  const thoughtTokens = addOptionalNumber(left.thoughtTokens, right.thoughtTokens);
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    ...(cachedReadTokens !== undefined ? { cachedReadTokens } : {}),
    ...(cachedWriteTokens !== undefined ? { cachedWriteTokens } : {}),
    ...(thoughtTokens !== undefined ? { thoughtTokens } : {}),
  };
}

function isMutatingOrFailedToolUpdate(
  update: EffectAcpSchema.SessionNotification["update"],
): boolean {
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return false;
  }
  if (update.status === "failed") return true;
  if (update.kind === "edit" || update.kind === "delete" || update.kind === "execute") {
    return true;
  }
  const title = update.title ?? "";
  return EDIT_OR_COMMAND_TITLE_RE.test(title);
}

function buildPlannerPhasePrompt(
  originalBlocks: ReadonlyArray<EffectAcpSchema.ContentBlock>,
  planOnly: boolean,
): ReadonlyArray<EffectAcpSchema.ContentBlock> {
  if (planOnly) return originalBlocks;
  const instructions = [
    "[Swarmcode Orchestrator: Planning Phase]",
    "You are acting as the Orchestrator Planner. The workspace is read-only during this planning phase.",
    "- If the user's request is a question, explanation, brainstorm, or read-only analysis that requires no file edits, code changes, or shell commands: answer directly and completely. Do NOT emit a handoff block.",
    "- If the request requires creating or editing files, running builds/tests, or making workspace changes: inspect relevant files, present a concise concrete plan, and end your response with:",
    '<t3_orchestrator_handoff action="execute">',
    "Concise execution instructions for the Executor model.",
    "</t3_orchestrator_handoff>",
  ].join("\n");
  return [...originalBlocks, { type: "text", text: instructions }];
}

function buildExecutorPhasePrompt(handoffSummary: string, isReplanFix: boolean): string {
  const heading = isReplanFix
    ? "[Swarmcode Orchestrator: Execution Fix Pass]"
    : "[Swarmcode Orchestrator: Execution Phase]";
  const guidance = isReplanFix
    ? "Apply the specific fixes requested in the review above, re-run the relevant checks, and summarize what you fixed."
    : "Carry out the plan from the previous message completely and accurately. Run relevant verification checks/tests after making changes, and summarize what you changed and verified.";
  const notes = handoffSummary.trim() ? `\n\nHandoff instructions:\n${handoffSummary.trim()}` : "";
  return `${heading}\nYou are acting as the Orchestrator Executor. ${guidance}${notes}`;
}

function buildReviewPhasePrompt(): string {
  return [
    "[Swarmcode Orchestrator: Review Phase]",
    "Review the Executor's changes and verification results against the user's original request and your plan.",
    "- If everything is complete, accurate, and verified: give a concise final summary to the user. Do NOT emit a handoff block.",
    "- Only if a concrete defect, missing requirement, or failing check remains: explain what must be fixed and end your response with:",
    '<t3_orchestrator_handoff action="replan">',
    "Specific fixes required from the Executor.",
    "</t3_orchestrator_handoff>",
  ].join("\n");
}

export const applyAntigravityModelAndEffort = Effect.fn("applyAntigravityModelAndEffort")(
  function* (input: {
    readonly runtime: Pick<
      AcpSessionRuntime.AcpSessionRuntime["Service"],
      "getConfigOptions" | "setModel" | "setConfigOption"
    >;
    readonly model: string;
    readonly effort: string;
  }): Effect.fn.Return<void, EffectAcpErrors.AcpError> {
    yield* input.runtime.setModel(input.model);
    const configOptions = yield* input.runtime.getConfigOptions;
    const thinking = antigravityThinkingConfig(configOptions);
    if (!thinking) return;
    const advertised = thinking.options.flatMap((entry) =>
      "value" in entry ? [entry.value] : entry.options.map((choice) => choice.value),
    );
    const targetEffort = advertised.includes(input.effort)
      ? input.effort
      : input.effort === "xhigh" && advertised.includes("high")
        ? "high"
        : undefined;
    if (targetEffort && thinking.currentValue !== targetEffort) {
      yield* input.runtime.setConfigOption(thinking.id, targetEffort).pipe(
        Effect.catchTags({
          AcpRequestError: (error) => (error.code === -32602 ? Effect.void : Effect.fail(error)),
        }),
      );
    }
  },
);

const applySessionModeIfSupported = Effect.fn("applySessionModeIfSupported")(function* (
  runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "getModeState" | "setMode">,
  modeId: string,
) {
  const modeState = yield* runtime.getModeState;
  if (!modeState) return;
  if (modeState.currentModeId === modeId) return;
  if (!modeState.availableModes.some((mode) => mode.id === modeId)) return;
  yield* runtime.setMode(modeId).pipe(Effect.ignore);
});

export interface AntigravityOrchestratorController {
  readonly setPair: (pair: AntigravityOrchestratorSettings | null) => void;
  readonly getPair: () => AntigravityOrchestratorSettings | null;
  readonly setPlanOnly: (planOnly: boolean) => void;
}

export function wrapAntigravityOrchestratorRuntime(
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
  options?: {
    readonly initialPlanOnly?: boolean;
  },
): {
  readonly runtime: AcpSessionRuntime.AcpSessionRuntime["Service"];
  readonly controller: AntigravityOrchestratorController;
} {
  let activePair: AntigravityOrchestratorSettings | null = null;
  let desiredSessionMode = "default";
  let planOnly = options?.initialPlanOnly === true;
  let activeSessionId = "session";
  let cancelled = false;
  let phase: "idle" | "planner" | "executor" | "review" = "idle";
  let activeFilter: HandoffStreamFilter | null = null;
  let hadEditsOrErrors = false;
  let outerUpdateHandler:
    | Parameters<AcpSessionRuntime.AcpSessionRuntime["Service"]["handleSessionUpdate"]>[0]
    | undefined;

  const controller: AntigravityOrchestratorController = {
    setPair: (pair) => {
      activePair = pair;
    },
    getPair: () => activePair,
    setPlanOnly: (next) => {
      planOnly = next;
    },
  };

  const emitThought = (text: string) => {
    if (!outerUpdateHandler) return Effect.void;
    return outerUpdateHandler({
      sessionId: activeSessionId,
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text },
      },
    }).pipe(Effect.ignore);
  };

  const emitMessageText = (text: string) => {
    if (!outerUpdateHandler || !text) return Effect.void;
    return outerUpdateHandler({
      sessionId: activeSessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    }).pipe(Effect.ignore);
  };

  const wrapped: AcpSessionRuntime.AcpSessionRuntime["Service"] = {
    ...runtime,
    start: () =>
      runtime.start().pipe(
        Effect.tap((started) =>
          Effect.sync(() => {
            activeSessionId = started.sessionId;
          }),
        ),
      ),
    loadSession: (sessionId, opts) =>
      runtime.loadSession(sessionId, opts).pipe(
        Effect.tap((started) =>
          Effect.sync(() => {
            activeSessionId = started.sessionId;
          }),
        ),
      ),
    resumeSession: (sessionId, opts) =>
      runtime.resumeSession(sessionId, opts).pipe(
        Effect.tap((started) =>
          Effect.sync(() => {
            activeSessionId = started.sessionId;
          }),
        ),
      ),
    forkSession: (sessionId, opts, meta) =>
      runtime.forkSession(sessionId, opts, meta).pipe(
        Effect.tap((started) =>
          Effect.sync(() => {
            activeSessionId = started.sessionId;
          }),
        ),
      ),
    setMode: (modeId) =>
      Effect.sync(() => {
        if (modeId === "plan") {
          planOnly = true;
        } else {
          planOnly = false;
          desiredSessionMode = modeId;
        }
      }).pipe(Effect.andThen(runtime.setMode(modeId))),
    cancel: Effect.sync(() => {
      cancelled = true;
    }).pipe(Effect.andThen(runtime.cancel)),
    handleSessionUpdate: (handler) => {
      outerUpdateHandler = handler;
      return runtime.handleSessionUpdate((notification) => {
        activeSessionId = notification.sessionId;
        if (phase === "executor" && isMutatingOrFailedToolUpdate(notification.update)) {
          hadEditsOrErrors = true;
        }
        if (
          activeFilter !== null &&
          notification.update.sessionUpdate === "agent_message_chunk" &&
          notification.update.content.type === "text"
        ) {
          const visible = activeFilter.push(notification.update.content.text);
          if (!visible) return Effect.void;
          return handler({
            ...notification,
            update: {
              ...notification.update,
              content: { ...notification.update.content, text: visible },
            },
          });
        }
        return handler(notification);
      });
    },
    prompt: (payload, promptOptions) => {
      const pair = activePair;
      if (!pair) return runtime.prompt(payload, promptOptions);

      return Effect.gen(function* () {
        cancelled = false;
        let totalUsage: EffectAcpSchema.PromptResponse["usage"] = undefined;

        const runPlannerOrReview = Effect.fn("AntigravityOrchestratorRuntime.runPlannerOrReview")(
          function* (
            nextPhase: "planner" | "review",
            blocks: ReadonlyArray<EffectAcpSchema.ContentBlock>,
            phasePromptOptions?: Parameters<typeof runtime.prompt>[1],
          ) {
            yield* applyAntigravityModelAndEffort({
              runtime,
              model: pair.plannerModel,
              effort: pair.plannerEffort,
            });
            yield* applySessionModeIfSupported(runtime, "plan");
            const filter = new HandoffStreamFilter();
            phase = nextPhase;
            activeFilter = filter;
            const response = yield* runtime
              .prompt({ ...payload, prompt: blocks }, phasePromptOptions)
              .pipe(
                Effect.ensuring(
                  Effect.gen(function* () {
                    const flushed = filter.flush();
                    activeFilter = null;
                    phase = "idle";
                    if (flushed.visible) {
                      yield* emitMessageText(flushed.visible);
                    }
                  }),
                ),
              );
            totalUsage = mergeAcpPromptUsage(totalUsage, response.usage);
            const { handoff } = filter.flush();
            return { response, handoff };
          },
        );

        const runExecutor = Effect.fn("AntigravityOrchestratorRuntime.runExecutor")(function* (
          handoffSummary: string,
          isReplanFix: boolean,
        ) {
          const executorName = MODEL_LABELS[pair.executorModel] ?? pair.executorModel;
          const effortName = EFFORT_LABELS[pair.executorEffort] ?? pair.executorEffort;
          yield* emitThought(
            isReplanFix
              ? `\n\nSwitching to Executor (${executorName}, ${effortName}) to apply review fixes…\n`
              : `\n\nSwitching to Executor (${executorName}, ${effortName}) to carry out the plan…\n`,
          );
          yield* applyAntigravityModelAndEffort({
            runtime,
            model: pair.executorModel,
            effort: pair.executorEffort,
          });
          yield* applySessionModeIfSupported(runtime, desiredSessionMode);
          hadEditsOrErrors = false;
          phase = "executor";
          const response = yield* runtime
            .prompt({
              prompt: [
                { type: "text", text: buildExecutorPhasePrompt(handoffSummary, isReplanFix) },
              ],
            })
            .pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  phase = "idle";
                }),
              ),
            );
          totalUsage = mergeAcpPromptUsage(totalUsage, response.usage);
          return response;
        });

        // Phase 1: Planning
        const phase1 = yield* runPlannerOrReview(
          "planner",
          buildPlannerPhasePrompt(payload.prompt, planOnly),
          promptOptions,
        );
        if (
          cancelled ||
          planOnly ||
          phase1.response.stopReason !== "end_turn" ||
          phase1.handoff?.action !== "execute"
        ) {
          yield* applySessionModeIfSupported(runtime, desiredSessionMode);
          return totalUsage ? { ...phase1.response, usage: totalUsage } : phase1.response;
        }

        // Phase 2: Execution
        let lastResponse = yield* runExecutor(phase1.handoff.summary, false);
        if (cancelled || lastResponse.stopReason !== "end_turn" || !hadEditsOrErrors) {
          return totalUsage ? { ...lastResponse, usage: totalUsage } : lastResponse;
        }

        // Phase 3: Smart Review (only after edits or failed commands, max 1 replan cycle)
        for (let cycle = 0; cycle < MAX_REPLAN_CYCLES; cycle++) {
          const plannerName = MODEL_LABELS[pair.plannerModel] ?? pair.plannerModel;
          const effortName = EFFORT_LABELS[pair.plannerEffort] ?? pair.plannerEffort;
          yield* emitThought(
            `\n\nSwitching back to Orchestrator (${plannerName}, ${effortName}) to review the changes…\n`,
          );
          const review = yield* runPlannerOrReview("review", [
            { type: "text", text: buildReviewPhasePrompt() },
          ]);
          lastResponse = review.response;
          if (
            cancelled ||
            review.response.stopReason !== "end_turn" ||
            review.handoff?.action !== "replan"
          ) {
            break;
          }
          lastResponse = yield* runExecutor(review.handoff.summary, true);
          if (cancelled || lastResponse.stopReason !== "end_turn") {
            break;
          }
        }

        yield* applySessionModeIfSupported(runtime, desiredSessionMode);
        return totalUsage ? { ...lastResponse, usage: totalUsage } : lastResponse;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            phase = "idle";
            activeFilter = null;
          }),
        ),
      );
    },
  };

  return { runtime: wrapped, controller };
}
