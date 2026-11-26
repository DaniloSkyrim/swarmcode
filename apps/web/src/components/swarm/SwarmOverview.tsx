import { sideThreadOpenIntentOf } from "@t3tools/client-runtime/side-thread";
import type {
  AgySwarmBoostRoundStatus,
  AgySwarmGateStatus,
  AgySwarmIntegrityMode,
  AgySwarmMember,
  AgySwarmMilestoneStatus,
  AgySwarmPlan,
  AgySwarmSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  ArrowUpRightIcon,
  CheckIcon,
  ChevronUpIcon,
  CopyIcon,
  FolderIcon,
  GitBranchIcon,
  MessageSquareIcon,
  XIcon,
} from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { type ReactNode, useState } from "react";

import { cn, isMacPlatform } from "~/lib/utils";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type BeeColors,
  formatTokenCount,
  memberBee,
  memberSnippet,
  milestoneProgress,
  OVERVIEW_VISIBLE_WORKERS,
  overviewWorkers,
  previewWorkerBees,
  QUEEN_BEE,
} from "./swarmBoard.logic";
import {
  MEMBER_STATE_TEXT,
  SwarmAllTile,
  SwarmAvatar,
  SwarmStateDot,
  useMemberStateLabel,
} from "./SwarmAvatar";

type BadgeVariant = "secondary" | "info" | "warning" | "success" | "error" | "outline";

const INTEGRITY_LABELS: Record<AgySwarmIntegrityMode, string> = {
  development: msg("Development", { $context: "teamwork integrity mode" }),
  demo: msg("Demo", { $context: "teamwork integrity mode" }),
  benchmark: msg("Benchmark", { $context: "teamwork integrity mode" }),
};

const INTEGRITY_VARIANT: Record<AgySwarmIntegrityMode, BadgeVariant> = {
  development: "info",
  demo: "warning",
  benchmark: "error",
};

const MILESTONE_LABELS: Record<AgySwarmMilestoneStatus, string> = {
  pending: msg("Pending", { $context: "teamwork milestone status" }),
  in_progress: msg("In progress", { $context: "teamwork milestone status" }),
  verifying: msg("Verifying", { $context: "teamwork milestone status" }),
  passed: msg("Passed", { $context: "teamwork milestone status" }),
  blocked: msg("Blocked", { $context: "teamwork milestone status" }),
};

const MILESTONE_VARIANT: Record<AgySwarmMilestoneStatus, BadgeVariant> = {
  pending: "secondary",
  in_progress: "info",
  verifying: "warning",
  passed: "success",
  blocked: "error",
};

const GATE_LABELS: Record<AgySwarmGateStatus, string> = {
  pending: msg("pending", { $context: "milestone review gate status" }),
  running: msg("running", { $context: "milestone review gate status" }),
  passed: msg("passed", { $context: "milestone review gate status" }),
  failed: msg("failed", { $context: "milestone review gate status" }),
};

const GATE_VARIANT: Record<AgySwarmGateStatus, BadgeVariant> = {
  pending: "secondary",
  running: "info",
  passed: "success",
  failed: "error",
};

const ROUND_LABELS: Record<AgySwarmBoostRoundStatus, string> = {
  running: msg("Running", { $context: "boost round status" }),
  fixed: msg("Fixed", { $context: "boost round status" }),
  clean: msg("Clean", { $context: "boost round status" }),
  blocked: msg("Blocked", { $context: "boost round status" }),
};

const ROUND_VARIANT: Record<AgySwarmBoostRoundStatus, BadgeVariant> = {
  running: "warning",
  fixed: "info",
  clean: "success",
  blocked: "error",
};

const FAN_OUT_STEPS = [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92] as const;
const FAN_OUT_OPACITY = [0.35, 0.55, 0.75, 0.65, 0.75, 0.88, 0.95] as const;
const FAN_OUT_BRANCHES = [
  { id: "top", endY: 18, controlX: 42, controlY: 18 },
  { id: "middle", endY: 62, controlX: 50, controlY: 62 },
  { id: "bottom", endY: 106, controlX: 42, controlY: 106 },
] as const;

function bezierPoint(t: number, p0: number, p1: number, p2: number): number {
  const inv = 1 - t;
  return inv * inv * p0 + 2 * inv * t * p1 + t * t * p2;
}

function isMemberSleeping(member: AgySwarmMember | undefined): boolean {
  return member !== undefined && (member.state === "waiting" || member.state === "stopped");
}

function SectionTitle(props: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{props.children}</h3>
      {props.meta !== undefined && props.meta !== null ? (
        <span className="font-mono text-xs tabular-nums text-muted-foreground/80">
          {props.meta}
        </span>
      ) : null}
    </div>
  );
}

function CopyPathButton(props: { path: string }) {
  const gt = useGT();
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard?.writeText(props.path).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={gt("Copy path")}
            onClick={handleCopy}
          />
        }
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </TooltipTrigger>
      <TooltipPopup>{copied ? gt("Copied") : gt("Copy path")}</TooltipPopup>
    </Tooltip>
  );
}

function SwarmStartingHero(props: {
  coordinator: AgySwarmMember | undefined;
  workers: ReadonlyArray<AgySwarmMember>;
  previewBees: ReadonlyArray<BeeColors>;
  done: boolean;
}) {
  return (
    <section
      className="flex flex-col items-center px-2 pt-4 pb-1"
      data-testid="swarm-overview-starting-hero"
    >
      <div className="flex items-center" aria-hidden>
        <SwarmAvatar
          bee={QUEEN_BEE}
          size="tile"
          honeycomb
          bordered
          working={props.coordinator?.state === "working"}
          sleeping={isMemberSleeping(props.coordinator)}
        />
        <svg width="100" height="124" viewBox="0 0 100 124" className="shrink-0">
          {FAN_OUT_BRANCHES.map((branch, branchIndex) => {
            const workerBee = props.previewBees[branchIndex]!;
            return FAN_OUT_STEPS.map((step, stepIndex) => (
              <circle
                key={`${branch.id}-${step}`}
                cx={bezierPoint(step, 6, branch.controlX, 94)}
                cy={bezierPoint(step, 62, branch.controlY, branch.endY)}
                r="1.75"
                opacity={FAN_OUT_OPACITY[stepIndex]}
                className={stepIndex < 3 ? QUEEN_BEE.dot : workerBee.dot}
              />
            ));
          })}
        </svg>
        <div className="flex flex-col gap-2">
          {FAN_OUT_BRANCHES.map((branch, index) => {
            const bee = props.previewBees[index]!;
            const worker = props.workers[index];
            return (
              <SwarmAvatar
                key={branch.id}
                bee={bee}
                size="lg"
                bordered
                working={worker?.state === "working"}
                sleeping={isMemberSleeping(worker)}
              />
            );
          })}
        </div>
      </div>

      <h2 className="mt-5 text-center text-base font-semibold tracking-tight text-foreground">
        {props.done ? <T>Swarm finished</T> : <T>Your swarm is starting</T>}
      </h2>

      <div className="mt-5 flex w-full max-w-[290px] flex-col gap-3.5">
        <div className="flex items-center gap-3">
          <SwarmAvatar bee={QUEEN_BEE} size="lg" honeycomb bordered />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-foreground">
              <T>One goal</T>
            </div>
            <p className="text-xs leading-4.5 text-muted-foreground">
              <T>The coordinator splits it into tasks.</T>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <SwarmAvatar bee={props.previewBees[0]!} size="lg" bordered />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-foreground">
              <T>Many workers</T>
            </div>
            <p className="text-xs leading-4.5 text-muted-foreground">
              <T>Each takes a task, and they run in parallel.</T>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <SwarmAvatar bee={props.previewBees[1]!} size="lg" bordered />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-foreground">
              <T>One board</T>
            </div>
            <p className="text-xs leading-4.5 text-muted-foreground">
              <T>Updates land here. You step in only when asked.</T>
            </p>
          </div>
        </div>
      </div>

      {props.done ? null : (
        <p className="mt-6 text-center text-xs font-medium text-muted-foreground">
          <span ref={observeVisibleAnimation} className="live-tool-shine inline-block">
            <T>Waiting for the first update</T>
          </span>
        </p>
      )}
    </section>
  );
}

function SelectedWorkerDetailCard(props: {
  swarm: AgySwarmSnapshot;
  member: AgySwarmMember;
  task: string | undefined;
  threadRef: ScopedThreadRef;
  onClear: () => void;
  onOpenMember: (member: AgySwarmMember, intent: "primary" | "alternate") => void;
  onFilterBoardByMember: (memberName: string) => void;
}) {
  const gt = useGT();
  const stateLabel = useMemberStateLabel();
  const { member } = props;
  const snippet = memberSnippet(member, props.swarm.posts);
  const showSnippet = snippet.length > 0 && snippet !== props.task;
  const isCurrent = member.threadId === props.threadRef.threadId;
  const branchLabel = member.branch ?? (member.workspace === "worktree" ? gt("worktree") : null);
  const owns = member.owns ?? [];
  const metrics = member.metrics;
  const hasMetrics = metrics !== undefined && (metrics.turns > 0 || metrics.totalTokens > 0);
  const hasMeta = Boolean(member.model || branchLabel || owns.length > 0 || hasMetrics);

  return (
    <div
      className="flex flex-col gap-2.5 rounded-xl border border-border/70 bg-card/70 p-3"
      data-testid="swarm-overview-worker-detail"
    >
      <div className="flex items-start gap-2.5">
        <SwarmAvatar
          bee={memberBee(props.swarm.members, member.name)}
          size="lg"
          bordered
          working={member.state === "working"}
          sleeping={isMemberSleeping(member)}
          className={member.state === "killed" ? "opacity-55" : undefined}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{member.name}</span>
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
                "inline-flex shrink-0 items-center gap-1 text-xs",
                MEMBER_STATE_TEXT[member.state],
              )}
            >
              <SwarmStateDot state={member.state} />
              {stateLabel(member.state)}
            </span>
          </div>
          {hasMeta ? (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
              {member.model ? (
                <span className="max-w-[14rem] truncate font-mono">{member.model}</span>
              ) : null}
              {branchLabel ? (
                <span className="inline-flex max-w-[11rem] items-center gap-1 truncate font-mono">
                  <GitBranchIcon aria-hidden className="size-3 shrink-0" />
                  <span className="truncate">{branchLabel}</span>
                </span>
              ) : null}
              {owns.length > 0 ? (
                <span className="inline-flex max-w-[11rem] items-center gap-1 truncate font-mono">
                  <FolderIcon aria-hidden className="size-3 shrink-0" />
                  <span className="truncate">
                    {owns.length === 1
                      ? owns[0]
                      : gt("{first} +{rest}", { first: owns[0]!, rest: owns.length - 1 })}
                  </span>
                </span>
              ) : null}
              {hasMetrics ? (
                <span className="shrink-0 font-mono tabular-nums">
                  {metrics.totalTokens > 0
                    ? `${metrics.turns}t · ${formatTokenCount(metrics.totalTokens)}`
                    : `${metrics.turns}t`}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={gt("Show all workers")}
          onClick={props.onClear}
        >
          <XIcon />
        </Button>
      </div>

      {props.task ? (
        <p className="whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-foreground/90">
          {props.task}
        </p>
      ) : null}

      {showSnippet ? (
        <p className="line-clamp-3 whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-muted-foreground">
          {snippet}
        </p>
      ) : !props.task ? (
        <p className="text-xs text-muted-foreground">
          <T>No updates posted yet.</T>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {isCurrent ? (
          <span className="text-xs text-muted-foreground">
            <T>This thread</T>
          </span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={(event) =>
              props.onOpenMember(
                member,
                sideThreadOpenIntentOf(event, isMacPlatform(navigator.platform)),
              )
            }
            onAuxClick={(event) => {
              if (event.button === 1) props.onOpenMember(member, "alternate");
            }}
          >
            <ArrowUpRightIcon />
            <T>Open thread</T>
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => props.onFilterBoardByMember(member.name)}
        >
          <MessageSquareIcon />
          <T>View on board</T>
        </Button>
      </div>
    </div>
  );
}

function SwarmTeamSection(props: {
  swarm: AgySwarmSnapshot;
  coordinator: AgySwarmMember | undefined;
  workers: ReadonlyArray<AgySwarmMember>;
  previewBees: ReadonlyArray<BeeColors>;
  selectedWorker: AgySwarmMember | null;
  expanded: boolean;
  onSelectWorker: (name: string | null) => void;
  onToggleExpanded: (next: boolean) => void;
  threadRef: ScopedThreadRef;
  onOpenMember: (member: AgySwarmMember, intent: "primary" | "alternate") => void;
  onFilterBoardByMember: (memberName: string) => void;
}) {
  const gt = useGT();
  const stateLabel = useMemberStateLabel();
  const { coordinator, workers, selectedWorker } = props;
  const workingCount = props.swarm.members.filter((member) => member.state === "working").length;
  const liveCount = props.swarm.members.filter((member) => member.state !== "killed").length;

  const hasOverflow = workers.length > OVERVIEW_VISIBLE_WORKERS;
  const visibleWorkers =
    props.expanded || !hasOverflow ? workers : workers.slice(0, OVERVIEW_VISIBLE_WORKERS);
  const hiddenCount = workers.length - visibleWorkers.length;

  const coordinatorWorking = coordinator?.state === "working";
  const coordinatorSleeping = isMemberSleeping(coordinator);
  const coordinatorSnippet = coordinator
    ? memberSnippet(coordinator, props.swarm.posts) ||
      (coordinatorWorking ? gt("Planning and delegating tasks") : gt("Waiting for worker updates"))
    : "";
  const isCurrentCoordinator = coordinator?.threadId === props.threadRef.threadId;

  const coordinatorBody = coordinator ? (
    <>
      <SwarmAvatar
        bee={QUEEN_BEE}
        size="spotlight"
        honeycomb
        bordered
        working={coordinatorWorking}
        sleeping={coordinatorSleeping}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            <T>Coordinator</T>
          </span>
          {coordinator.state === "working" || coordinator.state === "needs-input" ? (
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 text-xs",
                MEMBER_STATE_TEXT[coordinator.state],
              )}
            >
              <SwarmStateDot state={coordinator.state} />
              {stateLabel(coordinator.state)}
            </span>
          ) : null}
          {isCurrentCoordinator ? (
            <span className="ms-auto shrink-0 text-xs text-muted-foreground">
              <T>This thread</T>
            </span>
          ) : null}
        </div>
        <p className="line-clamp-2 text-xs leading-4.5 text-muted-foreground">
          {coordinatorSnippet}
        </p>
      </div>
    </>
  ) : null;

  return (
    <section className="flex flex-col gap-3" data-testid="swarm-overview-team">
      <SectionTitle
        meta={workingCount > 0 ? gt("{count} working", { count: workingCount }) : liveCount}
      >
        <T>The team</T>
      </SectionTitle>

      {coordinator ? (
        isCurrentCoordinator ? (
          <div
            aria-current="true"
            data-testid="swarm-overview-coordinator"
            className="flex items-center gap-3.5 rounded-xl border border-border/70 bg-card/70 p-3"
          >
            {coordinatorBody}
          </div>
        ) : (
          <button
            type="button"
            data-testid="swarm-overview-coordinator"
            className="flex w-full cursor-pointer items-center gap-3.5 rounded-xl border border-border/70 bg-card/70 p-3 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={(event) =>
              props.onOpenMember(
                coordinator,
                sideThreadOpenIntentOf(event, isMacPlatform(navigator.platform)),
              )
            }
            onAuxClick={(event) => {
              if (event.button === 1) props.onOpenMember(coordinator, "alternate");
            }}
          >
            {coordinatorBody}
          </button>
        )
      ) : null}

      {workers.length > 0 ? (
        <div
          role="group"
          aria-label={gt("Team filter")}
          data-testid="swarm-overview-team-strip"
          className="flex flex-wrap items-start gap-2"
        >
          <button
            type="button"
            data-team-tile="all"
            aria-pressed={selectedWorker === null}
            onClick={() => props.onSelectWorker(null)}
            className="group flex w-15 shrink-0 cursor-pointer flex-col items-center gap-1.5 rounded-xl p-0.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span
              className={cn(
                "relative rounded-2xl border-2 p-0.5 transition-colors",
                selectedWorker === null
                  ? "border-foreground"
                  : "border-transparent group-hover:border-border/80",
              )}
            >
              <SwarmAllTile bees={props.previewBees} />
            </span>
            <span
              className={cn(
                "w-full truncate px-0.5 text-2xs leading-4",
                selectedWorker === null
                  ? "font-medium text-foreground"
                  : "text-muted-foreground group-hover:text-foreground",
              )}
            >
              <T>All</T>
            </span>
          </button>

          {visibleWorkers.map((worker) => {
            const selected = selectedWorker?.name === worker.name;
            const snippet = memberSnippet(worker, props.swarm.posts);
            return (
              <Tooltip key={worker.name}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-team-tile={worker.name}
                      aria-pressed={selected}
                      onClick={() => props.onSelectWorker(selected ? null : worker.name)}
                      className="group flex w-15 shrink-0 cursor-pointer flex-col items-center gap-1.5 rounded-xl p-0.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    />
                  }
                >
                  <span
                    className={cn(
                      "relative rounded-2xl border-2 p-0.5 transition-colors",
                      selected
                        ? "border-foreground"
                        : "border-transparent group-hover:border-border/80",
                    )}
                  >
                    <SwarmAvatar
                      bee={memberBee(props.swarm.members, worker.name)}
                      size="tile"
                      bordered
                      working={worker.state === "working"}
                      sleeping={isMemberSleeping(worker)}
                      className={worker.state === "killed" ? "opacity-55" : undefined}
                    />
                    {worker.state === "working" ? (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute top-1 right-1 size-2.5 rounded-full border-2 border-card bg-success"
                      />
                    ) : worker.state === "needs-input" ? (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute top-1 right-1 size-2.5 rounded-full border-2 border-card bg-warning"
                      />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "w-full truncate px-0.5 text-2xs leading-4",
                      selected
                        ? "font-medium text-foreground"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    {worker.name}
                  </span>
                </TooltipTrigger>
                <TooltipPopup>
                  <div className="flex max-w-60 flex-col gap-0.5 text-xs">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span>{worker.name}</span>
                      <span className="text-muted-foreground">· {stateLabel(worker.state)}</span>
                    </div>
                    {worker.model ? (
                      <span className="truncate font-mono text-2xs text-muted-foreground">
                        {worker.model}
                      </span>
                    ) : null}
                    {snippet ? (
                      <span className="line-clamp-2 text-muted-foreground">{snippet}</span>
                    ) : null}
                  </div>
                </TooltipPopup>
              </Tooltip>
            );
          })}

          {!props.expanded && hiddenCount > 0 ? (
            <button
              type="button"
              data-team-tile="more"
              aria-label={gt(
                "{count, plural, one {Show {count} more worker} other {Show {count} more workers}}",
                { count: hiddenCount },
              )}
              onClick={() => props.onToggleExpanded(true)}
              className="group flex w-15 shrink-0 cursor-pointer flex-col items-center gap-1.5 rounded-xl p-0.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="relative rounded-2xl border-2 border-transparent p-0.5 transition-colors group-hover:border-border/80">
                <span
                  aria-hidden
                  className="grid size-13 place-items-center rounded-xl border border-border/70 bg-muted/50 text-sm font-medium tabular-nums text-muted-foreground dark:bg-card/80"
                >
                  +{hiddenCount}
                </span>
              </span>
              <span className="w-full truncate px-0.5 text-2xs leading-4 text-muted-foreground group-hover:text-foreground">
                <T>More</T>
              </span>
            </button>
          ) : null}

          {props.expanded && hasOverflow ? (
            <button
              type="button"
              data-team-tile="less"
              aria-label={gt("Show fewer workers")}
              onClick={() => props.onToggleExpanded(false)}
              className="group flex w-15 shrink-0 cursor-pointer flex-col items-center gap-1.5 rounded-xl p-0.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="relative rounded-2xl border-2 border-transparent p-0.5 transition-colors group-hover:border-border/80">
                <span
                  aria-hidden
                  className="grid size-13 place-items-center rounded-xl border border-border/70 bg-muted/50 text-muted-foreground dark:bg-card/80"
                >
                  <ChevronUpIcon className="size-4" />
                </span>
              </span>
              <span className="w-full truncate px-0.5 text-2xs leading-4 text-muted-foreground group-hover:text-foreground">
                <T>Less</T>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {selectedWorker ? (
        <SelectedWorkerDetailCard
          swarm={props.swarm}
          member={selectedWorker}
          task={props.swarm.plan?.tasks[selectedWorker.name]}
          threadRef={props.threadRef}
          onClear={() => props.onSelectWorker(null)}
          onOpenMember={props.onOpenMember}
          onFilterBoardByMember={props.onFilterBoardByMember}
        />
      ) : null}
    </section>
  );
}

function WorkerTask(props: {
  swarm: AgySwarmSnapshot;
  worker: string;
  task: string | undefined;
  threadRef: ScopedThreadRef;
  onOpenMember: (member: AgySwarmMember, intent: "primary" | "alternate") => void;
}) {
  const stateLabel = useMemberStateLabel();
  const member = props.swarm.members.find((entry) => entry.name === props.worker);
  const canOpen = member !== undefined && member.threadId !== props.threadRef.threadId;
  const content = (
    <>
      <SwarmAvatar
        bee={memberBee(props.swarm.members, props.worker)}
        size="sm"
        working={member?.state === "working"}
        sleeping={isMemberSleeping(member)}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2 text-xs">
          <span className="truncate font-medium text-foreground">{props.worker}</span>
          {member ? (
            <span
              className={cn("flex shrink-0 items-center gap-1", MEMBER_STATE_TEXT[member.state])}
            >
              <SwarmStateDot state={member.state} />
              {stateLabel(member.state)}
            </span>
          ) : null}
        </span>
        {props.task ? (
          <span className="whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-muted-foreground">
            {props.task}
          </span>
        ) : null}
      </span>
    </>
  );

  if (!canOpen) {
    return <li className="flex items-start gap-2.5">{content}</li>;
  }

  return (
    <li>
      <button
        type="button"
        onClick={(event) =>
          props.onOpenMember(
            member,
            sideThreadOpenIntentOf(event, isMacPlatform(navigator.platform)),
          )
        }
        onAuxClick={(event) => {
          if (event.button === 1) props.onOpenMember(member, "alternate");
        }}
        className="-mx-1.5 flex w-[calc(100%+0.75rem)] cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {content}
      </button>
    </li>
  );
}

function PlanGoalCard(props: { plan: AgySwarmPlan }) {
  const resolve = useMessages();
  const { plan } = props;
  const progress = milestoneProgress(plan);
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/70 px-3.5 py-3"
      data-testid="swarm-overview-goal"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="text-sm font-semibold text-foreground">{plan.goal.title}</h2>
        {plan.mode ? (
          <Badge variant="outline" size="sm">
            {plan.mode}
          </Badge>
        ) : null}
        {plan.integrityMode ? (
          <Badge variant={INTEGRITY_VARIANT[plan.integrityMode]} size="sm">
            {resolve(INTEGRITY_LABELS[plan.integrityMode])}
          </Badge>
        ) : null}
      </div>
      {plan.goal.line ? (
        <p className="whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-muted-foreground">
          {plan.goal.line}
        </p>
      ) : null}
      {plan.projectDir ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FolderIcon aria-hidden className="size-3 shrink-0" />
          <span className="min-w-0 truncate font-mono">{plan.projectDir}</span>
          <CopyPathButton path={plan.projectDir} />
        </div>
      ) : null}
      {progress ? (
        <div className="flex items-center gap-2 pt-0.5">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-success transition-[width]"
              style={{ width: `${Math.round((progress.passed / progress.total) * 100)}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {progress.passed}/{progress.total}
          </span>
        </div>
      ) : null}
    </section>
  );
}

export function SwarmOverview(props: {
  swarm: AgySwarmSnapshot;
  threadRef: ScopedThreadRef;
  onOpenMember: (member: AgySwarmMember, intent: "primary" | "alternate") => void;
  onFilterBoardByMember: (memberName: string) => void;
}) {
  const resolve = useMessages();
  const { swarm } = props;
  const plan = swarm.plan;

  const [selection, setSelection] = useState<{ swarmId: string; name: string | null }>({
    swarmId: swarm.id,
    name: null,
  });
  const [expandedState, setExpandedState] = useState<{ swarmId: string; expanded: boolean }>({
    swarmId: swarm.id,
    expanded: false,
  });

  const coordinator = swarm.members.find((member) => member.role === "coordinator");
  const workers = overviewWorkers(swarm.members);
  const previewBees = previewWorkerBees(swarm.members, 3);
  const selectedName = selection.swarmId === swarm.id ? selection.name : null;
  const selectedWorker =
    selectedName === null ? null : (workers.find((worker) => worker.name === selectedName) ?? null);
  const expanded = expandedState.swarmId === swarm.id ? expandedState.expanded : false;

  const setSelectedWorker = (name: string | null) => setSelection({ swarmId: swarm.id, name });
  const setExpanded = (next: boolean) => setExpandedState({ swarmId: swarm.id, expanded: next });

  const planned = new Set(plan?.threads.flatMap((thread) => thread.tasks) ?? []);
  const allUnthreaded = plan
    ? Object.entries(plan.tasks).filter(([worker]) => !planned.has(worker))
    : [];
  const milestones = plan?.milestones ?? [];
  const allRounds = plan?.rounds ?? [];
  const artifacts = plan?.artifacts ?? [];
  const progress = milestoneProgress(plan);

  const visibleRounds = selectedWorker
    ? allRounds.filter((entry) => entry.worker === selectedWorker.name)
    : allRounds;
  const visibleThreads = plan
    ? selectedWorker
      ? plan.threads.filter((thread) => thread.tasks.includes(selectedWorker.name))
      : plan.threads
    : [];
  const visibleUnthreaded = selectedWorker
    ? allUnthreaded.filter(([worker]) => worker === selectedWorker.name)
    : allUnthreaded;
  const hasFilterablePlanItems =
    allRounds.length > 0 || (plan?.threads.length ?? 0) > 0 || allUnthreaded.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-3">
      {plan === null ? (
        <SwarmStartingHero
          coordinator={coordinator}
          workers={workers}
          previewBees={previewBees}
          done={swarm.doneAt !== null}
        />
      ) : (
        <PlanGoalCard plan={plan} />
      )}

      <SwarmTeamSection
        swarm={swarm}
        coordinator={coordinator}
        workers={workers}
        previewBees={previewBees}
        selectedWorker={selectedWorker}
        expanded={expanded}
        onSelectWorker={setSelectedWorker}
        onToggleExpanded={setExpanded}
        threadRef={props.threadRef}
        onOpenMember={props.onOpenMember}
        onFilterBoardByMember={props.onFilterBoardByMember}
      />

      {plan !== null ? (
        <>
          {selectedWorker && hasFilterablePlanItems ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
              <span className="truncate">
                <T>
                  Showing work for <Var>{selectedWorker.name}</Var>
                </T>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setSelectedWorker(null)}
              >
                <T>Show all</T>
              </Button>
            </div>
          ) : null}

          {milestones.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionTitle meta={progress ? `${progress.passed}/${progress.total}` : undefined}>
                <T>Milestones</T>
              </SectionTitle>
              {milestones.map((milestone) => {
                const critic = milestone.gates?.critic ?? "pending";
                return (
                  <div
                    key={milestone.id}
                    className="flex flex-col gap-2 rounded-lg border border-border/60 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 text-sm font-medium text-foreground">
                        {milestone.title}
                      </div>
                      <Badge variant={MILESTONE_VARIANT[milestone.status]} size="sm">
                        {resolve(MILESTONE_LABELS[milestone.status])}
                      </Badge>
                    </div>
                    {milestone.summary ? (
                      <p className="whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-muted-foreground">
                        {milestone.summary}
                      </p>
                    ) : null}
                    {milestone.gates ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={GATE_VARIANT[critic]} size="sm">
                          <T>
                            Critic: <Var>{resolve(GATE_LABELS[critic])}</Var>
                          </T>
                        </Badge>
                        <Badge
                          variant={GATE_VARIANT[milestone.gates.challenger ?? "pending"]}
                          size="sm"
                        >
                          <T>
                            Challenger:{" "}
                            <Var>
                              {resolve(GATE_LABELS[milestone.gates.challenger ?? "pending"])}
                            </Var>
                          </T>
                        </Badge>
                        <Badge
                          variant={GATE_VARIANT[milestone.gates.auditor ?? "pending"]}
                          size="sm"
                        >
                          <T>
                            Auditor:{" "}
                            <Var>{resolve(GATE_LABELS[milestone.gates.auditor ?? "pending"])}</Var>
                          </T>
                        </Badge>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ) : null}

          {visibleRounds.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionTitle meta={visibleRounds.length}>
                <T>Boost rounds</T>
              </SectionTitle>
              <div className="flex flex-col gap-2">
                {visibleRounds.map((entry) => (
                  <div
                    key={entry.round}
                    className="flex flex-col gap-1.5 rounded-lg border border-border/60 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-medium tabular-nums text-foreground">
                        R{entry.round}
                      </span>
                      {entry.worker ? (
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <SwarmAvatar bee={memberBee(swarm.members, entry.worker)} size="sm" />
                          <span className="truncate font-medium text-foreground">
                            {entry.worker}
                          </span>
                        </span>
                      ) : null}
                      <span className="ms-auto">
                        <Badge variant={ROUND_VARIANT[entry.status]} size="sm">
                          {resolve(ROUND_LABELS[entry.status])}
                        </Badge>
                      </span>
                    </div>
                    {entry.summary ? (
                      <p className="whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-muted-foreground">
                        {entry.summary}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {plan.finalAudit ? (
            <section className="flex flex-col gap-2">
              <SectionTitle>
                <T>Final audit</T>
              </SectionTitle>
              <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    <T>Success Auditor</T>
                  </span>
                  <Badge variant={GATE_VARIANT[plan.finalAudit.status]} size="sm">
                    {resolve(GATE_LABELS[plan.finalAudit.status])}
                  </Badge>
                </div>
                {plan.finalAudit.summary ? (
                  <p className="whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-muted-foreground">
                    {plan.finalAudit.summary}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {artifacts.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionTitle meta={artifacts.length}>
                <T>Artifacts</T>
              </SectionTitle>
              <ul className="flex flex-col gap-1.5">
                {artifacts.map((artifact) => (
                  <li
                    key={`${artifact.label}:${artifact.path}`}
                    className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">
                        {artifact.label}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {artifact.path}
                      </div>
                    </div>
                    <CopyPathButton path={artifact.path} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {visibleThreads.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionTitle>
                <T>Threads of work</T>
              </SectionTitle>
              {visibleThreads.map((thread) => {
                const tasks = selectedWorker
                  ? thread.tasks.filter((worker) => worker === selectedWorker.name)
                  : thread.tasks;
                return (
                  <div
                    key={thread.id}
                    className="flex flex-col gap-2 rounded-lg border border-border/60 px-3 py-2.5"
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="text-sm font-medium text-foreground">{thread.title}</div>
                      {thread.goal ? (
                        <p className="whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-muted-foreground">
                          {thread.goal}
                        </p>
                      ) : null}
                    </div>
                    {tasks.length > 0 ? (
                      <ul className="flex flex-col gap-2">
                        {tasks.map((worker) => (
                          <WorkerTask
                            key={worker}
                            swarm={swarm}
                            worker={worker}
                            task={plan.tasks[worker]}
                            threadRef={props.threadRef}
                            onOpenMember={props.onOpenMember}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ) : null}

          {visibleUnthreaded.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionTitle>
                <T>Tasks</T>
              </SectionTitle>
              <ul className="flex flex-col gap-2">
                {visibleUnthreaded.map(([worker, task]) => (
                  <WorkerTask
                    key={worker}
                    swarm={swarm}
                    worker={worker}
                    task={task}
                    threadRef={props.threadRef}
                    onOpenMember={props.onOpenMember}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
