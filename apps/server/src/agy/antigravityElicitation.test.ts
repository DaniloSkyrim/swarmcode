import { ProviderInstanceId } from "@t3tools/contracts";
import type { AcpAdapterV2Flavor } from "@t3tools/provider-acp/server/adapter";
import { PULL_REQUEST_LINKING_INSTRUCTIONS } from "@t3tools/provider-core/server/runtimeInstructions";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import { makeAntigravityAcpAdapterFlavor } from "../orchestration-v2/Adapters/AntigravityAdapterV2.ts";
import {
  ANTIGRAVITY_ASK_QUESTION_INSTRUCTIONS,
  appendAntigravitySessionInstructions,
  extractAntigravityElicitationForm,
  parseAntigravityQuestionOption,
} from "./antigravityElicitation.ts";

type ElicitationRequest = Parameters<NonNullable<AcpAdapterV2Flavor["extractElicitationForm"]>>[0];

const request = (
  properties: Record<string, unknown>,
  options: { readonly message?: string; readonly required?: ReadonlyArray<string> } = {},
): ElicitationRequest =>
  ({
    mode: "form",
    sessionId: "session-1",
    message: options.message ?? "The agent has a question.",
    requestedSchema: {
      type: "object",
      properties,
      ...(options.required !== undefined ? { required: options.required } : {}),
    },
  }) as ElicitationRequest;

const singleQuestion = {
  type: "string",
  title:
    'In Sidebar.tsx and threadInbox.ts, threads waiting on another thread (blockedOnThreadWait) already stay under the existing "Working" separator. Where should an idle swarm coordinator thread go while its swarm is active?',
  oneOf: [
    {
      const: "1",
      title:
        "Working (Recommended) — Put them in the existing Working section, matching blockedOnThreadWait and background tasks.",
    },
    {
      const: "2",
      title: "Separate Swarm section — Add a dedicated Swarm separator/section in the sidebar.",
    },
    {
      const: "3",
      title:
        "Keep in Active — No Working section move, only show a swarm status indicator on the row.",
    },
  ],
};

const singleCompanion = {
  type: "string",
  title: "Other",
  description: `Optional free-form answer to: ${singleQuestion.title}`,
};

const multiQuestion = {
  type: "array",
  title: "Which surfaces should show the swarm badge?",
  items: {
    anyOf: [
      { const: "1", title: "Sidebar — Show next to the thread title" },
      { const: "2", title: "Header — Show in the chat header bar" },
      { const: "3", title: "Command palette — Show in search results" },
    ],
  },
};

const multiCompanion = {
  type: "string",
  title: "Other",
  description: "Optional free-form answer to: Which surfaces should show the swarm badge?",
};

const attachment = '\n\nAttached image "shot.png": "/tmp/shot.png"';

describe("parseAntigravityQuestionOption", () => {
  it("keeps an explicit ACP description over separator parsing", () => {
    expect(
      parseAntigravityQuestionOption({
        title: "Working — extra",
        description: "Explicit ACP description",
      }),
    ).toEqual({
      label: "Working — extra",
      description: "Explicit ACP description",
    });
  });

  it.each([
    [
      "em-dash",
      "Working (Recommended) — Entra no separador Working que já existe.",
      "Working (Recommended)",
      "Entra no separador Working que já existe.",
    ],
    [
      "en-dash",
      "Separate Swarm – Add a dedicated Swarm section.",
      "Separate Swarm",
      "Add a dedicated Swarm section.",
    ],
    [
      "spaced hyphen",
      "Keep in Active - Only show a swarm indicator on the row.",
      "Keep in Active",
      "Only show a swarm indicator on the row.",
    ],
    [
      "colon",
      "Keep in Active: Only show a swarm indicator on the row.",
      "Keep in Active",
      "Only show a swarm indicator on the row.",
    ],
    [
      "newline",
      "Working (Recommended)\nPut them in the existing Working section.",
      "Working (Recommended)",
      "Put them in the existing Working section.",
    ],
    [
      "em-dash takes precedence over an earlier colon",
      "Option 1: Fast — Uses caching for speed.",
      "Option 1: Fast",
      "Uses caching for speed.",
    ],
    [
      "leading (Recommended) before em-dash",
      "(Recommended) Working — Reuse the existing Working section.",
      "(Recommended) Working",
      "Reuse the existing Working section.",
    ],
  ])("splits %s into label and description", (_, title, label, description) => {
    expect(parseAntigravityQuestionOption({ title })).toEqual({ label, description });
  });

  it.each([
    '(Recommended) "Swarming" in teal (text-teal-700 dark:text-teal-300) with NetworkIcon and elapsed timer',
    "Option A (fast - low memory)",
    "Use https://example.com:8080 for API calls",
    "Add a separate Swarm separator/section in the sidebar",
  ])("does not split plain option text: %s", (title) => {
    expect(parseAntigravityQuestionOption({ title })).toEqual({
      label: title,
      description: title,
    });
  });
});

describe("extractAntigravityElicitationForm", () => {
  it("puts the question text in the body, envelope message in header, folds q1_other, and splits option descriptions", () => {
    const form = extractAntigravityElicitationForm(
      request({ q1: singleQuestion, q1_other: singleCompanion }),
    );

    expect(form?.questions).toEqual([
      {
        id: "q1",
        header: "The agent has a question.",
        question: singleQuestion.title,
        options: [
          {
            label: "Working (Recommended)",
            description:
              "Put them in the existing Working section, matching blockedOnThreadWait and background tasks.",
            value: "1",
          },
          {
            label: "Separate Swarm section",
            description: "Add a dedicated Swarm separator/section in the sidebar.",
            value: "2",
          },
          {
            label: "Keep in Active",
            description: "No Working section move, only show a swarm status indicator on the row.",
            value: "3",
          },
        ],
      },
    ]);
    expect(form?.respond({ q1: "1" })).toEqual({
      action: "accept",
      content: { q1: "1" },
    });
  });

  it("sends custom answers and attachment suffixes to qN_other", () => {
    const form = extractAntigravityElicitationForm(
      request({ q1: singleQuestion, q1_other: singleCompanion }),
    );

    expect(form?.respond({ q1: "Move only while a worker is active" })).toEqual({
      action: "accept",
      content: { q1_other: "Move only while a worker is active" },
    });
    expect(form?.respond({ q1: `2${attachment}` })).toEqual({
      action: "accept",
      content: {
        q1: "2",
        q1_other: `Separate Swarm section — Add a dedicated Swarm separator/section in the sidebar.${attachment}`,
      },
    });
    expect(form?.respond({})).toEqual({ action: "cancel" });
    expect(form?.respond({ q1: "   " })).toEqual({ action: "cancel" });
    expect(form?.respond({ q1: ["1"] })).toEqual({ action: "cancel" });
  });

  it("numbers headers for multi-question forms and folds each companion", () => {
    const form = extractAntigravityElicitationForm(
      request(
        {
          q1: singleQuestion,
          q1_other: singleCompanion,
          q2: {
            type: "string",
            title: "Should the indicator animate?",
            oneOf: [
              { const: "1", title: "Static — No animation" },
              { const: "2", title: "Pulse — Subtle pulse while running" },
            ],
          },
          q2_other: {
            type: "string",
            title: "Other",
            description: "Optional free-form answer to: Should the indicator animate?",
          },
        },
        { message: "The agent has questions." },
      ),
    );

    expect(form?.questions.map((question) => question.header)).toEqual([
      "Question 1",
      "Question 2",
    ]);
    expect(form?.respond({ q1: "2", q2: "Only on hover" })).toEqual({
      action: "accept",
      content: { q1: "2", q2_other: "Only on hover" },
    });
  });

  it("handles multi-select array questions with q1_other folded", () => {
    const form = extractAntigravityElicitationForm(
      request(
        {
          q1: { ...multiQuestion, minItems: 1 },
          q1_other: multiCompanion,
        },
        { required: ["q1"] },
      ),
    );

    expect(form?.questions).toEqual([
      {
        id: "q1",
        header: "The agent has a question.",
        question: "Which surfaces should show the swarm badge?",
        multiSelect: true,
        required: true,
        options: [
          { label: "Sidebar", description: "Show next to the thread title", value: "1" },
          { label: "Header", description: "Show in the chat header bar", value: "2" },
          { label: "Command palette", description: "Show in search results", value: "3" },
        ],
      },
    ]);
    expect(form?.respond({ q1: ["1", "3"] })).toEqual({
      action: "accept",
      content: { q1: ["1", "3"] },
    });
    expect(form?.respond({ q1: ["1", 'Attached image "shot.png": "/tmp/shot.png"'] })).toEqual({
      action: "accept",
      content: { q1: ["1"], q1_other: 'Attached image "shot.png": "/tmp/shot.png"' },
    });
    expect(form?.respond({ q1: "Everywhere except mobile" })).toEqual({
      action: "accept",
      content: { q1_other: "Everywhere except mobile" },
    });
    expect(form?.respond({ q1: [] })).toEqual({ action: "cancel" });
  });

  it.each([
    ["a form without companions", { q1: singleQuestion }],
    [
      "an unrelated extra field",
      { q1: singleQuestion, q1_other: singleCompanion, extra: { type: "string" } },
    ],
    ["an orphan companion", { q1_other: singleCompanion }],
    ["a text-only question", { q1: { type: "string", title: "Notes" }, q1_other: singleCompanion }],
    ["an empty choice list", { q1: { ...singleQuestion, oneOf: [] }, q1_other: singleCompanion }],
  ])("leaves %s to generic elicitation parsing", (_, properties) => {
    expect(extractAntigravityElicitationForm(request(properties))).toBeUndefined();
  });

  it("wires into AntigravityAdapterV2 flavor and preserves PR linking instructions", () => {
    const flavor = makeAntigravityAcpAdapterFlavor({
      instanceId: ProviderInstanceId.make("antigravity-test"),
      random: undefined as never,
      fileSystem: undefined as never,
      path: undefined as never,
      host: undefined as never,
      selfInvocation: undefined as never,
      makeRuntime: () => Effect.die("not spawned in this test"),
      withProcess: (_stop, task) => task,
      defaultModel: Effect.undefined,
    });
    expect(flavor.extractElicitationForm).toBe(extractAntigravityElicitationForm);
    const appended = appendAntigravitySessionInstructions(PULL_REQUEST_LINKING_INSTRUCTIONS);
    expect(appended).toContain(PULL_REQUEST_LINKING_INSTRUCTIONS);
    expect(appended).toContain(ANTIGRAVITY_ASK_QUESTION_INSTRUCTIONS);
  });
});
