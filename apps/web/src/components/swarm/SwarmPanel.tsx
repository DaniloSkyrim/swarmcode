import { useAtomValue } from "@effect/atom-react";
import type { AgySwarmMetrics, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon, NetworkIcon, UserPlusIcon } from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { type KeyboardEvent, useId, useState } from "react";

import { cn } from "~/lib/utils";
import { agySwarmEnvironment, useAgySwarm } from "~/state/agySwarm";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SwarmAddWorkerDialog } from "./SwarmAddWorkerDialog";
import { SwarmBoard } from "./SwarmBoard";
import { SwarmGraph } from "./SwarmGraph";
import { SwarmMembers } from "./SwarmMembers";
import { SwarmOverview } from "./SwarmOverview";
import {
  formatTokenCount,
  liveMemberCount,
  NO_POST_FILTER,
  type PostFilter,
} from "./swarmBoard.logic";

const VIEW_LABELS = {
  board: msg("Board", { $context: "swarm tab, the message board" }),
  members: msg("Members", { $context: "swarm tab" }),
  graph: msg("Graph", { $context: "swarm tab, who mentioned whom" }),
  overview: msg("Overview", { $context: "swarm tab, the coordinator's plan" }),
} as const;
type SwarmView = keyof typeof VIEW_LABELS;

const MAX_REMEMBERED_VIEWS = 200;

// The panel unmounts while a member's thread tab is open, so closing that tab would reset it.
const lastViewByThread = new Map<string, SwarmView>();

function rememberView(viewKey: string, view: SwarmView) {
  lastViewByThread.delete(viewKey);
  if (view === "board") return;
  lastViewByThread.set(viewKey, view);
  if (lastViewByThread.size > MAX_REMEMBERED_VIEWS) {
    const oldest = lastViewByThread.keys().next().value;
    if (oldest !== undefined) lastViewByThread.delete(oldest);
  }
}

function SwarmStatus(props: { done: boolean }) {
  if (props.done) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-success-foreground">
        <CheckIcon aria-hidden className="size-3" />
        <T>Done</T>
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-success" />
      <T>Live</T>
    </span>
  );
}

function SwarmMetricsSummary(props: { metrics: AgySwarmMetrics | undefined }) {
  const gt = useGT();
  const { metrics } = props;
  if (!metrics || (metrics.turns === 0 && metrics.totalTokens === 0)) return null;
  const tokensText = formatTokenCount(metrics.totalTokens);
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground" />}
      >
        {metrics.totalTokens > 0 ? (
          <T>
            <Var>{metrics.turns}</Var>t · <Var>{tokensText}</Var>
          </T>
        ) : (
          <T>
            <Var>{metrics.turns}</Var>t
          </T>
        )}
      </TooltipTrigger>
      <TooltipPopup>
        <div className="flex flex-col gap-0.5 text-xs tabular-nums">
          <span>
            {gt("{count, plural, one {{count} turn} other {{count} turns}}", {
              count: metrics.turns,
            })}
          </span>
          {metrics.totalTokens > 0 ? (
            <>
              <span>
                {gt("Total: {tokens} tokens", { tokens: metrics.totalTokens.toLocaleString() })}
              </span>
              <span>
                {gt("Input: {input} · Output: {output}", {
                  input: formatTokenCount(metrics.inputTokens),
                  output: formatTokenCount(metrics.outputTokens),
                })}
              </span>
              {metrics.cachedInputTokens > 0 || metrics.reasoningTokens > 0 ? (
                <span>
                  {gt("Cached: {cached} · Reasoning: {reasoning}", {
                    cached: formatTokenCount(metrics.cachedInputTokens),
                    reasoning: formatTokenCount(metrics.reasoningTokens),
                  })}
                </span>
              ) : null}
            </>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

export function SwarmPanel(props: { threadRef: ScopedThreadRef; environmentId: EnvironmentId }) {
  const gt = useGT();
  const resolve = useMessages();
  const idBase = useId();
  const viewKey = `${props.environmentId}:${props.threadRef.threadId}`;
  const [viewState, setViewState] = useState<{ key: string; view: SwarmView } | null>(null);
  const selectedView =
    viewState?.key === viewKey ? viewState.view : (lastViewByThread.get(viewKey) ?? "board");
  const setView = (next: SwarmView) => {
    rememberView(viewKey, next);
    setViewState({ key: viewKey, view: next });
  };
  // Kept here so a search or filter survives a visit to another tab.
  const [filter, setFilter] = useState<PostFilter>(NO_POST_FILTER);
  const [follow, setFollow] = useState(true);
  const [addWorkerOpen, setAddWorkerOpen] = useState(false);
  const canAddWorker = useAtomValue(agySwarmEnvironment.add.permissionAtom(props.environmentId));
  const { swarm, loaded, error } = useAgySwarm(props.environmentId, props.threadRef.threadId);

  if (swarm === null) {
    if (!loaded && error === null) return null;
    return (
      <Empty size="compact">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <NetworkIcon />
          </EmptyMedia>
          <EmptyTitle>
            {error === null ? gt("No swarm in this conversation") : gt("Couldn't load the swarm")}
          </EmptyTitle>
          <EmptyDescription>
            {error ?? (
              <T>
                Start one with /swarm, /boost or /teamwork. The board appears here once the
                coordinator creates it.
              </T>
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const views: ReadonlyArray<{ key: SwarmView; count: number | null }> = [
    { key: "board", count: swarm.head },
    { key: "members", count: liveMemberCount(swarm.members) },
    { key: "graph", count: null },
    ...(swarm.plan === null ? [] : [{ key: "overview" as const, count: null }]),
  ];
  const view = views.some((entry) => entry.key === selectedView) ? selectedView : "board";
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = views.findIndex((entry) => entry.key === view);
    const next = views[(index + step + views.length) % views.length]!.key;
    setView(next);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)
      ?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="swarm-panel">
      <header className="shrink-0 border-b border-border/60 px-4 pt-3">
        <div className="flex min-h-5 items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {swarm.title}
          </h2>
          <SwarmMetricsSummary metrics={swarm.metrics} />
          <SwarmStatus done={swarm.doneAt !== null} />
          {canAddWorker ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={gt("Add worker")}
                    onClick={() => setAddWorkerOpen(true)}
                  />
                }
              >
                <UserPlusIcon />
              </TooltipTrigger>
              <TooltipPopup>{gt("Add worker")}</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
        <div
          role="tablist"
          aria-label={gt("Swarm views")}
          className="-mb-px mt-1.5 flex gap-4 overflow-x-auto"
        >
          {views.map((entry) => {
            const selected = entry.key === view;
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                id={`${idBase}-tab-${entry.key}`}
                aria-selected={selected}
                aria-controls={`${idBase}-view`}
                tabIndex={selected ? 0 : -1}
                data-view={entry.key}
                onClick={() => setView(entry.key)}
                onKeyDown={onTabKeyDown}
                className={cn(
                  "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-sm border-b-2 px-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  selected
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {resolve(VIEW_LABELS[entry.key])}
                {entry.count === null ? null : (
                  <span className="text-xs font-normal tabular-nums text-muted-foreground">
                    {entry.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>
      <div
        id={`${idBase}-view`}
        role="tabpanel"
        aria-labelledby={`${idBase}-tab-${view}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {view === "board" ? (
          <SwarmBoard
            swarm={swarm}
            threadRef={props.threadRef}
            filter={filter}
            onFilterChange={setFilter}
            follow={follow}
            onFollowChange={setFollow}
          />
        ) : null}
        {view === "members" ? <SwarmMembers swarm={swarm} threadRef={props.threadRef} /> : null}
        {view === "graph" ? <SwarmGraph swarm={swarm} /> : null}
        {view === "overview" && swarm.plan !== null ? (
          <SwarmOverview swarm={swarm} plan={swarm.plan} />
        ) : null}
      </div>
      {canAddWorker ? (
        <SwarmAddWorkerDialog
          open={addWorkerOpen}
          onOpenChange={setAddWorkerOpen}
          swarm={swarm}
          threadRef={props.threadRef}
        />
      ) : null}
    </div>
  );
}
