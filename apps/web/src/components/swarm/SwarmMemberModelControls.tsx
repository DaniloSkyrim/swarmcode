// Fork: the model and effort pickers for one swarm member, writing to that member's thread.
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type ModelSelection,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  createModelSelection,
  modelSelectionsEqual,
  pickModelSelection,
} from "@t3tools/shared/model";
import { useGT, useMessages } from "gt-react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { providerInstanceEntriesFor } from "~/providerInstances";
import { useQuietThreadShell } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { EMPTY_SERVER_PROVIDERS } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { toastManager } from "../ui/toast";

/**
 * Applies to the member's next turn. Moving it to another provider is refused while it works,
 * as for any thread, and says so in a toast.
 */
export function SwarmMemberModelControls(props: {
  readonly threadRef: ScopedThreadRef;
  readonly memberName: string;
  readonly fallbackModel: string | null;
}) {
  const gt = useGT();
  const m = useMessages();
  const shell = useQuietThreadShell(props.threadRef);
  const canOperate = useEnvironmentScope(
    props.threadRef.environmentId,
    AuthOrchestrationOperateScope,
  );
  const settings = useEnvironmentSettings(props.threadRef.environmentId);
  const providers =
    useEnvironmentProviders().get(props.threadRef.environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const setModelSelection = useOrchestrationCommand(threadEnvironment.setModelSelection, {
    label: "change model",
  });
  if (shell === null) {
    return props.fallbackModel ? (
      <span className="block truncate font-mono text-xs text-muted-foreground">
        {props.fallbackModel}
      </span>
    ) : null;
  }
  const selection = shell.modelSelection;
  const entries = providerInstanceEntriesFor(providers, settings, shell.projectId);
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection.instanceId,
    selection.model,
  );
  const activeEntry = entries.find((entry) => entry.instanceId === selection.instanceId);
  const isBusy =
    threadRuntimeIsActive(shell.runtime) || (shell.runtime?.activeRunId ?? null) !== null;

  const apply = async (next: ModelSelection) => {
    if (!canOperate || modelSelectionsEqual(next, selection)) return;
    // The server refuses a provider switch mid-turn with a message naming the thread id.
    if (next.instanceId !== selection.instanceId && isBusy) {
      toastManager.add({
        type: "info",
        title: gt("{member} is working", { member: props.memberName }),
        description: gt(
          "Switch its provider after this turn ends. A model from the same provider can change now.",
        ),
      });
      return;
    }
    const result = await setModelSelection({
      environmentId: props.threadRef.environmentId,
      input: { threadId: props.threadRef.threadId, modelSelection: next },
    });
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    toastManager.add({
      type: "error",
      title: gt("Could not change this member's model"),
      description: thrownErrorMessage(squashAtomCommandFailure(result), m) ?? gt("Try again."),
    });
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <ProviderModelPicker
        environmentId={props.threadRef.environmentId}
        activeInstanceId={selection.instanceId}
        model={selection.model}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={modelOptions}
        size="xs"
        compact
        disabled={!canOperate}
        triggerClassName="max-w-[min(10.5rem,100%)] shrink"
        triggerAriaLabel={gt("Model for {member}", { member: props.memberName })}
        onInstanceModelChange={(instanceId, model) =>
          void apply(pickModelSelection(selection, instanceId, model))
        }
      />
      {activeEntry ? (
        <TraitsPicker
          size="xs"
          disabled={!canOperate}
          provider={activeEntry.driverKind}
          instanceId={selection.instanceId}
          models={activeEntry.models}
          model={selection.model}
          modelOptions={selection.options ?? []}
          allowPromptInjectedEffort={false}
          triggerClassName="max-w-full"
          onModelOptionsChange={(options) =>
            void apply(createModelSelection(selection.instanceId, selection.model, options))
          }
        />
      ) : null}
    </div>
  );
}
