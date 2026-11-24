import type { AgySwarmPost, AgySwarmSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import {
  ArrowDownToLineIcon,
  ArrowRightIcon,
  InfoIcon,
  ListFilterIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { T, useGT } from "gt-react";
import { memo, useRef, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { formatShortTimestamp } from "~/timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import {
  Menu,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SwarmAvatar } from "./SwarmAvatar";
import {
  filterPosts,
  firstUnreadSeq,
  MAIN_CHANNEL,
  memberBee,
  postCue,
  NO_POST_FILTER,
  postBody,
  visibleChannels,
  type BeeColors,
  type BeeCue,
  type PostFilter,
} from "./swarmBoard.logic";

const CLAMP_CHARS = 360;
const CLAMP_LINES = 6;
const MAINTAIN_SCROLL_AT_END = { animated: false, on: { dataChange: true } } as const;
// Menu radio values cannot be null.
const ANY = "";

function PostMeta(props: { post: AgySwarmPost; timestampFormat: TimestampFormat }) {
  return (
    <span className="ms-auto shrink-0 ps-2 font-mono text-xs tabular-nums text-muted-foreground/80">
      #{props.post.seq} · {formatShortTimestamp(props.post.createdAt, props.timestampFormat)}
    </span>
  );
}

function PostNotice(props: { post: AgySwarmPost; timestampFormat: TimestampFormat }) {
  const gt = useGT();
  const stall = props.post.kind === "stall";
  const Icon = stall ? TriangleAlertIcon : InfoIcon;
  return (
    <div className="flex items-start gap-3 px-4 py-2 text-xs text-muted-foreground">
      <span className="flex size-6 shrink-0 items-center justify-center">
        <Icon
          role="img"
          aria-label={stall ? gt("Stall alert") : gt("Notice")}
          className={cn("size-3.5", stall && "text-warning-foreground")}
        />
      </span>
      <p className="min-w-0 flex-1 self-center whitespace-pre-wrap wrap-anywhere leading-5">
        {props.post.mentions.length > 0 ? (
          <span className="text-muted-foreground/80">
            {props.post.mentions.map((token) => `@${token}`).join(" ")}{" "}
          </span>
        ) : null}
        <span className="text-foreground/80">{postBody(props.post)}</span>
      </p>
      <span className="self-center">
        <PostMeta post={props.post} timestampFormat={props.timestampFormat} />
      </span>
    </div>
  );
}

function PostRowView(props: {
  post: AgySwarmPost;
  bee: BeeColors;
  cue: BeeCue | undefined;
  unreadDivider: boolean;
  expanded: boolean;
  onToggleExpanded: (seq: number) => void;
  timestampFormat: TimestampFormat;
  threadRef: ScopedThreadRef;
}) {
  const { post } = props;
  const body = postBody(post);
  const long = body.length > CLAMP_CHARS || body.split("\n").length > CLAMP_LINES;
  const clamped = long && !props.expanded;
  return (
    <div data-seq={post.seq}>
      {props.unreadDivider ? (
        <div className="flex items-center gap-2 px-4 pt-2 text-xs font-medium text-info-foreground">
          <T>New</T>
          <span aria-hidden className="h-px flex-1 bg-info/40" />
        </div>
      ) : null}
      {post.kind === "system" || post.kind === "stall" ? (
        <PostNotice post={post} timestampFormat={props.timestampFormat} />
      ) : (
        <div className="flex gap-3 px-4 py-2.5">
          <SwarmAvatar bee={props.bee} cue={props.cue} className="-mt-0.5" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-sm">
              <span className="shrink-0 font-semibold text-foreground">@{post.from}</span>
              {post.kind === "brief" ? (
                <Badge variant="outline" size="sm" className="shrink-0">
                  <T>Brief</T>
                </Badge>
              ) : null}
              {post.mentions.length > 0 ? (
                <>
                  <ArrowRightIcon
                    aria-hidden
                    className="size-3 shrink-0 text-muted-foreground/70"
                  />
                  <span className="min-w-0 truncate text-muted-foreground">
                    {post.mentions.map((token) => `@${token}`).join(" ")}
                  </span>
                </>
              ) : null}
              {post.channel === MAIN_CHANNEL ||
              post.mentions.includes(`#${post.channel}`) ? null : (
                <span className="shrink-0 text-xs text-muted-foreground">#{post.channel}</span>
              )}
              <PostMeta post={post} timestampFormat={props.timestampFormat} />
            </div>
            {body ? (
              <div className={cn(clamped && "max-h-32 overflow-hidden mask-b-from-70%")}>
                <ChatMarkdown
                  text={body}
                  cwd={undefined}
                  threadRef={props.threadRef}
                  environmentId={props.threadRef.environmentId}
                  isStreaming={false}
                  headingLevelOffset={3}
                />
              </div>
            ) : null}
            {long ? (
              <Button
                variant="ghost-muted"
                size="xs"
                className="-ms-2 self-start"
                aria-expanded={props.expanded}
                onClick={() => props.onToggleExpanded(post.seq)}
              >
                {props.expanded ? <T>Show less</T> : <T>Show more</T>}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// Posts never change once written, so a new snapshot re-renders only new or re-marked rows.
const PostRow = memo(
  PostRowView,
  (previous, next) =>
    previous.post.seq === next.post.seq &&
    previous.post.text === next.post.text &&
    previous.bee === next.bee &&
    previous.cue?.key === next.cue?.key &&
    previous.unreadDivider === next.unreadDivider &&
    previous.expanded === next.expanded &&
    previous.timestampFormat === next.timestampFormat &&
    previous.threadRef === next.threadRef,
);

function BoardFilterMenu(props: {
  swarm: AgySwarmSnapshot;
  filter: PostFilter;
  onFilterChange: (filter: PostFilter) => void;
}) {
  const gt = useGT();
  const channels = visibleChannels(props.swarm);
  const active = (props.filter.member === null ? 0 : 1) + (props.filter.channel === null ? 0 : 1);
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={gt("Filter posts")}
                  className="relative"
                />
              }
            />
          }
        >
          <ListFilterIcon />
          {active > 0 ? (
            <span aria-hidden className="absolute top-1 end-1 size-1.5 rounded-full bg-info" />
          ) : null}
        </TooltipTrigger>
        <TooltipPopup>{gt("Filter posts")}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="max-h-96">
        <MenuRadioGroup
          value={props.filter.member ?? ANY}
          onValueChange={(next) =>
            props.onFilterChange({ ...props.filter, member: next === ANY ? null : String(next) })
          }
        >
          <MenuGroupLabel>
            <T>From or to</T>
          </MenuGroupLabel>
          <MenuRadioItem value={ANY}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                <T>Everyone</T>
              </span>
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
          {props.swarm.members.map((member) => (
            <MenuRadioItem key={member.name} value={member.name}>
              <span className="flex min-w-0 items-center gap-2">
                <SwarmAvatar bee={memberBee(props.swarm.members, member.name)} size="sm" />
                <span className="min-w-0 flex-1 truncate">{member.name}</span>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {channels.length > 1 ? (
          <>
            <MenuSeparator />
            <MenuRadioGroup
              value={props.filter.channel ?? ANY}
              onValueChange={(next) =>
                props.onFilterChange({
                  ...props.filter,
                  channel: next === ANY ? null : String(next),
                })
              }
            >
              <MenuGroupLabel>
                <T>Channel</T>
              </MenuGroupLabel>
              <MenuRadioItem value={ANY}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    <T>All channels</T>
                  </span>
                  <MenuRadioItemIndicator />
                </span>
              </MenuRadioItem>
              {channels.map((channel) => (
                <MenuRadioItem key={channel} value={channel}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">#{channel}</span>
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

export function SwarmBoard(props: {
  swarm: AgySwarmSnapshot;
  threadRef: ScopedThreadRef;
  filter: PostFilter;
  onFilterChange: (filter: PostFilter) => void;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}) {
  const gt = useGT();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const listRef = useRef<LegendListRef | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  // Only posts that land while the board is open animate their sender's bee.
  const [openedSeq] = useState(props.swarm.head);
  const { filter, onFilterChange } = props;
  const posts = filterPosts(props.swarm, filter);
  const unreadSeq = firstUnreadSeq(props.swarm, props.threadRef.threadId, posts);
  const scoped = filter.member !== null || filter.channel !== null;
  const toggleExpanded = (seq: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(seq)) next.add(seq);
      return next;
    });
  const setFollow = (follow: boolean) => {
    props.onFollowChange(follow);
    if (follow) void listRef.current?.scrollToEnd({ animated: false });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-4 pt-3 pb-2">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={filter.query}
            placeholder={gt("Search")}
            aria-label={gt("Search posts")}
            onChange={(event) => onFilterChange({ ...filter, query: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !event.currentTarget.value) return;
              event.stopPropagation();
              onFilterChange({ ...filter, query: "" });
            }}
          />
        </InputGroup>
        <BoardFilterMenu swarm={props.swarm} filter={filter} onFilterChange={onFilterChange} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                size="sm"
                pressed={props.follow}
                onPressedChange={setFollow}
                aria-label={gt("Follow new posts")}
              />
            }
          >
            <ArrowDownToLineIcon />
          </TooltipTrigger>
          <TooltipPopup>
            {props.follow ? gt("Following new posts") : gt("Follow new posts")}
          </TooltipPopup>
        </Tooltip>
      </div>
      {scoped ? (
        <div className="flex shrink-0 items-center gap-1.5 px-4 pb-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {filter.member !== null && filter.channel !== null
              ? gt("From or to @{member} in #{channel}", {
                  member: filter.member,
                  channel: filter.channel,
                })
              : filter.member !== null
                ? gt("From or to @{member}", { member: filter.member })
                : gt("In #{channel}", { channel: filter.channel })}
          </span>
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={gt("Clear filters")}
            onClick={() => onFilterChange({ ...NO_POST_FILTER, query: filter.query })}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      {posts.length === 0 ? (
        <Empty size="compact">
          <EmptyHeader>
            <EmptyTitle>
              {props.swarm.posts.length === 0 ? <T>No posts yet</T> : <T>No matching posts</T>}
            </EmptyTitle>
            <EmptyDescription>
              {props.swarm.posts.length === 0 ? (
                <T>Posts show up here as the agents write them.</T>
              ) : (
                <T>Try another search or filter.</T>
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <LegendList<AgySwarmPost>
          key={`${filter.member ?? ""}|${filter.channel ?? ""}`}
          ref={listRef}
          data={posts}
          extraData={{ unreadSeq, expanded, timestampFormat }}
          keyExtractor={(post) => String(post.seq)}
          renderItem={({ item }) => (
            <PostRow
              post={item}
              bee={memberBee(props.swarm.members, item.from)}
              cue={postCue(item, openedSeq)}
              unreadDivider={item.seq === unreadSeq}
              expanded={expanded.has(item.seq)}
              onToggleExpanded={toggleExpanded}
              timestampFormat={timestampFormat}
              threadRef={props.threadRef}
            />
          )}
          estimatedItemSize={72}
          drawDistance={480}
          initialScrollAtEnd
          maintainScrollAtEnd={props.follow ? MAINTAIN_SCROLL_AT_END : false}
          maintainScrollAtEndThreshold={0.1}
          className="min-h-0 flex-1 overscroll-contain pb-2"
        />
      )}
    </div>
  );
}
