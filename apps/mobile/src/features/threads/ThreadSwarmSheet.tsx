// Fork: interactive mobile swarm board sheet (Board, Members, Overview, and Add Worker).
import { useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  AgySwarmBoostRoundStatus,
  AgySwarmGateStatus,
  AgySwarmIntegrityMode,
  AgySwarmMember,
  AgySwarmMemberState,
  AgySwarmMilestoneStatus,
  AgySwarmPost,
  AgySwarmSnapshot,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { msg, T, useGT, useMessages, Var } from "gt-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import * as Dialog from "../../components/ui/Dialog";
import { IconButton } from "../../components/ui/IconButton";
import { KeyboardSheetBody } from "../../components/ui/KeyboardSheetBody";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { cn } from "../../lib/cn";
import { agySwarmEnvironment, useAgySwarm } from "../../state/agySwarm";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOpenThreadInspector } from "./thread-inspector-navigation";

type SwarmTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };
type SwarmTab = "board" | "members" | "overview";

const VALID_MEMBER_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/u;
const LEADING_MENTION = /^\s*@(#?[a-z][a-z0-9_-]*)[\s,:]*/u;

const MEMBER_STATE_LABELS = {
  working: msg("Working", { $context: "swarm member state" }),
  waiting: msg("Waiting", { $context: "swarm member state" }),
  "needs-input": msg("Needs input", { $context: "swarm member state" }),
  stopped: msg("Stopped", { $context: "swarm member state" }),
  killed: msg("Retired", { $context: "swarm member state" }),
} as const satisfies Record<AgySwarmMemberState, string>;

const INTEGRITY_LABELS = {
  development: msg("Development", { $context: "teamwork integrity mode" }),
  demo: msg("Demo", { $context: "teamwork integrity mode" }),
  benchmark: msg("Benchmark", { $context: "teamwork integrity mode" }),
} as const satisfies Record<AgySwarmIntegrityMode, string>;

const MILESTONE_LABELS = {
  pending: msg("Pending", { $context: "teamwork milestone status" }),
  in_progress: msg("In progress", { $context: "teamwork milestone status" }),
  verifying: msg("Verifying", { $context: "teamwork milestone status" }),
  passed: msg("Passed", { $context: "teamwork milestone status" }),
  blocked: msg("Blocked", { $context: "teamwork milestone status" }),
} as const satisfies Record<AgySwarmMilestoneStatus, string>;

const GATE_LABELS = {
  pending: msg("pending", { $context: "milestone review gate status" }),
  running: msg("running", { $context: "milestone review gate status" }),
  passed: msg("passed", { $context: "milestone review gate status" }),
  failed: msg("failed", { $context: "milestone review gate status" }),
} as const satisfies Record<AgySwarmGateStatus, string>;

const ROUND_LABELS = {
  running: msg("Running", { $context: "boost round status" }),
  fixed: msg("Fixed", { $context: "boost round status" }),
  clean: msg("Clean", { $context: "boost round status" }),
  blocked: msg("Blocked", { $context: "boost round status" }),
} as const satisfies Record<AgySwarmBoostRoundStatus, string>;

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(Math.max(0, Math.round(tokens)));
  if (tokens < 10_000) {
    const tenths = Math.round(tokens / 100) / 10;
    return `${tenths.toFixed(1).replace(/\.0$/u, "")}k`;
  }
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  const tenths = Math.round(tokens / 100_000) / 10;
  return `${tenths.toFixed(1).replace(/\.0$/u, "")}M`;
}

function mergePosts(
  older: ReadonlyArray<AgySwarmPost>,
  live: ReadonlyArray<AgySwarmPost>,
): ReadonlyArray<AgySwarmPost> {
  if (older.length === 0) return live;
  const bySeq = new Map<number, AgySwarmPost>();
  for (const post of older) bySeq.set(post.seq, post);
  for (const post of live) bySeq.set(post.seq, post);
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

function stripLeadingMentions(post: AgySwarmPost): string {
  let text = post.text;
  for (;;) {
    const match = LEADING_MENTION.exec(text);
    if (match === null || !post.mentions.includes(match[1]!)) break;
    text = text.slice(match[0].length);
  }
  if (post.kind === "stall") text = text.replace(/^\[stall\]\s*/u, "");
  return text.trim();
}

function isDirtyWorktreeError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /uncommitted changes|force\s*:\s*true/iu.test(message);
}

function parseOwnedPaths(raw: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of raw.split(/[,\n]/u)) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    items.push(trimmed);
  }
  return items;
}

export function ThreadSwarmSheet({ route }: StaticScreenProps<SwarmTarget>) {
  const target = route.params;
  const navigation = useNavigation();
  const openInspector = useOpenThreadInspector();
  const gt = useGT();
  const resolve = useMessages();
  const { swarm, loaded, error } = useAgySwarm(target.environmentId, target.threadId);
  const [selectedTab, setSelectedTab] = useState<SwarmTab>("board");
  const [addingWorker, setAddingWorker] = useState(false);

  const canPost = useAtomValue(agySwarmEnvironment.post.permissionAtom(target.environmentId));
  const canRetry = useAtomValue(agySwarmEnvironment.retry.permissionAtom(target.environmentId));
  const canKill = useAtomValue(agySwarmEnvironment.kill.permissionAtom(target.environmentId));
  const canAdd = useAtomValue(agySwarmEnvironment.add.permissionAtom(target.environmentId));

  const openMemberThread = (member: AgySwarmMember) => {
    void Haptics.selectionAsync();
    if (
      openInspector(target, {
        type: "thread",
        environmentId: target.environmentId,
        threadId: member.threadId,
      })
    ) {
      return;
    }
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: target.environmentId,
        threadId: member.threadId,
      }),
    );
  };

  const title = swarm?.title.trim() ? swarm.title : gt("Swarm");
  const subtitle = (() => {
    if (swarm === null) return undefined;
    const parts: string[] = [];
    if (swarm.kind === "boost") parts.push(gt("Boost"));
    else if (swarm.kind === "teamwork") parts.push(gt("Teamwork"));
    parts.push(swarm.doneAt !== null ? gt("Done") : gt("Live"));
    const metrics = swarm.metrics;
    if (metrics && (metrics.turns > 0 || metrics.totalTokens > 0)) {
      parts.push(`${metrics.turns}t`);
      if (metrics.totalTokens > 0) parts.push(formatTokens(metrics.totalTokens));
    }
    return parts.join(" · ");
  })();

  if (addingWorker && swarm !== null) {
    return (
      <View collapsable={false} className="flex-1 bg-sheet">
        <SheetHeader
          title={gt("Add worker")}
          subtitle={title}
          onCancel={() => setAddingWorker(false)}
        />
        <ScreenContent>
          <AddWorkerForm
            target={target}
            swarm={swarm}
            onDone={() => setAddingWorker(false)}
            onCancel={() => setAddingWorker(false)}
          />
        </ScreenContent>
      </View>
    );
  }

  const overviewProgress = (() => {
    const milestones = swarm?.plan?.milestones ?? [];
    if (milestones.length > 0) {
      const passed = milestones.filter((milestone) => milestone.status === "passed").length;
      return ` (${passed}/${milestones.length})`;
    }
    const rounds = swarm?.plan?.rounds ?? [];
    if (rounds.length > 0) return ` (${rounds.length})`;
    return "";
  })();

  const tabOptions: Array<{ readonly value: SwarmTab; readonly label: string }> = [
    {
      value: "board",
      label: swarm ? `${gt("Board")} (${swarm.head})` : gt("Board"),
    },
    {
      value: "members",
      label: swarm
        ? `${gt("Members")} (${swarm.members.filter((m) => m.state !== "killed").length})`
        : gt("Members"),
    },
    ...(swarm?.plan
      ? [{ value: "overview" as const, label: `${gt("Overview")}${overviewProgress}` }]
      : []),
  ];
  const activeTab: SwarmTab = tabOptions.some((option) => option.value === selectedTab)
    ? selectedTab
    : "board";

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader
        title={title}
        subtitle={subtitle}
        onClose={() => navigation.goBack()}
        actions={
          swarm !== null && canAdd
            ? [
                {
                  icon: "person.badge.plus",
                  accessibilityLabel: gt("Add worker"),
                  onPress: () => setAddingWorker(true),
                },
              ]
            : undefined
        }
      />
      <ScreenContent>
        {swarm === null ? (
          <View className="flex-1 items-center justify-center px-6">
            <Text className="text-center text-sm text-foreground-muted">
              {!loaded && error === null ? (
                <T>Loading swarm…</T>
              ) : (
                (error ?? <T>No swarm in this conversation.</T>)
              )}
            </Text>
          </View>
        ) : activeTab === "board" ? (
          <MobileSwarmBoard
            target={target}
            swarm={swarm}
            canPost={canPost}
            tabHeader={
              <View className="pb-3">
                <SegmentedControl
                  options={tabOptions}
                  selected={activeTab}
                  onSelect={setSelectedTab}
                  role="tab"
                  size="compact"
                />
              </View>
            }
          />
        ) : activeTab === "members" ? (
          <MobileSwarmMembers
            target={target}
            swarm={swarm}
            canRetry={canRetry}
            canKill={canKill}
            resolveStateLabel={(state) => resolve(MEMBER_STATE_LABELS[state])}
            onOpenMember={openMemberThread}
            tabHeader={
              <View className="pb-3">
                <SegmentedControl
                  options={tabOptions}
                  selected={activeTab}
                  onSelect={setSelectedTab}
                  role="tab"
                  size="compact"
                />
              </View>
            }
          />
        ) : (
          <MobileSwarmOverview
            swarm={swarm}
            tabHeader={
              <View className="pb-3">
                <SegmentedControl
                  options={tabOptions}
                  selected={activeTab}
                  onSelect={setSelectedTab}
                  role="tab"
                  size="compact"
                />
              </View>
            }
          />
        )}
      </ScreenContent>
    </View>
  );
}

function MobileSwarmBoard(props: {
  readonly target: SwarmTarget;
  readonly swarm: AgySwarmSnapshot;
  readonly canPost: boolean;
  readonly tabHeader: React.ReactNode;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<{
    swarmId: string;
    posts: ReadonlyArray<AgySwarmPost>;
    hasMore: boolean;
    loading: boolean;
  }>({ swarmId: props.swarm.id, posts: [], hasMore: true, loading: false });

  const postToBoard = useAtomCommand(agySwarmEnvironment.post, {
    label: "post to swarm board",
    reportFailure: false,
  });
  const loadOlderCommand = useAtomCommand(agySwarmEnvironment.loadPosts, {
    label: "load earlier swarm posts",
    reportFailure: false,
  });

  const olderPosts = history.swarmId === props.swarm.id ? history.posts : [];
  const historyHasMore = history.swarmId === props.swarm.id ? history.hasMore : true;
  const loadingOlder = history.swarmId === props.swarm.id && history.loading;
  const allPosts = mergePosts(olderPosts, props.swarm.posts);
  const earliestSeq = allPosts[0]?.seq ?? props.swarm.oldestIncludedSeq ?? 0;
  const totalPostCount = props.swarm.totalPostCount ?? props.swarm.posts.length;
  const remainingCount = Math.max(0, totalPostCount - allPosts.length);
  const canLoadEarlier = historyHasMore && earliestSeq > 1 && remainingCount > 0;

  const insertMention = (token: string) => {
    const prefix = `@${token} `;
    setDraft((current) => {
      if (current.includes(`@${token}`)) return current;
      const trimmed = current.trimStart();
      return trimmed.length === 0 ? prefix : `${prefix}${trimmed}`;
    });
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
      environmentId: props.target.environmentId,
      input: {
        threadId: props.target.threadId,
        beforeSeq: earliestSeq,
        limit: 100,
      },
    });
    if (result._tag === "Failure") {
      setHistory((current) =>
        current.swarmId === swarmId ? { ...current, loading: false } : current,
      );
      if (isAtomCommandInterrupted(result)) return;
      Dialog.alert(
        gt("Couldn't load earlier posts"),
        thrownErrorMessage(squashAtomCommandFailure(result), resolve) ?? gt("Try again."),
      );
      return;
    }
    setHistory((current) => ({
      swarmId,
      posts: mergePosts(result.value.posts, current.swarmId === swarmId ? current.posts : []),
      hasMore: result.value.hasMore,
      loading: false,
    }));
  };

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    const result = await postToBoard({
      environmentId: props.target.environmentId,
      input: {
        threadId: props.target.threadId,
        text: trimmed,
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      Dialog.alert(
        gt("Couldn't post to board"),
        thrownErrorMessage(squashAtomCommandFailure(result), resolve) ?? gt("Try again."),
      );
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDraft("");
    if (result.value.note) {
      Dialog.alert(gt("Posted #{seq}", { seq: result.value.seq }), result.value.note);
    }
  };

  const toolbar = props.canPost ? (
    <View className="flex-1 gap-2">
      <View className="flex-row items-center gap-1.5">
        <Chip
          size="small"
          label="@coordinator"
          disabled={sending}
          onPress={() => insertMention("coordinator")}
        />
        <Chip size="small" label="@all" disabled={sending} onPress={() => insertMention("all")} />
      </View>
      <View className="flex-row items-end gap-2">
        <TextInput
          multiline
          value={draft}
          editable={!sending}
          placeholder={gt("Message the board…")}
          accessibilityLabel={gt("Message the board")}
          onChangeText={setDraft}
          className="max-h-28 min-h-10 flex-1 py-2"
        />
        <IconButton
          icon="arrow.up"
          accessibilityLabel={gt("Send board message")}
          disabled={sending || draft.trim().length === 0}
          onPress={() => void handleSend()}
        />
      </View>
    </View>
  ) : undefined;

  return (
    <KeyboardSheetBody toolbar={toolbar}>
      {props.tabHeader}
      <ScrollView
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        className="flex-1"
        contentContainerClassName="gap-2.5 pb-4"
      >
        {canLoadEarlier ? (
          <View className="items-center pb-1">
            <Button
              size="compact"
              tone="text"
              loading={loadingOlder}
              label={
                loadingOlder
                  ? gt("Loading earlier posts…")
                  : gt("Load earlier posts ({count})", { count: remainingCount })
              }
              onPress={() => void handleLoadEarlier()}
            />
          </View>
        ) : null}
        {allPosts.length === 0 ? (
          <Text className="pt-8 text-center text-sm text-foreground-muted">
            <T>No posts yet. Posts appear here as members coordinate.</T>
          </Text>
        ) : (
          allPosts.map((post) => {
            const body = stripLeadingMentions(post);
            const isNotice = post.kind === "system" || post.kind === "stall";
            if (isNotice) {
              return (
                <View
                  key={post.seq}
                  className="flex-row items-start gap-2 rounded-xl bg-subtle/60 px-3 py-2"
                >
                  <SymbolView
                    name={post.kind === "stall" ? "exclamationmark.triangle" : "info.circle"}
                    size={14}
                    tintColorClassName={
                      post.kind === "stall"
                        ? "accent-warning-foreground"
                        : "accent-foreground-muted"
                    }
                  />
                  <Text className="min-w-0 flex-1 text-xs text-foreground-muted">
                    {post.mentions.length > 0
                      ? `${post.mentions.map((token) => `@${token}`).join(" ")} `
                      : ""}
                    {body}
                  </Text>
                  <Text className="shrink-0 font-mono text-xs tabular-nums text-foreground-muted">
                    #{post.seq}
                  </Text>
                </View>
              );
            }
            return (
              <View key={post.seq} className="gap-1 rounded-2xl bg-subtle px-3.5 py-2.5">
                <View className="flex-row items-center gap-1.5">
                  <Text className="text-xs font-t3-bold text-foreground">
                    {post.from === "user" ? gt("You") : `@${post.from}`}
                  </Text>
                  {post.mentions.length > 0 ? (
                    <Text
                      numberOfLines={1}
                      className="min-w-0 flex-1 text-xs text-foreground-muted"
                    >
                      → {post.mentions.map((token) => `@${token}`).join(" ")}
                    </Text>
                  ) : (
                    <View className="flex-1" />
                  )}
                  {post.channel !== "main" ? (
                    <Text className="text-xs text-foreground-muted">#{post.channel}</Text>
                  ) : null}
                  <Text className="font-mono text-xs tabular-nums text-foreground-muted">
                    #{post.seq}
                  </Text>
                </View>
                {body ? (
                  <Text selectable className="text-sm text-foreground">
                    {body}
                  </Text>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </KeyboardSheetBody>
  );
}

function MobileSwarmMembers(props: {
  readonly target: SwarmTarget;
  readonly swarm: AgySwarmSnapshot;
  readonly canRetry: boolean;
  readonly canKill: boolean;
  readonly resolveStateLabel: (state: AgySwarmMemberState) => string;
  readonly onOpenMember: (member: AgySwarmMember) => void;
  readonly tabHeader: React.ReactNode;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const insets = useSafeAreaInsets();
  const [busyName, setBusyName] = useState<string | null>(null);
  const [retiredExpanded, setRetiredExpanded] = useState(false);

  const retryMember = useAtomCommand(agySwarmEnvironment.retry, {
    label: "retry swarm member",
    reportFailure: false,
  });
  const killMember = useAtomCommand(agySwarmEnvironment.kill, {
    label: "retire swarm worker",
    reportFailure: false,
  });

  const live = props.swarm.members.filter((member) => member.state !== "killed");
  const retired = props.swarm.members.filter((member) => member.state === "killed");

  const handleRetry = async (member: AgySwarmMember) => {
    if (busyName !== null) return;
    setBusyName(member.name);
    const result = await retryMember({
      environmentId: props.target.environmentId,
      input: { threadId: props.target.threadId, name: member.name },
    });
    setBusyName(null);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      Dialog.alert(
        gt("Couldn't wake @{member}", { member: member.name }),
        thrownErrorMessage(squashAtomCommandFailure(result), resolve) ?? gt("Try again."),
      );
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const executeKill = async (member: AgySwarmMember, force: boolean) => {
    setBusyName(member.name);
    const result = await killMember({
      environmentId: props.target.environmentId,
      input: {
        threadId: props.target.threadId,
        name: member.name,
        ...(force ? { force: true } : {}),
      },
    });
    setBusyName(null);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const message = thrownErrorMessage(squashAtomCommandFailure(result), resolve);
      if (!force && isDirtyWorktreeError(message)) {
        Dialog.confirm({
          title: gt("Discard uncommitted changes for @{member}?", { member: member.name }),
          message: message ?? gt("This worktree has uncommitted changes."),
          confirmText: gt("Force retire"),
          destructive: true,
          onConfirm: () => void executeKill(member, true),
        });
        return;
      }
      Dialog.alert(
        gt("Couldn't retire @{member}", { member: member.name }),
        message ?? gt("Try again."),
      );
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const confirmKill = (member: AgySwarmMember) => {
    if (busyName !== null) return;
    Dialog.confirm({
      title: gt("Retire @{member}?", { member: member.name }),
      message:
        member.workspace === "worktree"
          ? gt("This stops the worker permanently and removes its isolated worktree if clean.")
          : gt("This stops the worker permanently. Its conversation history stays readable."),
      confirmText: gt("Retire"),
      destructive: true,
      onConfirm: () => void executeKill(member, false),
    });
  };

  const renderMember = (member: AgySwarmMember) => {
    const isLive = member.state !== "killed";
    const isCurrent = member.threadId === props.target.threadId;
    const showRetry =
      isLive && props.canRetry && (member.state === "stopped" || member.state === "waiting");
    const showKill = isLive && props.canKill && member.role !== "coordinator";
    const branchLabel = member.branch ?? (member.workspace === "worktree" ? gt("worktree") : null);
    const owns = member.owns ?? [];
    const metrics = member.metrics;
    const hasMetrics = metrics !== undefined && (metrics.turns > 0 || metrics.totalTokens > 0);

    return (
      <View
        key={member.name}
        className={cn(
          "flex-row items-center gap-2 border-b border-border py-3",
          !isLive && "opacity-65",
        )}
      >
        <Pressable
          disabled={isCurrent}
          accessibilityRole={isCurrent ? undefined : "link"}
          onPress={() => props.onOpenMember(member)}
          className="min-w-0 flex-1 gap-1 active:opacity-70"
        >
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Text numberOfLines={1} className="shrink text-sm font-t3-bold text-foreground">
              @{member.name}
            </Text>
            {member.canManage && member.role !== "coordinator" ? (
              <View className="rounded-md bg-subtle px-1.5 py-0.5">
                <Text className="text-[11px] font-t3-medium text-foreground">
                  <T>Manager</T>
                </Text>
              </View>
            ) : null}
            {member.readOnly ? (
              <View className="rounded-md bg-subtle px-1.5 py-0.5">
                <Text className="text-[11px] font-t3-medium text-foreground-muted">
                  <T>Read-only</T>
                </Text>
              </View>
            ) : null}
            <Text
              className={cn(
                "shrink-0 text-xs",
                member.state === "needs-input"
                  ? "font-t3-medium text-warning-foreground"
                  : "text-foreground-muted",
              )}
            >
              {props.resolveStateLabel(member.state)}
            </Text>
            {isCurrent ? (
              <Text className="shrink-0 text-xs text-foreground-muted">
                · <T>This thread</T>
              </Text>
            ) : null}
          </View>
          {member.model || member.activity ? (
            <Text numberOfLines={1} className="text-xs text-foreground-muted">
              {[member.model, member.activity].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          {branchLabel || owns.length > 0 || hasMetrics ? (
            <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
              {branchLabel ? (
                <View className="flex-row items-center gap-1">
                  <SymbolView
                    name="arrow.branch"
                    size={11}
                    tintColorClassName="accent-foreground-muted"
                  />
                  <Text numberOfLines={1} className="font-mono text-xs text-foreground-muted">
                    {branchLabel}
                  </Text>
                </View>
              ) : null}
              {owns.length > 0 ? (
                <View className="flex-row items-center gap-1">
                  <SymbolView
                    name="folder"
                    size={11}
                    tintColorClassName="accent-foreground-muted"
                  />
                  <Text numberOfLines={1} className="font-mono text-xs text-foreground-muted">
                    {owns.length === 1
                      ? owns[0]
                      : gt("{first} +{rest}", { first: owns[0]!, rest: owns.length - 1 })}
                  </Text>
                </View>
              ) : null}
              {hasMetrics ? (
                <Text className="font-mono text-xs tabular-nums text-foreground-muted">
                  {metrics.totalTokens > 0
                    ? `${metrics.turns}t · ${formatTokens(metrics.totalTokens)}`
                    : `${metrics.turns}t`}
                </Text>
              ) : null}
            </View>
          ) : null}
        </Pressable>
        {showRetry ? (
          <IconButton
            icon="arrow.clockwise"
            accessibilityLabel={gt("Wake @{member}", { member: member.name })}
            disabled={busyName === member.name}
            onPress={() => void handleRetry(member)}
          />
        ) : null}
        {showKill ? (
          <IconButton
            icon="trash"
            accessibilityLabel={gt("Retire @{member}", { member: member.name })}
            disabled={busyName === member.name}
            onPress={() => confirmKill(member)}
          />
        ) : null}
        {!isCurrent ? (
          <SymbolView name="chevron.right" size={12} tintColorClassName="accent-foreground-muted" />
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView
      nestedScrollEnabled
      className="flex-1"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="px-5 pt-2"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      {props.tabHeader}
      {live.map(renderMember)}
      {retired.length > 0 ? (
        <View className="pt-4">
          <Pressable
            accessibilityRole="button"
            onPress={() => setRetiredExpanded((open) => !open)}
            className="flex-row items-center justify-between py-2"
          >
            <Text className="text-xs font-t3-medium text-foreground-muted">
              <T>
                Retired (<Var>{retired.length}</Var>)
              </T>
            </Text>
            <SymbolView
              name={retiredExpanded ? "chevron.up" : "chevron.down"}
              size={12}
              tintColorClassName="accent-foreground-muted"
            />
          </Pressable>
          {retiredExpanded ? retired.map(renderMember) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function MobileSwarmOverview(props: {
  readonly swarm: AgySwarmSnapshot;
  readonly tabHeader: React.ReactNode;
}) {
  const resolve = useMessages();
  const insets = useSafeAreaInsets();
  const plan = props.swarm.plan;
  const milestones = plan?.milestones ?? [];
  const rounds = plan?.rounds ?? [];
  const artifacts = plan?.artifacts ?? [];
  const passedMilestones = milestones.filter((milestone) => milestone.status === "passed").length;
  return (
    <ScrollView
      nestedScrollEnabled
      className="flex-1"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-3 px-5 pt-2"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
    >
      {props.tabHeader}
      {plan === null ? null : (
        <>
          <View className="gap-1.5 rounded-2xl bg-subtle px-4 py-3">
            <View className="flex-row flex-wrap items-center gap-1.5">
              <Text className="text-sm font-t3-bold text-foreground">{plan.goal.title}</Text>
              {plan.mode ? (
                <View className="rounded-md bg-screen px-1.5 py-0.5">
                  <Text className="text-[11px] font-t3-medium text-foreground-muted">
                    {plan.mode}
                  </Text>
                </View>
              ) : null}
              {plan.integrityMode ? (
                <View className="rounded-md bg-screen px-1.5 py-0.5">
                  <Text className="text-[11px] font-t3-medium text-foreground">
                    {resolve(INTEGRITY_LABELS[plan.integrityMode])}
                  </Text>
                </View>
              ) : null}
            </View>
            {plan.goal.line ? (
              <Text className="text-xs text-foreground-muted">{plan.goal.line}</Text>
            ) : null}
            {plan.projectDir ? (
              <Text numberOfLines={1} className="font-mono text-xs text-foreground-muted">
                {plan.projectDir}
              </Text>
            ) : null}
          </View>

          {milestones.length > 0 ? (
            <View className="gap-2">
              <View className="flex-row items-center justify-between px-1">
                <Text className="text-xs font-t3-medium text-foreground-muted">
                  <T>Milestones</T>
                </Text>
                <Text className="font-mono text-xs tabular-nums text-foreground-muted">
                  {passedMilestones}/{milestones.length}
                </Text>
              </View>
              {milestones.map((milestone) => (
                <View key={milestone.id} className="gap-1.5 rounded-2xl bg-subtle/60 px-4 py-3">
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="min-w-0 flex-1 text-sm font-t3-medium text-foreground">
                      {milestone.title}
                    </Text>
                    <Text className="shrink-0 text-xs font-t3-medium text-foreground-muted">
                      {resolve(MILESTONE_LABELS[milestone.status])}
                    </Text>
                  </View>
                  {milestone.summary ? (
                    <Text className="text-xs text-foreground-muted">{milestone.summary}</Text>
                  ) : null}
                  {milestone.gates ? (
                    <Text className="text-xs text-foreground-muted">
                      <T>
                        Critic:{" "}
                        <Var>{resolve(GATE_LABELS[milestone.gates.critic ?? "pending"])}</Var> ·
                        Challenger:{" "}
                        <Var>{resolve(GATE_LABELS[milestone.gates.challenger ?? "pending"])}</Var> ·
                        Auditor:{" "}
                        <Var>{resolve(GATE_LABELS[milestone.gates.auditor ?? "pending"])}</Var>
                      </T>
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {rounds.length > 0 ? (
            <View className="gap-2">
              <View className="flex-row items-center justify-between px-1">
                <Text className="text-xs font-t3-medium text-foreground-muted">
                  <T>Boost rounds</T>
                </Text>
                <Text className="font-mono text-xs tabular-nums text-foreground-muted">
                  {rounds.length}
                </Text>
              </View>
              {rounds.map((entry) => (
                <View key={entry.round} className="gap-1 rounded-2xl bg-subtle/60 px-4 py-2.5">
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="font-mono text-xs font-t3-medium text-foreground">
                      R{entry.round}
                      {entry.worker ? ` · @${entry.worker}` : ""}
                    </Text>
                    <Text className="text-xs text-foreground-muted">
                      {resolve(ROUND_LABELS[entry.status])}
                    </Text>
                  </View>
                  {entry.summary ? (
                    <Text className="text-xs text-foreground-muted">{entry.summary}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {plan.finalAudit ? (
            <View className="gap-1 rounded-2xl bg-subtle/60 px-4 py-3">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="text-sm font-t3-medium text-foreground">
                  <T>Final audit</T>
                </Text>
                <Text className="text-xs font-t3-medium text-foreground-muted">
                  {resolve(GATE_LABELS[plan.finalAudit.status])}
                </Text>
              </View>
              {plan.finalAudit.summary ? (
                <Text className="text-xs text-foreground-muted">{plan.finalAudit.summary}</Text>
              ) : null}
            </View>
          ) : null}

          {artifacts.length > 0 ? (
            <View className="gap-1.5 rounded-2xl bg-subtle/60 px-4 py-3">
              <Text className="text-xs font-t3-medium text-foreground-muted">
                <T>Artifacts</T>
              </Text>
              {artifacts.map((artifact) => (
                <View key={`${artifact.label}:${artifact.path}`} className="gap-0.5">
                  <Text className="text-xs font-t3-medium text-foreground">{artifact.label}</Text>
                  <Text selectable className="font-mono text-xs text-foreground-muted">
                    {artifact.path}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {plan.threads.map((group) => (
            <View key={group.id} className="gap-1.5 rounded-2xl bg-subtle/60 px-4 py-3">
              <Text className="text-sm font-t3-medium text-foreground">{group.title}</Text>
              {group.goal ? (
                <Text className="text-xs text-foreground-muted">{group.goal}</Text>
              ) : null}
              {group.tasks.map((taskKey) => (
                <Text key={taskKey} className="text-xs text-foreground-muted">
                  • {plan.tasks[taskKey] ?? taskKey}
                </Text>
              ))}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function AddWorkerForm(props: {
  readonly target: SwarmTarget;
  readonly swarm: AgySwarmSnapshot;
  readonly onDone: () => void;
  readonly onCancel: () => void;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [workspace, setWorkspace] = useState<"inherit" | "worktree">("inherit");
  const [readOnly, setReadOnly] = useState(false);
  const [manager, setManager] = useState(false);
  const [model, setModel] = useState("");
  const [ownsRaw, setOwnsRaw] = useState("");
  const [pending, setPending] = useState(false);

  const addWorker = useAtomCommand(agySwarmEnvironment.add, {
    label: "add swarm worker",
    reportFailure: false,
  });

  const normalizedName = name.trim().toLowerCase();
  const nameInvalid = normalizedName.length > 0 && !VALID_MEMBER_NAME.test(normalizedName);
  const nameTaken =
    normalizedName.length > 0 &&
    props.swarm.members.some((member) => member.name === normalizedName);
  const canSubmit =
    !pending && normalizedName.length > 0 && !nameInvalid && !nameTaken && brief.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    const owns = parseOwnedPaths(ownsRaw);
    const trimmedModel = model.trim();
    const result = await addWorker({
      environmentId: props.target.environmentId,
      input: {
        threadId: props.target.threadId,
        name: normalizedName,
        brief: brief.trim(),
        workspace: readOnly ? "inherit" : workspace,
        ...(readOnly ? { readOnly: true } : {}),
        ...(manager ? { manager: true } : {}),
        ...(trimmedModel ? { model: trimmedModel } : {}),
        ...(owns.length > 0 ? { owns } : {}),
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      Dialog.alert(
        gt("Couldn't add worker"),
        thrownErrorMessage(squashAtomCommandFailure(result), resolve) ?? gt("Try again."),
      );
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    props.onDone();
  };

  return (
    <KeyboardSheetBody>
      <ScrollView
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        className="flex-1"
        contentContainerClassName="gap-3.5 pb-6"
      >
        <View className="gap-1.5">
          <Text className="text-xs font-t3-medium text-foreground-muted">
            <T>Name</T>
          </Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={name}
            editable={!pending}
            placeholder={gt("e.g. reviewer, api-fix")}
            onChangeText={setName}
          />
          {nameInvalid ? (
            <Text className="text-xs text-danger-foreground">
              <T>Use lowercase letters, digits, hyphens, or underscores.</T>
            </Text>
          ) : nameTaken ? (
            <Text className="text-xs text-danger-foreground">
              <T>A member with that name already exists.</T>
            </Text>
          ) : null}
        </View>
        <View className="gap-1.5">
          <Text className="text-xs font-t3-medium text-foreground-muted">
            <T>Brief</T>
          </Text>
          <TextInput
            multiline
            value={brief}
            editable={!pending}
            placeholder={gt("What this worker owns and what done looks like")}
            onChangeText={setBrief}
            className="min-h-24"
          />
        </View>
        <View className="gap-1.5">
          <Text className="text-xs font-t3-medium text-foreground-muted">
            <T>Workspace</T>
          </Text>
          <SegmentedControl
            size="compact"
            selected={readOnly ? "inherit" : workspace}
            onSelect={(next) => {
              if (!readOnly) setWorkspace(next);
            }}
            options={[
              { value: "inherit", label: gt("Shared") },
              { value: "worktree", label: gt("Isolated worktree") },
            ]}
          />
        </View>
        <View className="gap-1.5">
          <Text className="text-xs font-t3-medium text-foreground-muted">
            <T>Role options</T>
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Chip
              size="small"
              label={gt("Read-only")}
              selected={readOnly}
              disabled={pending}
              onPress={() => {
                setReadOnly((current) => {
                  const next = !current;
                  if (next) setWorkspace("inherit");
                  return next;
                });
              }}
            />
            <Chip
              size="small"
              label={gt("Delegated manager")}
              selected={manager}
              disabled={pending}
              onPress={() => setManager((current) => !current)}
            />
          </View>
        </View>
        <View className="gap-1.5">
          <Text className="text-xs font-t3-medium text-foreground-muted">
            <T>Model (optional)</T>
          </Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={model}
            editable={!pending}
            placeholder={gt("Inherit coordinator")}
            onChangeText={setModel}
          />
        </View>
        <View className="gap-1.5">
          <Text className="text-xs font-t3-medium text-foreground-muted">
            <T>Owned paths (optional)</T>
          </Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={ownsRaw}
            editable={!pending}
            placeholder={gt("src/api/, tests/")}
            onChangeText={setOwnsRaw}
          />
        </View>
        <View className="flex-row items-center justify-end gap-2 pt-2">
          <Button
            tone="secondary"
            size="compact"
            label={gt("Cancel")}
            disabled={pending}
            onPress={props.onCancel}
          />
          <Button
            tone="primary"
            size="compact"
            label={pending ? gt("Adding…") : gt("Add worker")}
            loading={pending}
            disabled={!canSubmit}
            onPress={() => void handleSubmit()}
          />
        </View>
      </ScrollView>
    </KeyboardSheetBody>
  );
}
