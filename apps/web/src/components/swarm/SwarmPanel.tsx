import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon, NetworkIcon } from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";
import { type KeyboardEvent, useId, useState } from "react";

import { cn } from "~/lib/utils";
import { useAgySwarm } from "~/state/agySwarm";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SwarmBoard } from "./SwarmBoard";
import { SwarmGraph } from "./SwarmGraph";
import { SwarmMembers } from "./SwarmMembers";
import { SwarmOverview } from "./SwarmOverview";
import { liveMemberCount, NO_POST_FILTER, type PostFilter } from "./swarmBoard.logic";

const VIEW_LABELS = {
  board: msg("Board", { $context: "swarm tab, the message board" }),
  members: msg("Members", { $context: "swarm tab" }),
  graph: msg("Graph", { $context: "swarm tab, who mentioned whom" }),
  overview: msg("Overview", { $context: "swarm tab, the coordinator's plan" }),
} as const;
type SwarmView = keyof typeof VIEW_LABELS;

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

export function SwarmPanel(props: { threadRef: ScopedThreadRef; environmentId: EnvironmentId }) {
  const gt = useGT();
  const resolve = useMessages();
  const idBase = useId();
  const [selectedView, setView] = useState<SwarmView>("board");
  // Kept here so a search or filter survives a visit to another tab.
  const [filter, setFilter] = useState<PostFilter>(NO_POST_FILTER);
  const [follow, setFollow] = useState(true);
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
        <div className="flex min-h-5 items-center gap-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {swarm.title}
          </h2>
          <SwarmStatus done={swarm.doneAt !== null} />
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
    </div>
  );
}
