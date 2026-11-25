// Fork: dialog for adding a worker directly from the swarm board UI.
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AgySwarmSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import { useId, useState } from "react";

import { agySwarmEnvironment } from "~/state/agySwarm";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogAction,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { parseDelimitedList } from "./swarmBoard.logic";

const VALID_MEMBER_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/u;

export function SwarmAddWorkerDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly swarm: AgySwarmSnapshot;
  readonly threadRef: ScopedThreadRef;
}) {
  const gt = useGT();
  const m = useMessages();
  const idBase = useId();
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [workspace, setWorkspace] = useState<"inherit" | "worktree">("inherit");
  const [model, setModel] = useState("");
  const [ownsRaw, setOwnsRaw] = useState("");
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const addWorker = useOrchestrationCommand(agySwarmEnvironment.add, {
    label: "add swarm worker",
  });

  const normalizedName = name.trim().toLowerCase();
  const nameInvalid = normalizedName.length > 0 && !VALID_MEMBER_NAME.test(normalizedName);
  const nameTaken =
    normalizedName.length > 0 &&
    props.swarm.members.some((member) => member.name === normalizedName);
  const canSubmit =
    !pending && normalizedName.length > 0 && !nameInvalid && !nameTaken && brief.trim().length > 0;

  const resetForm = () => {
    setName("");
    setBrief("");
    setWorkspace("inherit");
    setModel("");
    setOwnsRaw("");
    setSubmitError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !pending) {
      setSubmitError(null);
    }
    props.onOpenChange(nextOpen);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setSubmitError(null);
    const owns = parseDelimitedList(ownsRaw);
    const trimmedModel = model.trim();
    const result = await addWorker({
      environmentId: props.threadRef.environmentId,
      input: {
        threadId: props.threadRef.threadId,
        name: normalizedName,
        brief: brief.trim(),
        workspace,
        ...(trimmedModel ? { model: trimmedModel } : {}),
        ...(owns.length > 0 ? { owns } : {}),
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      setSubmitError(
        thrownErrorMessage(squashAtomCommandFailure(result), m) ??
          gt("Could not add worker. Try again."),
      );
      return;
    }
    toastManager.add({
      type: "success",
      title: gt("Added @{name}", { name: normalizedName }),
      description: result.value.message,
    });
    resetForm();
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            <T>Add worker</T>
          </DialogTitle>
          <DialogDescription>
            <T>Spawn a new member on this swarm board with its own brief.</T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idBase}-name`} className="text-xs font-medium text-foreground">
                <T>Name</T>
              </label>
              <Input
                id={`${idBase}-name`}
                value={name}
                placeholder={gt("e.g. reviewer, api-fix")}
                disabled={pending}
                aria-invalid={nameInvalid || nameTaken || undefined}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              {nameInvalid ? (
                <p className="text-xs text-destructive-foreground">
                  <T>Use lowercase letters, digits, hyphens, or underscores.</T>
                </p>
              ) : nameTaken ? (
                <p className="text-xs text-destructive-foreground">
                  <T>A member with that name already exists.</T>
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${idBase}-brief`} className="text-xs font-medium text-foreground">
                <T>Brief</T>
              </label>
              <Textarea
                id={`${idBase}-brief`}
                rows={3}
                value={brief}
                disabled={pending}
                placeholder={gt("What this worker owns and what done looks like")}
                onChange={(event) => setBrief(event.currentTarget.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                <T>Workspace</T>
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant={workspace === "inherit" ? "default" : "outline"}
                  aria-pressed={workspace === "inherit"}
                  disabled={pending}
                  onClick={() => setWorkspace("inherit")}
                >
                  <T>Shared workspace</T>
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={workspace === "worktree" ? "default" : "outline"}
                  aria-pressed={workspace === "worktree"}
                  disabled={pending}
                  onClick={() => setWorkspace("worktree")}
                >
                  <T>Isolated worktree</T>
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${idBase}-model`} className="text-xs font-medium text-foreground">
                  <T>Model (optional)</T>
                </label>
                <Input
                  id={`${idBase}-model`}
                  size="sm"
                  value={model}
                  disabled={pending}
                  placeholder={gt("Inherit coordinator")}
                  onChange={(event) => setModel(event.currentTarget.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${idBase}-owns`} className="text-xs font-medium text-foreground">
                  <T>Owned paths (optional)</T>
                </label>
                <Input
                  id={`${idBase}-owns`}
                  size="sm"
                  value={ownsRaw}
                  disabled={pending}
                  placeholder={gt("src/api/, tests/")}
                  onChange={(event) => setOwnsRaw(event.currentTarget.value)}
                />
              </div>
            </div>
            {submitError ? (
              <p role="alert" className="text-xs text-destructive-foreground">
                {submitError}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={pending} />}>
            <T>Cancel</T>
          </DialogClose>
          <DialogAction disabled={!canSubmit} onClick={() => void handleSubmit()}>
            {pending ? <T>Adding…</T> : <T>Add worker</T>}
          </DialogAction>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
