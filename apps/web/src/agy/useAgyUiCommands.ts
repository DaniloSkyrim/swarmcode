// Fork: runs the Antigravity UI slash commands (`/diff`, `/rename`, `/fork`, ...) by mapping each
// onto an action the app already has. The composer that owns a thread registers its runner so
// the send path can run a typed `/diff` without new props.
import { msg } from "gt-react";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  agyHelpCommandNames,
  parseAgyUiCommand,
  type AgyUiCommandCall,
} from "@t3tools/client-runtime/agyComposerCommands";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  OrchestrationV2Run,
  ProjectId,
  ScopedThreadRef,
} from "@t3tools/contracts";

import { toastManager } from "~/components/ui/toast";
import { useDiffPanelStore } from "~/diffPanelStore";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { m } from "~/i18n/messages";
import { newThreadId } from "~/lib/utils";
import { openCommandPalette } from "~/commandPaletteBus";
import { useRightPanelStore } from "~/rightPanelStore";
import type { TimelineEntry } from "~/session-logic";
import { waitForThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import type { Thread } from "~/types";

type CommandRunner = (text: string) => boolean;
const runnersByThreadKey = new Map<string, CommandRunner>();

/** Runs `text` when it is one of the fork's UI commands for this thread; true when it was. */
export function runAgyUiCommandText(threadKey: string, text: string): boolean {
  return runnersByThreadKey.get(threadKey)?.(text) ?? false;
}

export function useAgyUiCommands(input: {
  readonly environmentId: EnvironmentId;
  readonly routeThreadRef: ScopedThreadRef;
  readonly activeThread: Thread | undefined;
  readonly activeThreadRuns: ReadonlyArray<OrchestrationV2Run>;
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly activeProjectId: ProjectId | null;
  readonly canOperateThread: boolean;
  readonly nativeNames: ReadonlySet<string>;
  readonly onUsageLimitsCommand: (() => void) | undefined;
  readonly openEffortControl: () => void;
}) {
  const { environmentId, routeThreadRef, activeThread, activeThreadRuns, timelineEntries } = input;
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const forkThreadFromRun = useAtomCommand(threadEnvironment.forkFromRun, {
    reportFailure: false,
  });

  const lastAssistantText = (() => {
    for (let index = timelineEntries.length - 1; index >= 0; index -= 1) {
      const entry = timelineEntries[index];
      if (entry?.kind === "message" && entry.message.role === "assistant") {
        const text = entry.message.text.trim();
        if (text.length > 0) return text;
      }
    }
    return null;
  })();
  const lastRun = activeThreadRuns[activeThreadRuns.length - 1];

  const uiAvailable = new Set<string>([
    "settings",
    "keybindings",
    "usage",
    "resume",
    "effort",
    "help",
  ]);
  if (activeThread) {
    uiAvailable.add("diff");
    uiAvailable.add("swarm board");
    if (input.canOperateThread) {
      uiAvailable.add("rename");
      if (lastRun !== undefined) uiAvailable.add("fork");
    }
    if (lastAssistantText !== null) uiAvailable.add("copy");
  }
  if (input.activeProjectId !== null) uiAvailable.add("new");

  const fail = (title: string, error: unknown) => {
    toastManager.add({
      type: "error",
      title,
      description: error instanceof Error ? error.message : m(msg("An error occurred.")),
    });
  };

  const run = async ({ name, argument }: AgyUiCommandCall) => {
    switch (name) {
      case "diff":
        useDiffPanelStore.getState().selectGitScope(routeThreadRef, "branch");
        useRightPanelStore.getState().open(routeThreadRef, "diff");
        return;
      case "swarm board":
        useRightPanelStore.getState().open(routeThreadRef, "swarm");
        return;
      case "settings":
        await navigate({ to: "/settings" });
        return;
      case "keybindings":
        await navigate({ to: "/settings/keybindings" });
        return;
      case "usage":
        if (input.onUsageLimitsCommand) input.onUsageLimitsCommand();
        else await navigate({ to: "/usage" });
        return;
      case "effort":
        input.openEffortControl();
        return;
      case "resume":
        openCommandPalette({ query: "" });
        return;
      case "new":
        if (input.activeProjectId !== null) {
          await handleNewThread(scopeProjectRef(environmentId, input.activeProjectId));
        }
        return;
      case "copy":
        if (lastAssistantText === null) return;
        try {
          await navigator.clipboard.writeText(lastAssistantText);
          toastManager.add({ type: "success", title: m(msg("Copied the last response")) });
        } catch (error) {
          fail(m(msg("Failed to copy the last response")), error);
        }
        return;
      case "help":
        toastManager.add({
          type: "info",
          title: m(msg("Slash commands")),
          description: agyHelpCommandNames(input.nativeNames, uiAvailable).join(" "),
        });
        return;
      case "rename": {
        if (!activeThread) return;
        const result = await updateThreadMetadata({
          environmentId,
          input: { threadId: activeThread.id, title: argument },
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          fail(m(msg("Failed to rename thread")), squashAtomCommandFailure(result));
        }
        return;
      }
      case "fork": {
        if (!activeThread || lastRun === undefined) return;
        const targetThreadId = newThreadId();
        const targetThreadRef = scopeThreadRef(environmentId, targetThreadId);
        const result = await forkThreadFromRun({
          environmentId,
          input: {
            sourceThreadId: activeThread.id,
            targetThreadId,
            runId: lastRun.id,
            title: `${activeThread.title} fork`,
          },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            fail(m(msg("Failed to fork this thread")), squashAtomCommandFailure(result));
          }
          return;
        }
        if (await waitForThreadShell(targetThreadRef)) {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(targetThreadRef),
          });
        }
        return;
      }
      default:
        return;
    }
  };

  const runText = useStableCallback((text: string) => {
    const call = parseAgyUiCommand(text, input.nativeNames, uiAvailable);
    if (call === null) return false;
    void run(call);
    return true;
  });
  const runByName = (name: string) => {
    runText(`/${name}`);
  };

  const threadKey = scopedThreadKey(routeThreadRef);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this composer's runner in a module registry that the send path reads
  useEffect(() => {
    runnersByThreadKey.set(threadKey, runText);
    return () => {
      if (runnersByThreadKey.get(threadKey) === runText) runnersByThreadKey.delete(threadKey);
    };
  }, [threadKey, runText]);

  return { uiAvailable, run: runByName };
}
