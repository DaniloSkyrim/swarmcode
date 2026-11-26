import {
  ANTIGRAVITY_ORCHESTRATOR_MODEL,
  ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/compat";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import {
  HandoffStreamFilter,
  resolveAntigravityOrchestratorRuntimePair,
  wrapAntigravityOrchestratorRuntime,
} from "./AntigravityOrchestratorRuntime.ts";

interface MockStepResult {
  readonly chunks?: ReadonlyArray<string>;
  readonly toolUpdates?: ReadonlyArray<EffectAcpSchema.SessionNotification["update"]>;
  readonly stopReason?: EffectAcpSchema.PromptResponse["stopReason"];
  readonly usage?: EffectAcpSchema.PromptResponse["usage"];
}

function makeMockAcpRuntime(steps: ReadonlyArray<MockStepResult>) {
  const calls: Array<{
    readonly type: "setModel" | "setConfigOption" | "setMode" | "prompt" | "cancel";
    readonly detail: unknown;
  }> = [];
  const emitted: Array<EffectAcpSchema.SessionNotification> = [];
  let currentModel = "gemini-4-neon";
  let currentEffort = "medium";
  let currentMode = "default";
  let stepIndex = 0;
  let updateHandler:
    | ((notification: EffectAcpSchema.SessionNotification) => Effect.Effect<void>)
    | undefined;

  const configOptions = (): ReadonlyArray<EffectAcpSchema.SessionConfigOption> => [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: currentModel,
      options: [
        { value: "gemini-4-neon", name: "Gemini 4 Neon" },
        { value: "gemini-4-carbon", name: "Gemini 4 Carbon" },
        { value: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" },
      ],
    },
    {
      id: "thought_level",
      name: "Thinking Level",
      category: "thought_level",
      type: "select",
      currentValue: currentEffort,
      options:
        currentModel === "gemini-4-carbon"
          ? [
              { value: "low", name: "Low" },
              { value: "medium", name: "Medium" },
              { value: "high", name: "High" },
            ]
          : [
              { value: "low", name: "Low" },
              { value: "medium", name: "Medium" },
              { value: "high", name: "High" },
              { value: "xhigh", name: "Extra" },
            ],
    },
  ];

  const runtime = {
    getConfigOptions: Effect.sync(() => configOptions()),
    getModeState: Effect.sync(() => ({
      currentModeId: currentMode,
      availableModes: [
        { id: "default", name: "Default" },
        { id: "plan", name: "Plan" },
        { id: "auto", name: "Auto" },
      ],
    })),
    setModel: (modelId: string) =>
      Effect.sync(() => {
        currentModel = modelId;
        calls.push({ type: "setModel", detail: modelId });
      }),
    setConfigOption: (configId: string, value: string | boolean) =>
      Effect.sync(() => {
        if (configId === "thought_level" && typeof value === "string") {
          currentEffort = value;
        }
        calls.push({ type: "setConfigOption", detail: { configId, value } });
        return { configOptions: configOptions() };
      }),
    setMode: (modeId: string) =>
      Effect.sync(() => {
        currentMode = modeId;
        calls.push({ type: "setMode", detail: modeId });
        return {};
      }),
    cancel: Effect.sync(() => {
      calls.push({ type: "cancel", detail: true });
    }),
    handleSessionUpdate: (
      handler: (notification: EffectAcpSchema.SessionNotification) => Effect.Effect<void>,
    ) => {
      updateHandler = handler;
      return Effect.void;
    },
    prompt: (payload: Omit<EffectAcpSchema.PromptRequest, "sessionId">) =>
      Effect.gen(function* () {
        calls.push({
          type: "prompt",
          detail: {
            model: currentModel,
            effort: currentEffort,
            mode: currentMode,
            blocks: payload.prompt,
          },
        });
        const step = steps[stepIndex++] ?? {};
        for (const toolUpdate of step.toolUpdates ?? []) {
          if (updateHandler) {
            yield* updateHandler({ sessionId: "session-1", update: toolUpdate });
          }
        }
        for (const chunk of step.chunks ?? []) {
          if (updateHandler) {
            yield* updateHandler({
              sessionId: "session-1",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: chunk },
              },
            });
          }
        }
        return {
          stopReason: step.stopReason ?? "end_turn",
          ...(step.usage ? { usage: step.usage } : {}),
        } satisfies EffectAcpSchema.PromptResponse;
      }),
  } as unknown as AcpSessionRuntime.AcpSessionRuntime["Service"];

  return { runtime, calls, emitted };
}

describe("HandoffStreamFilter", () => {
  it("strips handoff blocks cleanly across single-character chunk boundaries", () => {
    const filter = new HandoffStreamFilter();
    const full =
      'Here is the plan.\n<t3_orchestrator_handoff action="execute">\nEdit foo.ts\n</t3_orchestrator_handoff>\nDone.';
    let visible = "";
    for (const ch of full) {
      visible += filter.push(ch);
    }
    const flushed = filter.flush();
    visible += flushed.visible;

    expect(visible).toBe("Here is the plan.\n\nDone.");
    expect(flushed.handoff).toEqual({ action: "execute", summary: "Edit foo.ts" });
  });

  it("passes normal text through untouched when no handoff tag exists", () => {
    const filter = new HandoffStreamFilter();
    const text = "Regular answer with <tag>html</tag> and no handoff.";
    const visible = filter.push(text) + filter.flush().visible;
    expect(visible).toBe(text);
    expect(filter.flush().handoff).toBeUndefined();
  });
});

describe("AntigravityOrchestratorRuntime", () => {
  it.effect("finishes simple questions in Phase 1 without invoking Executor", () =>
    Effect.gen(function* () {
      const mock = makeMockAcpRuntime([
        {
          chunks: ["Direct answer to your question."],
          usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
        },
      ]);
      const { runtime, controller } = wrapAntigravityOrchestratorRuntime(mock.runtime);
      controller.setPair({
        plannerModel: "gemini-4-neon",
        plannerEffort: "high",
        executorModel: "gemini-4-hydrogen",
        executorEffort: "low",
      });

      const visibleMessages: string[] = [];
      yield* runtime.handleSessionUpdate((notification) =>
        Effect.sync(() => {
          if (
            notification.update.sessionUpdate === "agent_message_chunk" &&
            notification.update.content.type === "text"
          ) {
            visibleMessages.push(notification.update.content.text);
          }
        }),
      );

      const response = yield* runtime.prompt({
        prompt: [{ type: "text", text: "What does this repo do?" }],
      });

      const promptCalls = mock.calls.filter((call) => call.type === "prompt");
      expect(promptCalls).toHaveLength(1);
      expect(promptCalls[0]?.detail).toMatchObject({
        model: "gemini-4-neon",
        effort: "high",
        mode: "plan",
      });
      expect(visibleMessages.join("")).toBe("Direct answer to your question.");
      expect(response.usage).toEqual({ inputTokens: 100, outputTokens: 40, totalTokens: 140 });
    }),
  );

  it.effect(
    "runs Phase 1 -> Phase 2 -> Phase 3 review when Executor edits files and sums usage",
    () =>
      Effect.gen(function* () {
        const mock = makeMockAcpRuntime([
          {
            chunks: [
              "Plan: update utils.ts.\n",
              '<t3_orchestrator_handoff action="execute">Update utils.ts and run tests</t3_orchestrator_handoff>',
            ],
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          },
          {
            toolUpdates: [
              {
                sessionUpdate: "tool_call",
                toolCallId: "tc-1",
                title: "Edit utils.ts",
                kind: "edit",
                status: "completed",
              },
            ],
            chunks: ["Updated utils.ts and tests pass."],
            usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 },
          },
          {
            chunks: ["Verified: changes match the plan."],
            usage: { inputTokens: 90, outputTokens: 30, totalTokens: 120 },
          },
        ]);
        const { runtime, controller } = wrapAntigravityOrchestratorRuntime(mock.runtime);
        controller.setPair({
          plannerModel: "gemini-4-neon",
          plannerEffort: "xhigh",
          executorModel: "gemini-4-hydrogen",
          executorEffort: "low",
        });

        const visibleMessages: string[] = [];
        const thoughts: string[] = [];
        yield* runtime.handleSessionUpdate((notification) =>
          Effect.sync(() => {
            if (
              notification.update.sessionUpdate === "agent_message_chunk" &&
              notification.update.content.type === "text"
            ) {
              visibleMessages.push(notification.update.content.text);
            } else if (
              notification.update.sessionUpdate === "agent_thought_chunk" &&
              notification.update.content.type === "text"
            ) {
              thoughts.push(notification.update.content.text);
            }
          }),
        );

        const response = yield* runtime.prompt({
          prompt: [{ type: "text", text: "Fix bug in utils.ts" }],
        });

        const promptCalls = mock.calls.filter((call) => call.type === "prompt");
        expect(promptCalls).toHaveLength(3);
        expect(promptCalls[0]?.detail).toMatchObject({
          model: "gemini-4-neon",
          effort: "xhigh",
          mode: "plan",
        });
        expect(promptCalls[1]?.detail).toMatchObject({
          model: "gemini-4-hydrogen",
          effort: "low",
          mode: "default",
        });
        expect(promptCalls[2]?.detail).toMatchObject({
          model: "gemini-4-neon",
          effort: "xhigh",
          mode: "plan",
        });
        expect(visibleMessages.join("")).not.toContain("t3_orchestrator_handoff");
        expect(thoughts.some((t) => t.includes("Gemini 4 Hydrogen"))).toBe(true);
        expect(thoughts.some((t) => t.includes("review the changes"))).toBe(true);
        expect(response.usage).toEqual({ inputTokens: 390, outputTokens: 160, totalTokens: 550 });
      }),
  );

  it.effect(
    "skips Phase 3 review when Executor performs only read-only actions with no errors",
    () =>
      Effect.gen(function* () {
        const mock = makeMockAcpRuntime([
          {
            chunks: [
              'Plan.\n<t3_orchestrator_handoff action="execute">Check file</t3_orchestrator_handoff>',
            ],
          },
          {
            toolUpdates: [
              {
                sessionUpdate: "tool_call",
                toolCallId: "tc-read",
                title: "Read config.ts",
                kind: "read",
                status: "completed",
              },
            ],
            chunks: ["Read config.ts, nothing needed changing."],
          },
        ]);
        const { runtime, controller } = wrapAntigravityOrchestratorRuntime(mock.runtime);
        controller.setPair({
          plannerModel: "gemini-4-carbon",
          plannerEffort: "high",
          executorModel: "gemini-4-carbon",
          executorEffort: "medium",
        });

        yield* runtime.handleSessionUpdate(() => Effect.void);
        yield* runtime.prompt({ prompt: [{ type: "text", text: "Check config" }] });

        const promptCalls = mock.calls.filter((call) => call.type === "prompt");
        expect(promptCalls).toHaveLength(2);
      }),
  );

  it.effect("bounds replan cycles to at most 1 follow-up Executor pass", () =>
    Effect.gen(function* () {
      const mock = makeMockAcpRuntime([
        {
          chunks: ['<t3_orchestrator_handoff action="execute">Implement</t3_orchestrator_handoff>'],
        },
        {
          toolUpdates: [
            {
              sessionUpdate: "tool_call",
              toolCallId: "tc-1",
              title: "Edit a.ts",
              kind: "edit",
              status: "completed",
            },
          ],
          chunks: ["Edited a.ts"],
        },
        {
          chunks: [
            'Needs fix\n<t3_orchestrator_handoff action="replan">Fix typo</t3_orchestrator_handoff>',
          ],
        },
        {
          chunks: ["Fixed typo."],
        },
      ]);
      const { runtime, controller } = wrapAntigravityOrchestratorRuntime(mock.runtime);
      controller.setPair({
        plannerModel: "gemini-4-neon",
        plannerEffort: "medium",
        executorModel: "gemini-4-hydrogen",
        executorEffort: "medium",
      });

      yield* runtime.handleSessionUpdate(() => Effect.void);
      yield* runtime.prompt({ prompt: [{ type: "text", text: "Implement feature" }] });

      const promptCalls = mock.calls.filter((call) => call.type === "prompt");
      expect(promptCalls).toHaveLength(4);
      expect(promptCalls[3]?.detail).toMatchObject({ model: "gemini-4-hydrogen", mode: "default" });
    }),
  );

  it.effect("never triggers Executor when planOnly is enabled", () =>
    Effect.gen(function* () {
      const mock = makeMockAcpRuntime([
        {
          chunks: [
            'Plan\n<t3_orchestrator_handoff action="execute">Do it</t3_orchestrator_handoff>',
          ],
        },
      ]);
      const { runtime, controller } = wrapAntigravityOrchestratorRuntime(mock.runtime, {
        initialPlanOnly: true,
      });
      controller.setPair({
        plannerModel: "gemini-4-neon",
        plannerEffort: "medium",
        executorModel: "gemini-4-hydrogen",
        executorEffort: "medium",
      });

      yield* runtime.handleSessionUpdate(() => Effect.void);
      yield* runtime.prompt({ prompt: [{ type: "text", text: "Plan only" }] });

      const promptCalls = mock.calls.filter((call) => call.type === "prompt");
      expect(promptCalls).toHaveLength(1);
    }),
  );

  it.effect("resolves runtime pair and clamps Carbon xhigh to high", () =>
    Effect.gen(function* () {
      const mock = makeMockAcpRuntime([]);
      const configOptions = yield* mock.runtime.getConfigOptions;
      const pair = yield* resolveAntigravityOrchestratorRuntimePair({
        configOptions,
        modelSelection: {
          instanceId: ProviderInstanceId.make("antigravity"),
          model: ANTIGRAVITY_ORCHESTRATOR_MODEL,
          options: [
            { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerModel, value: "gemini-4-carbon" },
            { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerEffort, value: "xhigh" },
            { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorModel, value: "gemini-4-neon" },
            { id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorEffort, value: "xhigh" },
          ],
        },
      });
      expect(pair).toEqual({
        plannerModel: "gemini-4-carbon",
        plannerEffort: "high",
        executorModel: "gemini-4-neon",
        executorEffort: "xhigh",
      });
    }),
  );
});
