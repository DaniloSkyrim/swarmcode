import { useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AgySwarmPost, AgySwarmSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import {
  ArrowDownToLineIcon,
  ArrowRightIcon,
  ChevronUpIcon,
  HashIcon,
  InfoIcon,
  ListFilterIcon,
  SearchIcon,
  SendHorizontalIcon,
  TriangleAlertIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { T, useGT, useMessages, Var } from "gt-react";
import { type KeyboardEvent, memo, useRef, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { agySwarmEnvironment } from "~/state/agySwarm";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
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
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SwarmAvatar } from "./SwarmAvatar";
import {
  filterPosts,
  firstUnreadSeq,
  MAIN_CHANNEL,
  memberBee,
  mergePosts,
  NO_POST_FILTER,
  postBody,
  postCue,
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
          {post.from === "user" ? (
            <span
              aria-hidden
              className="-mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-secondary-foreground"
            >
              <UserIcon className="size-3.5" />
            </span>
          ) : (
            <SwarmAvatar bee={props.bee} cue={props.cue} className="-mt-0.5" />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-sm">
              <span className="shrink-0 font-semibold text-foreground">
                {post.from === "user" ? <T>You</T> : `@${post.from}`}
              </span>
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

function BoardComposer(props: {
  swarm: AgySwarmSnapshot;
  threadRef: ScopedThreadRef;
  defaultChannel: string;
  onPosted: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState("");
  const [channelOverride, setChannelOverride] = useState<{
    swarmId: string;
    channel: string;
  } | null>(null);
  const [sending, setSending] = useState(false);

  const postToBoard = useOrchestrationCommand(agySwarmEnvironment.post, {
    label: "post to swarm board",
  });

  const channels = visibleChannels(props.swarm);
  const activeChannel =
    channelOverride?.swarmId === props.swarm.id && channels.includes(channelOverride.channel)
      ? channelOverride.channel
      : channels.includes(props.defaultChannel)
        ? props.defaultChannel
        : MAIN_CHANNEL;

  const insertMention = (token: string) => {
    const prefix = `@${token} `;
    setDraft((current) => {
      if (current.includes(`@${token}`)) return current;
      const trimmed = current.trimStart();
      return trimmed.length === 0 ? prefix : `${prefix}${trimmed}`;
    });
    textareaRef.current?.focus();
  };

  const handleSubmit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    const result = await postToBoard({
      environmentId: props.threadRef.environmentId,
      input: {
        threadId: props.threadRef.threadId,
        text: trimmed,
        channel: activeChannel,
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      toastManager.add({
        type: "error",
        title: gt("Couldn't post to board"),
        description: thrownErrorMessage(squashAtomCommandFailure(result), m) ?? gt("Try again."),
      });
      return;
    }
    setDraft("");
    props.onPosted();
    if (result.value.note) {
      toastManager.add({
        type: "info",
        title: gt("Posted #{seq}", { seq: result.value.seq }),
        description: result.value.note,
      });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void handleSubmit();
  };

  const quickMentions = ["coordinator", "all"];

  return (
    <div className="shrink-0 border-t border-border/60 px-3 pt-2.5 pb-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 overflow-x-auto">
        {channels.length > 1 ? (
          <Menu>
            <MenuTrigger
              render={<Button variant="outline" size="xs" aria-label={gt("Target channel")} />}
            >
              <HashIcon />
              <span>{activeChannel}</span>
            </MenuTrigger>
            <MenuPopup align="start" side="top">
              <MenuRadioGroup
                value={activeChannel}
                onValueChange={(next) =>
                  setChannelOverride({ swarmId: props.swarm.id, channel: String(next) })
                }
              >
                <MenuGroupLabel>
                  <T>Post in channel</T>
                </MenuGroupLabel>
                {channels.map((channel) => (
                  <MenuRadioItem key={channel} value={channel}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">#{channel}</span>
                      <MenuRadioItemIndicator />
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
        ) : null}
        {quickMentions.map((token) => (
          <Button
            key={token}
            type="button"
            variant="outline"
            size="xs"
            disabled={sending}
            onClick={() => insertMention(token)}
          >
            @{token}
          </Button>
        ))}
      </div>
      <div className="flex items-end gap-1.5">
        <div className="min-w-0 flex-1">
          <Textarea
            ref={textareaRef}
            size="sm"
            rows={1}
            value={draft}
            disabled={sending}
            placeholder={gt("Message the board… (@coordinator, @all)")}
            aria-label={gt("Message the board")}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="default"
                size="icon-sm"
                aria-label={gt("Send board message")}
                disabled={sending || draft.trim().length === 0}
                onClick={() => void handleSubmit()}
              />
            }
          >
            <SendHorizontalIcon />
          </TooltipTrigger>
          <TooltipPopup>{gt("Send (Enter)")}</TooltipPopup>
        </Tooltip>
      </div>
    </div>
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
  const m = useMessages();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const listRef = useRef<LegendListRef | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  // Only posts that land while the board is open animate their sender's bee.
  const [openedSeq] = useState(props.swarm.head);
  const [history, setHistory] = useState<{
    swarmId: string;
    posts: ReadonlyArray<AgySwarmPost>;
    hasMore: boolean;
    loading: boolean;
  }>({ swarmId: props.swarm.id, posts: [], hasMore: true, loading: false });

  const canPost = useAtomValue(
    agySwarmEnvironment.post.permissionAtom(props.threadRef.environmentId),
  );
  const loadOlderCommand = useAtomCommand(agySwarmEnvironment.loadPosts, {
    label: "load earlier swarm posts",
  });

  const { filter, onFilterChange } = props;
  const olderPosts = history.swarmId === props.swarm.id ? history.posts : [];
  const historyHasMore = history.swarmId === props.swarm.id ? history.hasMore : true;
  const loadingOlder = history.swarmId === props.swarm.id && history.loading;
  const allPosts = mergePosts(olderPosts, props.swarm.posts);
  const earliestSeq = allPosts[0]?.seq ?? props.swarm.oldestIncludedSeq ?? 0;
  const totalPostCount = props.swarm.totalPostCount ?? props.swarm.posts.length;
  const remainingCount = Math.max(0, totalPostCount - allPosts.length);
  const canLoadEarlier = historyHasMore && earliestSeq > 1 && remainingCount > 0;

  const posts = filterPosts(props.swarm, filter, allPosts);
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

  const handleLoadEarlier = async () => {
    if (!canLoadEarlier || loadingOlder) return;
    const swarmId = props.swarm.id;
    setHistory((current) => ({
      swarmId,
      posts: current.swarmId === swarmId ? current.posts : [],
      hasMore: current.swarmId === swarmId ? current.hasMore : true,
      loading: true,
    }));
    const result = await loadOlderCommand({
      environmentId: props.threadRef.environmentId,
      input: {
        threadId: props.threadRef.threadId,
        beforeSeq: earliestSeq,
        limit: 100,
      },
    });
    if (result._tag === "Failure") {
      setHistory((current) =>
        current.swarmId === swarmId ? { ...current, loading: false } : current,
      );
      if (isAtomCommandInterrupted(result)) return;
      toastManager.add({
        type: "error",
        title: gt("Couldn't load earlier posts"),
        description: thrownErrorMessage(squashAtomCommandFailure(result), m) ?? gt("Try again."),
      });
      return;
    }
    setHistory((current) => ({
      swarmId,
      posts: mergePosts(result.value.posts, current.swarmId === swarmId ? current.posts : []),
      hasMore: result.value.hasMore,
      loading: false,
    }));
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
      {canLoadEarlier ? (
        <div className="flex shrink-0 justify-center px-4 pb-1">
          <Button
            type="button"
            variant="ghost-muted"
            size="xs"
            disabled={loadingOlder}
            onClick={() => void handleLoadEarlier()}
          >
            <ChevronUpIcon />
            {loadingOlder ? (
              <T>Loading earlier posts…</T>
            ) : (
              <T>
                Load earlier posts (<Var>{remainingCount}</Var>)
              </T>
            )}
          </Button>
        </div>
      ) : null}
      {posts.length === 0 ? (
        <Empty size="compact">
          <EmptyHeader>
            <EmptyTitle>
              {allPosts.length === 0 ? <T>No posts yet</T> : <T>No matching posts</T>}
            </EmptyTitle>
            <EmptyDescription>
              {allPosts.length === 0 ? (
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
      {canPost ? (
        <BoardComposer
          swarm={props.swarm}
          threadRef={props.threadRef}
          defaultChannel={filter.channel ?? MAIN_CHANNEL}
          onPosted={() => setFollow(true)}
        />
      ) : null}
    </div>
  );
}
