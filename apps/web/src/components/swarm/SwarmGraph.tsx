import type { AgySwarmSnapshot } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTimingCopy";
import {
  ChevronFirstIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PauseIcon,
  PlayIcon,
} from "lucide-react";
import { T, useGT, useMessages } from "gt-react";
import { type ReactNode, useEffect, useId, useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { BeeSprite } from "./SwarmAvatar";
import {
  graphFrame,
  layoutGraph,
  memberBee,
  postCue,
  postsSpanMs,
  type GraphNode,
} from "./swarmBoard.logic";

const WIDTH = 400;
const HEIGHT = 280;
const NODE_HEIGHT = 24;
const MAX_LABEL = 16;
const STEP_MS = 700;

const label = (name: string) =>
  name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 1)}…` : name;
// 12px medium text runs about 7px a character; the bee and padding add the rest.
const nodeHalfWidth = (name: string) => (label(name).length * 7 + 34) / 2;

/** Where a ray from the node's center toward (dx, dy) leaves its pill, plus a small gap. */
function exitPoint(node: GraphNode, dx: number, dy: number, gap: number) {
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const halfWidth = nodeHalfWidth(node.member.name);
  const halfHeight = NODE_HEIGHT / 2;
  const t =
    Math.min(
      Math.abs(ux) < 1e-6 ? Infinity : halfWidth / Math.abs(ux),
      Math.abs(uy) < 1e-6 ? Infinity : halfHeight / Math.abs(uy),
    ) + gap;
  return { x: node.x + ux * t, y: node.y + uy * t };
}

function LegendItem(props: { glyph: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg aria-hidden viewBox="0 0 24 12" className="h-3 w-6 shrink-0 overflow-visible">
        {props.glyph}
      </svg>
      {props.children}
    </span>
  );
}

function GraphSwitch(props: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
      <Switch size="sm" checked={props.checked} onCheckedChange={props.onCheckedChange} />
      {props.children}
    </label>
  );
}

export function SwarmGraph(props: { swarm: AgySwarmSnapshot }) {
  const gt = useGT();
  const resolve = useMessages();
  const markerId = useId();
  // Null follows the board live; a number replays the first `position` posts.
  const [position, setPosition] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [hideInactive, setHideInactive] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [openedSeq] = useState(props.swarm.head);
  const total = props.swarm.posts.length;
  const shown = position === null ? total : Math.min(position, total);
  const live = position === null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- replay steps on a timer only while playing, and stops at the latest post
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (shown >= total) {
        setPlaying(false);
        setPosition(null);
      } else {
        setPosition(shown + 1);
      }
    }, STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, shown, total]);

  const posts = props.swarm.posts.slice(0, shown);
  const frame = graphFrame(props.swarm.members, posts, expandAll);
  const members = props.swarm.members.filter((member) =>
    hideInactive
      ? frame.active.has(member.name)
      : member.state !== "killed" || frame.active.has(member.name),
  );
  const nodes = layoutGraph(members, WIDTH, HEIGHT);
  const positions = new Map(nodes.map((node) => [node.member.name, node]));
  const edges = frame.edges.filter((edge) => positions.has(edge.from) && positions.has(edge.to));
  const allPostCount = [...frame.allPosts.values()].reduce((sum, count) => sum + count, 0);
  const spanMs = postsSpanMs(posts);
  // The latest post's sender flaps: each replay step, or a live post that landed while open.
  const latest = posts.at(-1);
  const latestCue = latest && postCue(latest, live ? openedSeq : -1);

  const play = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (live || shown >= total) setPosition(0);
    setPlaying(true);
  };
  const seek = (next: number) => {
    setPlaying(false);
    setPosition(Math.max(0, Math.min(next, total)));
  };

  return (
    <div className="scrollbar-gutter-both flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      <div className="flex shrink-0 flex-col gap-2 px-4 pt-3">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={gt("Jump to the first post")}
            disabled={shown === 0}
            onClick={() => seek(0)}
          >
            <ChevronFirstIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={gt("Step back")}
            disabled={shown === 0}
            onClick={() => seek(shown - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={playing ? gt("Pause replay") : gt("Replay posts")}
            disabled={total === 0}
            onClick={play}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={gt("Step forward")}
            disabled={live || shown >= total}
            onClick={() => seek(shown + 1)}
          >
            <ChevronRightIcon />
          </Button>
          <input
            type="range"
            min={0}
            max={total}
            step={1}
            value={shown}
            disabled={total === 0}
            aria-label={gt("Replay position")}
            aria-valuetext={gt("Post {shown} of {total}", { shown, total })}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            className="mx-2 h-1 min-w-0 flex-1 cursor-pointer accent-foreground disabled:cursor-default"
          />
          <Button
            variant={live ? "ghost" : "ghost-muted"}
            size="xs"
            aria-pressed={live}
            onClick={() => {
              setPlaying(false);
              setPosition(null);
            }}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                live ? "bg-success" : "border border-muted-foreground/60",
              )}
            />
            <T>Live</T>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="me-auto text-xs text-muted-foreground">
            {spanMs > 0
              ? gt("{count, plural, one {{count} post} other {{count} posts}} over {duration}", {
                  count: shown,
                  duration: formatDuration(spanMs, resolve),
                })
              : gt("{count, plural, one {{count} post} other {{count} posts}}", { count: shown })}
          </span>
          <GraphSwitch checked={hideInactive} onCheckedChange={setHideInactive}>
            <T>Hide inactive</T>
          </GraphSwitch>
          <GraphSwitch checked={expandAll} onCheckedChange={setExpandAll}>
            <T>Expand @all</T>
          </GraphSwitch>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={gt("Who mentioned whom in this swarm")}
        className="mx-auto mt-2 w-full max-w-xl shrink-0 overflow-visible px-4"
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d="M0 0.5 L8 4 L0 7.5 Z" className="fill-muted-foreground" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const from = positions.get(edge.from)!;
          const to = positions.get(edge.to)!;
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          // Bend each direction to its own side so a reply does not hide the mention.
          const cx = (from.x + to.x) / 2 - dy * 0.15;
          const cy = (from.y + to.y) / 2 + dx * 0.15;
          const start = exitPoint(from, cx - from.x, cy - from.y, 3);
          const end = exitPoint(to, cx - to.x, cy - to.y, 5);
          const labelX = 0.25 * start.x + 0.5 * cx + 0.25 * end.x;
          const labelY = 0.25 * start.y + 0.5 * cy + 0.25 * end.y;
          return (
            <g key={`${edge.from}>${edge.to}`}>
              <path
                d={`M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`}
                fill="none"
                strokeWidth={1 + Math.min(edge.count, 6) * 0.5}
                strokeLinecap="round"
                strokeDasharray={edge.viaAll ? "4 3" : undefined}
                markerEnd={`url(#${CSS.escape(markerId)})`}
                className="stroke-muted-foreground/60"
              />
              {edge.count > 1 ? (
                <text
                  x={labelX}
                  y={labelY}
                  dy="-0.4em"
                  textAnchor="middle"
                  className="fill-muted-foreground text-3xs tabular-nums"
                >
                  {edge.count}
                </text>
              ) : null}
            </g>
          );
        })}
        {nodes.map((node) => {
          const { member, x, y } = node;
          const halfWidth = nodeHalfWidth(member.name);
          const allCount = expandAll ? 0 : (frame.allPosts.get(member.name) ?? 0);
          const inactive = !frame.active.has(member.name);
          return (
            <g key={member.name} className={cn(inactive && "opacity-50")}>
              {frame.unaddressed.has(member.name) ? (
                <rect
                  x={x - halfWidth - 3.5}
                  y={y - NODE_HEIGHT / 2 - 3.5}
                  width={halfWidth * 2 + 7}
                  height={NODE_HEIGHT + 7}
                  rx={(NODE_HEIGHT + 7) / 2}
                  fill="none"
                  strokeDasharray="2 2"
                  className="stroke-muted-foreground/70"
                />
              ) : null}
              <rect
                x={x - halfWidth}
                y={y - NODE_HEIGHT / 2}
                width={halfWidth * 2}
                height={NODE_HEIGHT}
                rx={NODE_HEIGHT / 2}
                className={cn(
                  "fill-background",
                  member.state === "working" ? "stroke-info" : "stroke-border",
                )}
              />
              <BeeSprite
                bee={memberBee(props.swarm.members, member.name)}
                cue={latest?.from === member.name ? latestCue : undefined}
                working={member.state === "working"}
                x={x - halfWidth + 8}
                y={y - 5}
                width={12}
              />
              <text
                x={x - halfWidth + 24}
                y={y}
                dominantBaseline="central"
                className="fill-foreground text-xs font-medium"
              >
                {label(member.name)}
              </text>
              {allCount > 0 ? (
                <text
                  x={x + halfWidth + 6}
                  y={y}
                  dominantBaseline="central"
                  className="fill-muted-foreground font-mono text-3xs"
                >
                  @all {allCount}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1.5 px-4 pt-2 pb-4 text-xs text-muted-foreground">
        <LegendItem
          glyph={
            <path
              d="M1 6 H22"
              strokeWidth={1.5}
              markerEnd={`url(#${CSS.escape(markerId)})`}
              className="stroke-muted-foreground/60"
            />
          }
        >
          <T>@mention, width = count</T>
        </LegendItem>
        <LegendItem
          glyph={
            <path
              d="M1 6 H22"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              markerEnd={`url(#${CSS.escape(markerId)})`}
              className="stroke-muted-foreground/60"
            />
          }
        >
          <T>via @all</T>
        </LegendItem>
        <LegendItem
          glyph={
            <rect
              x={3}
              y={1}
              width={18}
              height={10}
              rx={5}
              fill="none"
              strokeDasharray="2 2"
              className="stroke-muted-foreground/70"
            />
          }
        >
          <T>posted with no mention</T>
        </LegendItem>
        {allPostCount > 0 && !expandAll ? (
          <span className="flex items-center gap-1.5">
            <span className="rounded-sm bg-muted px-1 font-mono text-3xs tabular-nums">
              @all {allPostCount}
            </span>
            <T>@all posts, drawn by Expand @all</T>
          </span>
        ) : null}
      </div>
    </div>
  );
}
