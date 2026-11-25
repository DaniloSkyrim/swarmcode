import type {
  AgySwarmBoostRoundStatus,
  AgySwarmGateStatus,
  AgySwarmIntegrityMode,
  AgySwarmMilestoneStatus,
  AgySwarmPlan,
  AgySwarmSnapshot,
} from "@t3tools/contracts";
import { CheckIcon, CopyIcon, FolderIcon } from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { type ReactNode, useState } from "react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { memberBee, milestoneProgress } from "./swarmBoard.logic";
import { MEMBER_STATE_TEXT, SwarmAvatar, SwarmStateDot, useMemberStateLabel } from "./SwarmAvatar";

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

function WorkerTask(props: { swarm: AgySwarmSnapshot; worker: string; task: string | undefined }) {
  const stateLabel = useMemberStateLabel();
  const member = props.swarm.members.find((entry) => entry.name === props.worker);
  return (
    <li className="flex items-start gap-2.5">
      <SwarmAvatar bee={memberBee(props.swarm.members, props.worker)} size="sm" />
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
    </li>
  );
}

function SectionTitle(props: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{props.children}</h3>
      {props.meta ? (
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

export function SwarmOverview(props: { swarm: AgySwarmSnapshot; plan: AgySwarmPlan }) {
  const resolve = useMessages();
  const { plan } = props;
  const planned = new Set(plan.threads.flatMap((thread) => thread.tasks));
  const unthreaded = Object.entries(plan.tasks).filter(([worker]) => !planned.has(worker));
  const milestones = plan.milestones ?? [];
  const rounds = plan.rounds ?? [];
  const artifacts = plan.artifacts ?? [];
  const progress = milestoneProgress(plan);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-3">
      <section className="flex flex-col gap-1.5">
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
          <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-5 text-muted-foreground">
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
      </section>

      {milestones.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionTitle meta={progress ? `${progress.passed}/${progress.total}` : undefined}>
            <T>Milestones</T>
          </SectionTitle>
          {milestones.map((milestone) => (
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
                  <Badge variant={GATE_VARIANT[milestone.gates.critic ?? "pending"]} size="sm">
                    <T>
                      Critic: <Var>{resolve(GATE_LABELS[milestone.gates.critic ?? "pending"])}</Var>
                    </T>
                  </Badge>
                  <Badge variant={GATE_VARIANT[milestone.gates.challenger ?? "pending"]} size="sm">
                    <T>
                      Challenger:{" "}
                      <Var>{resolve(GATE_LABELS[milestone.gates.challenger ?? "pending"])}</Var>
                    </T>
                  </Badge>
                  <Badge variant={GATE_VARIANT[milestone.gates.auditor ?? "pending"]} size="sm">
                    <T>
                      Auditor:{" "}
                      <Var>{resolve(GATE_LABELS[milestone.gates.auditor ?? "pending"])}</Var>
                    </T>
                  </Badge>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {rounds.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionTitle meta={rounds.length}>
            <T>Boost rounds</T>
          </SectionTitle>
          <div className="flex flex-col gap-2">
            {rounds.map((entry) => (
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
                      <SwarmAvatar bee={memberBee(props.swarm.members, entry.worker)} size="sm" />
                      <span className="truncate font-medium text-foreground">{entry.worker}</span>
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

      {plan.threads.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionTitle>
            <T>Threads of work</T>
          </SectionTitle>
          {plan.threads.map((thread) => (
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
              {thread.tasks.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {thread.tasks.map((worker) => (
                    <WorkerTask
                      key={worker}
                      swarm={props.swarm}
                      worker={worker}
                      task={plan.tasks[worker]}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {unthreaded.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionTitle>
            <T>Tasks</T>
          </SectionTitle>
          <ul className="flex flex-col gap-2">
            {unthreaded.map(([worker, task]) => (
              <WorkerTask key={worker} swarm={props.swarm} worker={worker} task={task} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
