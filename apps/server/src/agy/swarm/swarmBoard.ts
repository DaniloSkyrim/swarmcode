// Pure swarm board model: membership, posts, mentions, who wakes, and stall detection.
// Persistence, threads and wakes live in AgySwarm.ts.
import type { AgySwarmKind, AgySwarmPlan, AgySwarmPostKind } from "@t3tools/contracts";

export const COORDINATOR = "coordinator";
export const MAIN_CHANNEL = "main";
const RESERVED_NAMES = new Set([COORDINATOR, "all", "user"]);

export interface StoredMemberMetrics {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  lastContextTokens?: number;
  maxContextTokens?: number | null;
}

export const emptyMetrics = (): StoredMemberMetrics => ({
  turns: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});

export function sumMetrics(
  entries: ReadonlyArray<StoredMemberMetrics | undefined>,
): StoredMemberMetrics {
  const total = emptyMetrics();
  for (const item of entries) {
    if (item === undefined) continue;
    total.turns += item.turns;
    total.inputTokens += item.inputTokens;
    total.outputTokens += item.outputTokens;
    total.cachedInputTokens += item.cachedInputTokens;
    total.reasoningTokens += item.reasoningTokens;
    total.totalTokens += item.totalTokens;
  }
  return total;
}

export interface StoredMember {
  readonly name: string;
  readonly threadId: string;
  readonly role: "coordinator" | "worker";
  readonly addedBy: string;
  instanceId: string | null;
  model: string | null;
  readonly workspace: "inherit" | "worktree";
  worktreePath?: string | null;
  branch?: string | null;
  owns?: string[];
  canManage?: boolean;
  readOnly?: boolean;
  scratchDir?: string | null;
  channels: string[];
  readonly brief: string | null;
  readonly createdAt: string;
  killedAt: string | null;
  lastReadSeq: number;
  /** Highest seq already handed to the member's thread as a wake message. */
  lastWakeSeq: number;
  /** `swarm_wait{mentions_only:false}` parks the member on any post in its channels. */
  wakeOnAny: boolean;
  metrics?: StoredMemberMetrics;
}

export interface StoredPost {
  readonly seq: number;
  readonly from: string;
  readonly text: string;
  readonly mentions: string[];
  readonly channel: string;
  readonly kind: AgySwarmPostKind;
  readonly createdAt: string;
}

export interface StoredChannel {
  readonly name: string;
  topic: string;
  readonly createdBy: string;
  archived: boolean;
}

export interface StallAlert {
  readonly key: string;
  readonly count: number;
  readonly lastAt: string;
  readonly headAtAlert: number;
}

export interface StoredSwarm {
  readonly version: 1;
  readonly id: string;
  kind: AgySwarmKind;
  title: string;
  readonly projectId: string;
  readonly coordinatorThreadId: string;
  readonly createdAt: string;
  doneAt: string | null;
  plan: AgySwarmPlan | null;
  channels: StoredChannel[];
  members: StoredMember[];
  posts: StoredPost[];
  stall: StallAlert | null;
}

export function newSwarm(input: {
  readonly id: string;
  readonly kind: AgySwarmKind;
  readonly projectId: string;
  readonly coordinatorThreadId: string;
  readonly instanceId: string | null;
  readonly model: string | null;
  readonly now: string;
}): StoredSwarm {
  return {
    version: 1,
    id: input.id,
    kind: input.kind,
    title: "Swarm",
    projectId: input.projectId,
    coordinatorThreadId: input.coordinatorThreadId,
    createdAt: input.now,
    doneAt: null,
    plan: null,
    channels: [{ name: MAIN_CHANNEL, topic: "", createdBy: COORDINATOR, archived: false }],
    members: [
      {
        name: COORDINATOR,
        threadId: input.coordinatorThreadId,
        role: "coordinator",
        addedBy: "user",
        instanceId: input.instanceId,
        model: input.model,
        workspace: "inherit",
        channels: [MAIN_CHANNEL],
        brief: null,
        createdAt: input.now,
        killedAt: null,
        lastReadSeq: 0,
        lastWakeSeq: 0,
        wakeOnAny: false,
      },
    ],
    posts: [],
    stall: null,
  };
}

export const head = (swarm: StoredSwarm): number => swarm.posts.at(-1)?.seq ?? 0;

export function memberByThread(swarm: StoredSwarm, threadId: string): StoredMember | undefined {
  return swarm.members.find((member) => member.threadId === threadId);
}

export function memberByName(swarm: StoredSwarm, name: string): StoredMember | undefined {
  return swarm.members.find((member) => member.name === name);
}

export const isLive = (member: StoredMember): boolean => member.killedAt === null;

export const canManageSwarm = (member: StoredMember): boolean =>
  member.role === "coordinator" || member.canManage === true;

/** `fix` names the group `fix-1`..`fix-k`; a member's own name always matches. */
export function membersNamed(swarm: StoredSwarm, name: string): StoredMember[] {
  return swarm.members.filter(
    (member) =>
      member.name === name ||
      (member.name.startsWith(`${name}-`) && /^\d+$/u.test(member.name.slice(name.length + 1))),
  );
}

export function validateNewName(swarm: StoredSwarm, name: string): string | null {
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/u.test(name)) {
    return `"${name}" is not a valid member name: use lowercase letters, digits, '-' and '_', starting with a letter or digit.`;
  }
  if (RESERVED_NAMES.has(name) || name.startsWith(`${COORDINATOR}-`)) {
    return `"${name}" is reserved.`;
  }
  if (memberByName(swarm, name) !== undefined) {
    return `"${name}" is taken${memberByName(swarm, name)?.killedAt === null ? "" : " by a killed member; killed names cannot be reused"}.`;
  }
  return null;
}

export interface OwnershipOverlap {
  readonly member: string;
  readonly ownPath: string;
  readonly otherPath: string;
}

function normalizeOwnershipPath(raw: string): string {
  return raw
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+\*\*$/u, "")
    .replace(/\/+\*$/u, "")
    .replace(/\/+$/u, "");
}

function ownershipPathsOverlap(leftRaw: string, rightRaw: string): boolean {
  const left = normalizeOwnershipPath(leftRaw);
  const right = normalizeOwnershipPath(rightRaw);
  if (left === "" || left === "." || left === "*" || left === "**") return true;
  if (right === "" || right === "." || right === "*" || right === "**") return true;
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

/**
 * Finds path overlaps between a candidate shared-workspace worker and other live shared-workspace
 * workers. Workers with `workspace:"worktree"` are isolated and never collide.
 */
export function findOwnershipOverlaps(
  members: ReadonlyArray<
    Pick<StoredMember, "name" | "workspace" | "killedAt"> & {
      readonly owns?: ReadonlyArray<string> | undefined;
    }
  >,
  candidate: {
    readonly name: string;
    readonly workspace: "inherit" | "worktree";
    readonly owns: ReadonlyArray<string>;
  },
): OwnershipOverlap[] {
  if (candidate.workspace !== "inherit" || candidate.owns.length === 0) return [];
  const overlaps: OwnershipOverlap[] = [];
  for (const other of members) {
    if (other.killedAt !== null || other.name === candidate.name) continue;
    if (other.workspace !== "inherit" || !other.owns || other.owns.length === 0) continue;
    for (const ownPath of candidate.owns) {
      for (const otherPath of other.owns) {
        if (ownershipPathsOverlap(ownPath, otherPath)) {
          overlaps.push({ member: other.name, ownPath, otherPath });
        }
      }
    }
  }
  return overlaps;
}

const MENTION_PATTERN = /(^|[^\w@])@(#?[a-z0-9][a-z0-9_-]*)/gu;

/** Resolved mention targets as written: member names, group prefixes, `all`, `#channel`. */
function parseMentions(swarm: StoredSwarm, text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const token = match[2];
    if (token === undefined) continue;
    const known =
      token === "all" ||
      (token.startsWith("#") &&
        swarm.channels.some((channel) => channel.name === token.slice(1))) ||
      membersNamed(swarm, token).length > 0;
    if (known && !found.includes(token)) found.push(token);
  }
  return found;
}

export function visibleTo(member: StoredMember, post: StoredPost): boolean {
  if (member.role === "coordinator") return true;
  return post.channel === MAIN_CHANNEL || member.channels.includes(post.channel);
}

function mentionsMember(swarm: StoredSwarm, post: StoredPost, member: StoredMember): boolean {
  return post.mentions.some((token) => {
    if (token === "all") return true;
    if (token.startsWith("#")) {
      const channel = token.slice(1);
      return (
        channel !== MAIN_CHANNEL &&
        (member.role === "coordinator" || member.channels.includes(channel))
      );
    }
    return membersNamed(swarm, token).some((named) => named.name === member.name);
  });
}

/** Members that should be woken by a post: visible to them, and named or parked on anything. */
export function wakeTargets(swarm: StoredSwarm, post: StoredPost): StoredMember[] {
  return swarm.members.filter(
    (member) =>
      isLive(member) &&
      member.name !== post.from &&
      visibleTo(member, post) &&
      (mentionsMember(swarm, post, member) || member.wakeOnAny),
  );
}

/** Live members explicitly named by @name/@group who cannot read the post's private channel. */
export function hiddenMentionedMembers(swarm: StoredSwarm, post: StoredPost): string[] {
  if (post.channel === MAIN_CHANNEL) return [];
  const hidden: string[] = [];
  for (const token of post.mentions) {
    if (token === "all" || token.startsWith("#")) continue;
    for (const member of membersNamed(swarm, token)) {
      if (
        isLive(member) &&
        member.name !== post.from &&
        !visibleTo(member, post) &&
        !hidden.includes(member.name)
      ) {
        hidden.push(member.name);
      }
    }
  }
  return hidden;
}

/**
 * The posts a member should be rung for: those that named it after its last read, up to its last
 * wake, unless it was already rung for them (`rungSeq`). Empty when there is nothing new.
 */
export function unreadWakePosts(
  swarm: StoredSwarm,
  member: StoredMember,
  rungSeq: number,
): StoredPost[] {
  if (!isLive(member) || member.lastWakeSeq <= Math.max(member.lastReadSeq, rungSeq)) return [];
  return swarm.posts.filter(
    (post) =>
      post.seq > member.lastReadSeq &&
      post.seq <= member.lastWakeSeq &&
      wakeTargets({ ...swarm, members: [member] }, post).length > 0,
  );
}

/**
 * Filters routine board noise from default reads and auto-wakes: other members' briefs and
 * zero-mention lifecycle notices (`killed`, `switched`, `retried`). Direct `@<reader>`/`@all`
 * system alerts, stalls, and regular posts remain visible by default.
 */
export function isReadableByDefault(reader: StoredMember, post: StoredPost): boolean {
  if (post.kind === "brief") return post.mentions.includes(reader.name);
  if (post.kind === "system") return post.mentions.length > 0;
  return true;
}

/** All visible posts after `member.lastReadSeq` written by others (excluding default noise), in board order. */
export function unreadVisiblePosts(swarm: StoredSwarm, member: StoredMember): StoredPost[] {
  return swarm.posts.filter(
    (post) =>
      post.seq > member.lastReadSeq &&
      post.from !== member.name &&
      visibleTo(member, post) &&
      isReadableByDefault(member, post),
  );
}

export function appendPost(
  swarm: StoredSwarm,
  input: {
    readonly from: string;
    readonly text: string;
    readonly channel?: string | undefined;
    readonly kind?: AgySwarmPostKind;
    readonly briefTarget?: string | undefined;
    readonly now: string;
  },
): StoredPost | { readonly refused: string } {
  const author = memberByName(swarm, input.from);
  const channel =
    input.channel ??
    (author?.role === "coordinator"
      ? MAIN_CHANNEL
      : (author?.channels.find((name) => name !== MAIN_CHANNEL) ?? MAIN_CHANNEL));
  const target = swarm.channels.find((candidate) => candidate.name === channel);
  if (target === undefined) return { refused: `Channel #${channel} does not exist.` };
  if (target.archived) return { refused: `Channel #${channel} is archived.` };
  if (/(^|[^\w@])@#main\b/u.test(input.text)) {
    return { refused: "@#main is refused: use @all to address everyone." };
  }
  const kind = input.kind ?? "post";
  const post: StoredPost = {
    seq: head(swarm) + 1,
    from: input.from,
    text: input.text,
    mentions:
      kind === "brief" && input.briefTarget !== undefined
        ? [input.briefTarget]
        : parseMentions(swarm, input.text),
    channel,
    kind,
    createdAt: input.now,
  };
  swarm.posts.push(post);
  // Advance only when contiguous so posting mid-turn never skips unread posts from peers.
  if (author !== undefined && author.lastReadSeq === post.seq - 1) {
    author.lastReadSeq = post.seq;
  }
  if (
    post.from === COORDINATOR &&
    post.kind === "post" &&
    /^\s*\[done\]/iu.test(post.text) &&
    post.mentions.length === 0
  ) {
    swarm.doneAt = input.now;
  }
  // A new member's brief or a user message addressing someone reopens a finished board.
  if (post.kind === "brief" || (post.from === "user" && post.mentions.length > 0)) {
    swarm.doneAt = null;
  }
  return post;
}

export function readPosts(
  swarm: StoredSwarm,
  reader: StoredMember,
  input: {
    readonly since: number;
    readonly limit: number;
    readonly channel?: string | undefined;
    readonly seqs?: ReadonlyArray<number> | undefined;
    readonly includeBriefs?: boolean | undefined;
    readonly includeSystem?: boolean | undefined;
  },
): StoredPost[] {
  if (input.seqs !== undefined && input.seqs.length > 0) {
    const wanted = new Set(input.seqs);
    return swarm.posts
      .filter((post) => wanted.has(post.seq) && visibleTo(reader, post))
      .slice(0, input.limit);
  }
  return swarm.posts
    .filter((post) => post.seq > input.since)
    .filter((post) => {
      if (!visibleTo(reader, post)) return false;
      if (input.channel !== undefined && input.channel !== "*" && post.channel !== input.channel) {
        return false;
      }
      if (post.kind === "brief" && input.includeBriefs !== true) {
        return post.mentions.includes(reader.name);
      }
      if (post.kind === "system" && input.includeSystem !== true) {
        return post.mentions.length > 0;
      }
      return true;
    })
    .slice(0, input.limit);
}

export function formatPost(post: StoredPost): string {
  const channel = post.channel === MAIN_CHANNEL ? "" : ` #${post.channel}`;
  return `#${post.seq} ${post.from}${channel} (${post.createdAt}): ${post.text}`;
}

/**
 * The oldest posts that fit in `maxChars` once formatted, always at least one, so a reader pages
 * forward in board order. A tool result stays in the caller's context for every later model call.
 */
export function takePostsWithinChars(
  posts: ReadonlyArray<StoredPost>,
  maxChars: number,
): StoredPost[] {
  const taken: StoredPost[] = [];
  let chars = 0;
  for (const post of posts) {
    const len = formatPost(post).length + 1;
    if (taken.length > 0 && chars + len > maxChars) break;
    taken.push(post);
    chars += len;
  }
  return taken;
}

export interface MemberLiveState {
  readonly name: string;
  readonly state: "working" | "waiting" | "needs-input" | "stopped" | "killed";
  readonly lastPostSeq: number | null;
}

export function lastPostSeq(swarm: StoredSwarm, name: string): number | null {
  for (let index = swarm.posts.length - 1; index >= 0; index--) {
    const post = swarm.posts[index];
    if (post !== undefined && post.from === name && post.kind !== "brief") return post.seq;
  }
  return null;
}

/**
 * The server-side stall monitor. A swarm is stalled when no live member is working, the
 * coordinator has not posted `[done]`, and the board has been quiet for `quietMs`. Returns the
 * one post to make, or null. Mirrors the rules a monitor worker would follow, without a worker.
 */
export function detectStall(
  swarm: StoredSwarm,
  states: ReadonlyArray<MemberLiveState>,
  input: { readonly nowMs: number; readonly quietMs: number; readonly repeatMs: number },
): { readonly to: string; readonly text: string; readonly key: string } | null {
  if (swarm.doneAt !== null) return null;
  const live = states.filter((state) => state.state !== "killed");
  if (live.length <= 1) return null;
  if (live.some((state) => state.state === "working" || state.state === "needs-input")) return null;
  const last = swarm.posts.at(-1);
  if (last === undefined) return null;
  if (input.nowMs - Date.parse(last.createdAt) < input.quietMs) return null;

  const coordinator = memberByName(swarm, COORDINATOR);
  const since = last.createdAt.slice(11, 16);
  let alert: { to: string; text: string; key: string } | null = null;

  const unaddressed = swarm.posts.filter(
    (post) =>
      post.kind === "post" &&
      post.from !== COORDINATOR &&
      post.mentions.length === 0 &&
      post.seq > (coordinator?.lastReadSeq ?? 0),
  );
  if (unaddressed.length > 0) {
    const refs = unaddressed.map((post) => `#${post.seq} (${post.from})`).join(", ");
    alert = {
      to: COORDINATOR,
      key: `unaddressed:${unaddressed.at(-1)?.seq}`,
      text: `@coordinator [stall] ${refs} addressed nobody; everyone has been waiting since ${since} UTC.`,
    };
  }

  // Workers who finished but only talked to each other leave the coordinator asleep; it decides
  // what happens next, so it hears first, before anyone is nudged to answer a peer.
  const unread = swarm.posts.filter(
    (post) =>
      post.kind === "post" &&
      post.from !== COORDINATOR &&
      post.seq > (coordinator?.lastReadSeq ?? 0),
  );
  if (alert === null && unread.length > 0) {
    const refs = unread.map((post) => `#${post.seq} (${post.from})`).join(", ");
    alert = {
      to: COORDINATOR,
      key: `unread:${unread.at(-1)?.seq}`,
      text: `@coordinator [stall] everyone has been waiting since ${since} UTC and you have not read ${refs}. Read them, then hand out the next step by name or post [done].`,
    };
  }

  if (alert === null) {
    for (const member of swarm.members) {
      if (!isLive(member) || member.role === "coordinator") continue;
      const own = lastPostSeq(swarm, member.name) ?? 0;
      const mention = swarm.posts.find(
        (post) =>
          post.seq > own &&
          post.from !== member.name &&
          post.kind !== "stall" &&
          mentionsMember(swarm, post, member),
      );
      if (mention === undefined) continue;
      const key = `unanswered:${member.name}:${mention.seq}`;
      const pinged = swarm.stall?.key === key;
      alert = pinged
        ? {
            to: COORDINATOR,
            key: `${key}:escalated`,
            text: `@coordinator [stall] ${member.name} has not answered #${mention.seq} since ${since} UTC, even after a reminder. Its turn may have failed or run out of quota: check its thread or switch its model.`,
          }
        : { to: member.name, key, text: `@${member.name} [stall] #${mention.seq} is for you.` };
      break;
    }
  }

  if (alert === null) {
    const roster = live
      .filter((state) => state.name !== COORDINATOR)
      .map(
        (state) =>
          `${state.name} (last post ${state.lastPostSeq === null ? "none" : `#${state.lastPostSeq}`})`,
      )
      .join(", ");
    alert = {
      to: COORDINATOR,
      key: `idle:${head(swarm)}`,
      text: `@coordinator [stall] every member is waiting and the job is not done: ${roster}. Hand out the next step by name, or post [done] if it is finished.`,
    };
  }

  const previous = swarm.stall;
  if (previous !== null && previous.key === alert.key) {
    if (previous.count >= 3) return null;
    if (
      input.nowMs - Date.parse(previous.lastAt) < input.repeatMs &&
      previous.headAtAlert === head(swarm)
    ) {
      return null;
    }
  }
  return alert;
}

export function graphEdges(swarm: StoredSwarm): Array<{ from: string; to: string; count: number }> {
  const counts = new Map<string, number>();
  for (const post of swarm.posts) {
    for (const token of post.mentions) {
      const targets =
        token === "all"
          ? swarm.members.filter((member) => member.name !== post.from)
          : token.startsWith("#")
            ? swarm.members.filter((member) => member.channels.includes(token.slice(1)))
            : membersNamed(swarm, token);
      for (const target of targets) {
        if (target.name === post.from) continue;
        const key = `${post.from}\u0000${target.name}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts].map(([key, count]) => {
    const [from = "", to = ""] = key.split("\u0000");
    return { from, to, count };
  });
}
