import type { AgySwarmPlan, AgySwarmSnapshot } from "@t3tools/contracts";
import { T } from "gt-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { memberBee } from "./swarmBoard.logic";
import { MEMBER_STATE_TEXT, SwarmAvatar, SwarmStateDot, useMemberStateLabel } from "./SwarmAvatar";

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

function SectionTitle(props: { children: ReactNode }) {
  return <h3 className="text-xs font-medium text-muted-foreground">{props.children}</h3>;
}

export function SwarmOverview(props: { swarm: AgySwarmSnapshot; plan: AgySwarmPlan }) {
  const { plan } = props;
  const planned = new Set(plan.threads.flatMap((thread) => thread.tasks));
  const unthreaded = Object.entries(plan.tasks).filter(([worker]) => !planned.has(worker));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-3">
      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-foreground">{plan.goal.title}</h2>
        {plan.goal.line ? (
          <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-5 text-muted-foreground">
            {plan.goal.line}
          </p>
        ) : null}
      </section>
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
