import {
  DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { AntigravityOrchestratorSettingsSection } from "./AntigravityOrchestratorSettingsSection";

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
];

describe("AntigravityOrchestratorSettingsSection", () => {
  it("renders allowed planner and executor models, preserves unrelated config, and clamps Carbon thinking level", async () => {
    const onChange = vi.fn();
    function Harness() {
      const [config, setConfig] = useState<Record<string, unknown> | undefined>({
        binaryPath: "/custom/agy",
        orchestrator: {
          ...DEFAULT_ANTIGRAVITY_ORCHESTRATOR_SETTINGS,
          plannerModel: "gemini-4-neon",
          plannerEffort: "xhigh",
          executorModel: "gemini-4-hydrogen",
          executorEffort: "medium",
        },
      });
      return (
        <AntigravityOrchestratorSettingsSection
          instanceId="antigravity"
          config={config}
          liveModels={ANTIGRAVITY_MODELS}
          onChange={(next) => {
            onChange(next);
            setConfig(next);
          }}
        />
      );
    }

    await using screen = await render(<Harness />);
    await expect.element(screen.getByText("Orchestrator Settings")).toBeVisible();
    await expect
      .element(screen.getByRole("combobox", { name: "Orchestrator Model" }))
      .toHaveTextContent("Gemini 4 Neon");
    await expect
      .element(screen.getByRole("combobox", { name: "Orchestrator thinking level" }))
      .toHaveTextContent("Extra");
    await expect
      .element(screen.getByRole("combobox", { name: "Executor Model" }))
      .toHaveTextContent("Gemini 4 Hydrogen");

    // Planner list only includes Neon and Carbon (never Hydrogen)
    await userEvent.click(screen.getByRole("combobox", { name: "Orchestrator Model" }));
    await expect.element(page.getByRole("option", { name: /Gemini 4 Neon/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /Gemini 4 Carbon/ })).toBeVisible();
    await expect
      .element(page.getByRole("option", { name: /Gemini 4 Hydrogen/ }))
      .not.toBeInTheDocument();

    // Switching planner from Neon (Extra) -> Carbon clamps plannerEffort xhigh -> high
    await userEvent.click(page.getByRole("option", { name: /Gemini 4 Carbon/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      binaryPath: "/custom/agy",
      orchestrator: {
        plannerModel: "gemini-4-carbon",
        plannerEffort: "high",
        executorModel: "gemini-4-hydrogen",
        executorEffort: "medium",
      },
    });
    await expect
      .element(screen.getByRole("combobox", { name: "Orchestrator thinking level" }))
      .toHaveTextContent("High");

    // Carbon planner thinking levels omit Extra
    await userEvent.click(screen.getByRole("combobox", { name: "Orchestrator thinking level" }));
    await expect.element(page.getByRole("option", { name: "Low", exact: true })).toBeVisible();
    await expect.element(page.getByRole("option", { name: "Medium", exact: true })).toBeVisible();
    await expect.element(page.getByRole("option", { name: "High", exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("option", { name: "Extra", exact: true }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    // Executor list includes Hydrogen, Carbon, and Neon
    await userEvent.click(screen.getByRole("combobox", { name: "Executor Model" }));
    await expect.element(page.getByRole("option", { name: /Gemini 4 Hydrogen/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /Gemini 4 Carbon/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /Gemini 4 Neon/ })).toBeVisible();
    await userEvent.click(page.getByRole("option", { name: /Gemini 4 Neon/ }));

    expect(onChange).toHaveBeenLastCalledWith({
      binaryPath: "/custom/agy",
      orchestrator: {
        plannerModel: "gemini-4-carbon",
        plannerEffort: "high",
        executorModel: "gemini-4-neon",
        executorEffort: "medium",
      },
    });
  });
});
