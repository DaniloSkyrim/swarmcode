import {
  ANTIGRAVITY_ORCHESTRATOR_MODEL,
  ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ComposerEffortColumn, describeComposerEffort } from "./ComposerModelEffort";
import { ProviderModelPicker } from "./ProviderModelPicker";
import type { TraitsSelectionInput } from "./TraitsPicker";

const ANTIGRAVITY_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gemini-4-neon",
    name: "Gemini 4 Neon",
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        {
          id: "thought_level",
          label: "Thinking Level",
          type: "select",
          role: "reasoning",
          currentValue: "medium",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
            { id: "xhigh", label: "Extra" },
          ],
        },
      ],
    },
  },
  {
    slug: "gemini-4-carbon",
    name: "Gemini 4 Carbon",
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        {
          id: "thought_level",
          label: "Thinking Level",
          type: "select",
          role: "reasoning",
          currentValue: "medium",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
        },
      ],
    },
  },
  {
    slug: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen",
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        {
          id: "thought_level",
          label: "Thinking Level",
          type: "select",
          role: "reasoning",
          currentValue: "medium",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
            { id: "xhigh", label: "Extra" },
          ],
        },
      ],
    },
  },
  {
    slug: ANTIGRAVITY_ORCHESTRATOR_MODEL,
    name: "Orchestrator",
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        {
          id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerModel,
          label: "Orchestrator Model",
          type: "select",
          currentValue: "gemini-4-neon",
          options: [
            { id: "gemini-4-neon", label: "Gemini 4 Neon" },
            { id: "gemini-4-carbon", label: "Gemini 4 Carbon" },
          ],
        },
        {
          id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.plannerEffort,
          label: "Orchestrator Thinking Level",
          type: "select",
          role: "reasoning",
          currentValue: "medium",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
            { id: "xhigh", label: "Extra" },
          ],
        },
        {
          id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorModel,
          label: "Executor Model",
          type: "select",
          currentValue: "gemini-4-hydrogen",
          options: [
            { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen" },
            { id: "gemini-4-carbon", label: "Gemini 4 Carbon" },
            { id: "gemini-4-neon", label: "Gemini 4 Neon" },
          ],
        },
        {
          id: ANTIGRAVITY_ORCHESTRATOR_OPTION_IDS.executorEffort,
          label: "Executor Thinking Level",
          type: "select",
          role: "reasoning",
          currentValue: "medium",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
            { id: "xhigh", label: "Extra" },
          ],
        },
      ],
    },
  },
];

function createEntries() {
  const agyId = ProviderInstanceId.make("antigravity");
  const codexId = ProviderInstanceId.make("codex");
  const entries = deriveProviderInstanceEntries([
    {
      instanceId: agyId,
      driver: ProviderDriverKind.make("antigravity"),
      displayName: "Antigravity",
      enabled: true,
      installed: true,
      version: "1.5.17",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: ANTIGRAVITY_MODELS,
      slashCommands: [],
      skills: [],
    },
    {
      instanceId: codexId,
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [{ slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, capabilities: {} }],
      slashCommands: [],
      skills: [],
    },
  ]);
  return { agyId, codexId, entries };
}

describe("Antigravity Orchestrator model picker UX", () => {
  it("separates Orchestrator below standard AGY models, supports 1-click Default, 2-step guided flow, and dual thinking levels", async () => {
    const { agyId, entries } = createEntries();
    const modelOptionsByInstance = new Map(
      entries.map((entry) => [entry.instanceId, entry.models]),
    );

    function Harness() {
      const [selection, setSelection] = useState<ModelSelection>({
        instanceId: agyId,
        model: "gemini-4-neon",
      });
      const activeEntry =
        entries.find((entry) => entry.instanceId === selection.instanceId) ?? entries[0]!;
      const traits: TraitsSelectionInput = {
        provider: activeEntry.driverKind,
        instanceId: selection.instanceId,
        models: activeEntry.models,
        model: selection.model,
        modelOptions: selection.options,
        onModelOptionsChange: (nextOptions) =>
          setSelection((prev) => ({
            ...prev,
            ...(nextOptions ? { options: nextOptions } : {}),
          })),
      };
      const effort = describeComposerEffort(traits, "label", "sm");

      return (
        <ProviderModelPicker
          environmentId={null}
          activeInstanceId={selection.instanceId}
          model={selection.model}
          activeModelOptions={selection.options ?? null}
          lockedProvider={null}
          instanceEntries={entries}
          modelOptionsByInstance={modelOptionsByInstance}
          triggerSuffix={effort.suffix}
          triggerDetail={effort.detail}
          effortColumn={<ComposerEffortColumn traits={traits} />}
          onInstanceModelChange={(instanceId, model, modelOptions) =>
            setSelection({
              instanceId,
              model,
              ...(modelOptions ? { options: modelOptions } : {}),
            })
          }
        />
      );
    }

    await using screen = await render(<Harness />);
    const trigger = screen.container.querySelector<HTMLButtonElement>(
      "[data-chat-provider-model-picker]",
    )!;
    await userEvent.click(trigger);

    // Antigravity tab shows standard models above a divider and Orchestrator pinned below
    await expect.element(page.getByRole("option", { name: /Gemini 4 Neon/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /Gemini 4 Carbon/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /Gemini 4 Hydrogen/ })).toBeVisible();
    expect(document.querySelector("[data-antigravity-orchestrator-trigger]")).not.toBeNull();

    // Switching to Codex tab must NOT show the Antigravity Orchestrator section
    await userEvent.click(page.getByRole("button", { name: "Codex", exact: true }));
    await expect.element(page.getByRole("option", { name: /GPT-5.4/ })).toBeVisible();
    expect(document.querySelector("[data-antigravity-orchestrator-trigger]")).toBeNull();

    // Back to Antigravity tab: 1-click "Default" selects Neon -> Hydrogen with defaults
    await userEvent.click(page.getByRole("button", { name: "Antigravity", exact: true }));
    const quickDefault = document.querySelector<HTMLButtonElement>(
      "[data-antigravity-orchestrator-use-default]",
    );
    expect(quickDefault).not.toBeNull();
    await userEvent.click(quickDefault!);

    await expect
      .element(
        screen.container.querySelector<HTMLElement>("[data-chat-provider-model-picker-label]")!,
      )
      .toHaveTextContent("Orchestrator · Neon → Hydrogen");

    // Clicking the Orchestrator row enters 2-step guided flow (Step 1/2: Choose Orchestrator)
    const orchestratorRow = document.querySelector<HTMLButtonElement>(
      "[data-antigravity-orchestrator-trigger]",
    );
    expect(orchestratorRow).not.toBeNull();
    await userEvent.click(orchestratorRow!);

    await expect.element(page.getByText("1/2")).toBeVisible();
    await expect.element(page.getByText("Choose Orchestrator")).toBeVisible();
    expect(document.querySelector('[data-orchestrator-option="gemini-4-neon"]')).not.toBeNull();
    expect(document.querySelector('[data-orchestrator-option="gemini-4-carbon"]')).not.toBeNull();
    expect(document.querySelector('[data-orchestrator-option="gemini-4-hydrogen"]')).toBeNull();

    // Step 1 -> pick Carbon -> advances to Step 2/2: Choose Executor
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-orchestrator-option="gemini-4-carbon"]')!,
    );
    await expect.element(page.getByText("2/2")).toBeVisible();
    await expect.element(page.getByText("Choose Executor")).toBeVisible();
    expect(document.querySelector('[data-orchestrator-option="gemini-4-hydrogen"]')).not.toBeNull();
    expect(document.querySelector('[data-orchestrator-option="gemini-4-carbon"]')).not.toBeNull();
    expect(document.querySelector('[data-orchestrator-option="gemini-4-neon"]')).not.toBeNull();

    // Step 2 -> pick Neon as Executor
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-orchestrator-option="gemini-4-neon"]')!,
    );

    await expect
      .element(
        screen.container.querySelector<HTMLElement>("[data-chat-provider-model-picker-label]")!,
      )
      .toHaveTextContent("Orchestrator · Carbon → Neon");

    // Dual thinking level radiogroups appear in the effort column
    const plannerGroup = page.getByRole("radiogroup", { name: "Orchestrator thinking level" });
    const executorGroup = page.getByRole("radiogroup", { name: "Executor thinking level" });
    await expect.element(plannerGroup).toBeVisible();
    await expect.element(executorGroup).toBeVisible();

    // Carbon planner has no Extra option; Neon executor DOES have Extra
    await expect
      .element(plannerGroup.getByRole("radio", { name: "Extra" }))
      .not.toBeInTheDocument();
    await expect.element(executorGroup.getByRole("radio", { name: "Extra" })).toBeVisible();

    await userEvent.click(plannerGroup.getByRole("radio", { name: "High" }));
    await userEvent.click(executorGroup.getByRole("radio", { name: "Low" }));

    await expect
      .element(screen.container.querySelector<HTMLElement>("[data-composer-control-label]")!)
      .toHaveTextContent("High / Low");
  });
});
