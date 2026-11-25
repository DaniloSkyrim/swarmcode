import { useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AgySwarmMember, AgySwarmSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { sideThreadOpenIntentOf } from "@t3tools/client-runtime/side-thread";
import {
  FileTextIcon,
  FolderIcon,
  GitBranchIcon,
  PlayIcon,
  RotateCwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { T, useGT, useMessages, Var } from "gt-react";
import { type ReactNode, useState } from "react";

import { openSideThread } from "~/lib/sideChatPane";
import { cn, isMacPlatform } from "~/lib/utils";
import { agySwarmEnvironment } from "~/state/agySwarm";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Empty, EmptyHeader, EmptyTitle } from "../ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MEMBER_STATE_TEXT, SwarmAvatar, SwarmStateDot, useMemberStateLabel } from "./SwarmAvatar";
import { SwarmMemberModelControls } from "./SwarmMemberModelControls";
import {
  formatTokenCount,
  groupMembers,
  isDirtyWorktreeKillError,
  memberBee,
  memberCue,
  memberSnippet,
  type BeeColors,
  type BeeCue,
} from "./swarmBoard.logic";

function MemberMetaRow(props: { member: AgySwarmMember }) {
  const gt = useGT();
  const { member } = props;
  const branchLabel = member.branch ?? (member.workspace === "worktree" ? gt("worktree") : null);
  const owns = member.owns ?? [];
  const metrics = member.metrics;
  const hasMetrics = metrics !== undefined && (metrics.turns > 0 || metrics.totalTokens > 0);
  if (!branchLabel && owns.length === 0 && !hasMetrics && !member.scratchDir) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground/85">
      {branchLabel ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex max-w-[12rem] items-center gap-1 truncate font-mono" />
            }
          >
            <GitBranchIcon aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{branchLabel}</span>
          </TooltipTrigger>
          <TooltipPopup>
            {member.worktreePath ? `${branchLabel} (${member.worktreePath})` : branchLabel}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {owns.length > 0 ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex max-w-[12rem] items-center gap-1 truncate font-mono" />
            }
          >
            <FolderIcon aria-hidden className="size-3 shrink-0" />
            <span className="truncate">
              {owns.length === 1
                ? owns[0]
                : gt("{first} +{rest}", { first: owns[0]!, rest: owns.length - 1 })}
            </span>
          </TooltipTrigger>
          <TooltipPopup>
            <div className="flex flex-col gap-0.5 font-mono text-xs">
              {owns.map((ownedPath) => (
                <span key={ownedPath}>{ownedPath}</span>
              ))}
            </div>
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {hasMetrics ? (
        <Tooltip>
          <TooltipTrigger render={<span className="shrink-0 font-mono tabular-nums" />}>
            {metrics.totalTokens > 0
              ? `${metrics.turns}t · ${formatTokenCount(metrics.totalTokens)}`
              : `${metrics.turns}t`}
          </TooltipTrigger>
          <TooltipPopup>
            <div className="flex flex-col gap-0.5 text-xs tabular-nums">
              <span>
                {gt("{count, plural, one {{count} turn} other {{count} turns}}", {
                  count: metrics.turns,
                })}
              </span>
              {metrics.totalTokens > 0 ? (
                <span>
                  {gt("Input: {input} · Output: {output}", {
                    input: formatTokenCount(metrics.inputTokens),
                    output: formatTokenCount(metrics.outputTokens),
                  })}
                </span>
              ) : null}
            </div>
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {member.scratchDir ? (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex shrink-0 items-center gap-1" />}>
            <FileTextIcon aria-hidden className="size-3 shrink-0" />
            <T>scratch</T>
          </TooltipTrigger>
          <TooltipPopup>
            <span className="font-mono text-xs">{member.scratchDir}</span>
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
}

function MemberRow(props: {
  member: AgySwarmMember;
  bee: BeeColors;
  cue: BeeCue | undefined;
  snippet: string;
  current: boolean;
  threadRef: ScopedThreadRef;
  canRetry: boolean;
  canKill: boolean;
  retrying: boolean;
  onRetry: (member: AgySwarmMember) => void;
  onRequestKill: (member: AgySwarmMember) => void;
  onOpen: (member: AgySwarmMember, intent: "primary" | "alternate") => void;
}) {
  const gt = useGT();
  const stateLabel = useMemberStateLabel();
  const { member } = props;
  const live = member.state !== "killed";
  const model = live ? null : member.model;
  const showRetry =
    live && props.canRetry && (member.state === "stopped" || member.state === "waiting");
  const showKill = live && props.canKill && member.role !== "coordinator";
  const controls = live ? (
    <div className="flex flex-wrap items-center gap-1 ps-12 pe-2 pb-1">
      <div className="min-w-0 flex-1">
        <SwarmMemberModelControls
          threadRef={props.threadRef}
          memberName={member.name}
          fallbackModel={member.model}
        />
      </div>
      {showRetry ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                disabled={props.retrying}
                aria-label={
                  member.state === "stopped"
                    ? gt("Retry {member}", { member: member.name })
                    : gt("Wake {member}", { member: member.name })
                }
                onClick={() => props.onRetry(member)}
              />
            }
          >
            {member.state === "stopped" ? <RotateCwIcon /> : <PlayIcon />}
          </TooltipTrigger>
          <TooltipPopup>
            {member.state === "stopped" ? gt("Retry member") : gt("Wake member")}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {showKill ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                aria-label={gt("Retire {member}", { member: member.name })}
                onClick={() => props.onRequestKill(member)}
              />
            }
          >
            <Trash2Icon />
          </TooltipTrigger>
          <TooltipPopup>{gt("Retire worker")}</TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  ) : null;
  const content = (
    <>
      <SwarmAvatar bee={props.bee} cue={props.cue} working={member.state === "working"} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <span className="min-w-0 truncate font-medium text-foreground">{member.name}</span>
          {member.canManage && member.role !== "coordinator" ? (
            <Badge variant="info" size="sm">
              <T>Manager</T>
            </Badge>
          ) : null}
          {member.readOnly ? (
            <Badge variant="secondary" size="sm">
              <T>Read-only</T>
            </Badge>
          ) : null}
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 text-xs",
              MEMBER_STATE_TEXT[member.state],
            )}
          >
            <SwarmStateDot state={member.state} />
            {stateLabel(member.state)}
          </span>
          {props.current ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              <T>This thread</T>
            </span>
          ) : null}
          {member.lastPostSeq === null ? null : (
            <span className="ms-auto shrink-0 ps-2 font-mono text-xs tabular-nums text-muted-foreground/80">
              #{member.lastPostSeq}
            </span>
          )}
        </span>
        {model || props.snippet ? (
          <span className="flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
            {model ? (
              <span className="max-w-[45%] shrink-0 truncate font-mono">{model}</span>
            ) : null}
            {model && props.snippet ? <span aria-hidden>·</span> : null}
            {props.snippet ? <span className="min-w-0 truncate">{props.snippet}</span> : null}
          </span>
        ) : null}
        <MemberMetaRow member={member} />
      </span>
    </>
  );
  const rowClass = cn(
    "flex w-full min-w-0 items-start gap-3 rounded-md px-2 py-2 text-left",
    member.state === "killed" && "opacity-70",
  );
  if (props.current) {
    return (
      <li className="px-2" aria-current="true">
        <div className={rowClass}>{content}</div>
        {controls}
      </li>
    );
  }
  return (
    <li className="px-2">
      <button
        type="button"
        className={cn(
          rowClass,
          "cursor-pointer hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        onClick={(event) =>
          props.onOpen(member, sideThreadOpenIntentOf(event, isMacPlatform(navigator.platform)))
        }
        onAuxClick={(event) => {
          if (event.button === 1) props.onOpen(member, "alternate");
        }}
      >
        {content}
      </button>
      {controls}
    </li>
  );
}

function MemberSection(props: { label: ReactNode; count: number; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
        {props.label}
        <span className="tabular-nums text-muted-foreground/70">{props.count}</span>
      </h3>
      <ul className="flex flex-col">{props.children}</ul>
    </section>
  );
}

export function SwarmMembers(props: { swarm: AgySwarmSnapshot; threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const m = useMessages();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [retiredOpen, setRetiredOpen] = useState(false);
  const [retryingName, setRetryingName] = useState<string | null>(null);
  const [killPrompt, setKillPrompt] = useState<{
    member: AgySwarmMember;
    dirtyReason: string | null;
    pending: boolean;
  } | null>(null);

  const canRetry = useAtomValue(
    agySwarmEnvironment.retry.permissionAtom(props.threadRef.environmentId),
  );
  const canKill = useAtomValue(
    agySwarmEnvironment.kill.permissionAtom(props.threadRef.environmentId),
  );
  const retryMember = useOrchestrationCommand(agySwarmEnvironment.retry, {
    label: "retry swarm member",
  });
  const killMember = useOrchestrationCommand(agySwarmEnvironment.kill, {
    label: "retire swarm worker",
  });

  // Only joins and posts that land while this tab is open animate a bee.
  const [opened] = useState(() => ({
    seq: props.swarm.head,
    names: new Set(props.swarm.members.map((member) => member.name)),
  }));
  const groups = groupMembers(props.swarm.members, query);
  const openMember = (member: AgySwarmMember, intent: "primary" | "alternate") =>
    openSideThread({
      threadRef: scopeThreadRef(props.threadRef.environmentId, member.threadId),
      panelRef: props.threadRef,
      intent,
      navigate: (target) =>
        void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(target) }),
    });

  const handleRetry = async (member: AgySwarmMember) => {
    if (retryingName !== null) return;
    setRetryingName(member.name);
    const result = await retryMember({
      environmentId: props.threadRef.environmentId,
      input: { threadId: props.threadRef.threadId, name: member.name },
    });
    setRetryingName(null);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      toastManager.add({
        type: "error",
        title: gt("Couldn't wake @{member}", { member: member.name }),
        description: thrownErrorMessage(squashAtomCommandFailure(result), m) ?? gt("Try again."),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: gt("Woke @{member}", { member: member.name }),
      description: result.value.message,
    });
  };

  const handleConfirmKill = async (force: boolean) => {
    if (killPrompt === null || killPrompt.pending) return;
    const target = killPrompt.member;
    setKillPrompt({ member: target, dirtyReason: killPrompt.dirtyReason, pending: true });
    const result = await killMember({
      environmentId: props.threadRef.environmentId,
      input: {
        threadId: props.threadRef.threadId,
        name: target.name,
        ...(force ? { force: true } : {}),
      },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) {
        setKillPrompt(null);
        return;
      }
      const message = thrownErrorMessage(squashAtomCommandFailure(result), m);
      if (!force && isDirtyWorktreeKillError(message)) {
        setKillPrompt({
          member: target,
          dirtyReason: message ?? gt("This worktree has uncommitted changes."),
          pending: false,
        });
        return;
      }
      setKillPrompt(null);
      toastManager.add({
        type: "error",
        title: gt("Couldn't retire @{member}", { member: target.name }),
        description: message ?? gt("Try again."),
      });
      return;
    }
    setKillPrompt(null);
    toastManager.add({
      type: "success",
      title: gt("Retired @{member}", { member: target.name }),
      description: result.value.message,
    });
  };

  const row = (member: AgySwarmMember) => (
    <MemberRow
      key={member.name}
      member={member}
      bee={memberBee(props.swarm.members, member.name)}
      cue={memberCue(member, props.swarm.posts, opened)}
      snippet={memberSnippet(member, props.swarm.posts)}
      current={member.threadId === props.threadRef.threadId}
      threadRef={scopeThreadRef(props.threadRef.environmentId, member.threadId)}
      canRetry={canRetry}
      canKill={canKill}
      retrying={retryingName === member.name}
      onRetry={(target) => void handleRetry(target)}
      onRequestKill={(target) =>
        setKillPrompt({ member: target, dirtyReason: null, pending: false })
      }
      onOpen={openMember}
    />
  );
  const empty =
    groups.coordinators.length +
      groups.active.length +
      groups.standingBy.length +
      groups.retired.length ===
    0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pt-3 pb-1">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={query}
            placeholder={gt("Search members")}
            aria-label={gt("Search members")}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !event.currentTarget.value) return;
              event.stopPropagation();
              setQuery("");
            }}
          />
        </InputGroup>
      </div>
      {empty ? (
        <Empty size="compact">
          <EmptyHeader>
            <EmptyTitle>
              <T>No matching members</T>
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
          {groups.coordinators.length > 0 ? (
            <ul className="flex flex-col pt-2">{groups.coordinators.map(row)}</ul>
          ) : null}
          {groups.active.length > 0 ? (
            <MemberSection label={<T>Active</T>} count={groups.active.length}>
              {groups.active.map(row)}
            </MemberSection>
          ) : null}
          {groups.standingBy.length > 0 ? (
            <MemberSection label={<T>Standing by</T>} count={groups.standingBy.length}>
              {groups.standingBy.map(row)}
            </MemberSection>
          ) : null}
          {groups.retired.length > 0 ? (
            <section className="flex flex-col px-2 pt-2">
              <CollapsibleSectionHeader
                variant="panel"
                expanded={retiredOpen || query.trim() !== ""}
                onClick={() => setRetiredOpen((open) => !open)}
                accessory={
                  <span className="text-xs tabular-nums text-muted-foreground/70">
                    {groups.retired.length}
                  </span>
                }
              >
                <T>Retired</T>
              </CollapsibleSectionHeader>
              {retiredOpen || query.trim() !== "" ? (
                <ul className="-mx-2 flex flex-col">{groups.retired.map(row)}</ul>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
      <AlertDialog
        open={killPrompt !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !killPrompt?.pending) setKillPrompt(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {killPrompt?.dirtyReason ? (
                <T>
                  Discard uncommitted changes for @<Var>{killPrompt.member.name}</Var>?
                </T>
              ) : (
                <T>
                  Retire @<Var>{killPrompt?.member.name ?? ""}</Var>?
                </T>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {killPrompt?.dirtyReason ? (
                killPrompt.dirtyReason
              ) : killPrompt?.member.workspace === "worktree" ? (
                <T>This stops the worker permanently and removes its isolated worktree if clean.</T>
              ) : (
                <T>This stops the worker permanently. Its conversation history stays readable.</T>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" disabled={killPrompt?.pending} />}>
              <T>Cancel</T>
            </AlertDialogClose>
            {killPrompt?.dirtyReason ? (
              <Button
                variant="destructive"
                disabled={killPrompt.pending}
                onClick={() => void handleConfirmKill(true)}
              >
                {killPrompt.pending ? <T>Retiring…</T> : <T>Force retire & discard</T>}
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={killPrompt?.pending}
                onClick={() => void handleConfirmKill(false)}
              >
                {killPrompt?.pending ? <T>Retiring…</T> : <T>Retire worker</T>}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
