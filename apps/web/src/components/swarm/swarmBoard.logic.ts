import type { AgySwarmMember, AgySwarmPost, AgySwarmSnapshot } from "@t3tools/contracts";

export const MAIN_CHANNEL = "main";
const COORDINATOR = "coordinator";

export interface BeeColors {
  readonly queen: boolean;
  readonly tile: string;
  readonly head: string;
  readonly body: string;
  readonly outline: string;
}

const worker = (tile: string, head: string, body: string, outline: string): BeeColors => ({
  queen: false,
  tile,
  head,
  body,
  outline,
});

// Literal classes so Tailwind sees them. Amber is the queen's alone, as in the app icon.
const WORKER_BEES: ReadonlyArray<BeeColors> = [
  worker("bg-sky-500/15", "fill-sky-300", "fill-sky-400", "fill-sky-900"),
  worker("bg-violet-500/15", "fill-violet-300", "fill-violet-400", "fill-violet-900"),
  worker("bg-emerald-500/15", "fill-emerald-300", "fill-emerald-400", "fill-emerald-900"),
  worker("bg-rose-500/15", "fill-rose-300", "fill-rose-400", "fill-rose-900"),
  worker("bg-teal-500/15", "fill-teal-300", "fill-teal-400", "fill-teal-900"),
  worker("bg-fuchsia-500/15", "fill-fuchsia-300", "fill-fuchsia-400", "fill-fuchsia-900"),
  worker("bg-lime-500/15", "fill-lime-300", "fill-lime-400", "fill-lime-900"),
  worker("bg-indigo-500/15", "fill-indigo-300", "fill-indigo-400", "fill-indigo-900"),
  worker("bg-orange-500/15", "fill-orange-300", "fill-orange-400", "fill-orange-900"),
];

export const QUEEN_BEE: BeeColors = {
  queen: true,
  tile: "bg-amber-500/20",
  head: "fill-amber-300",
  body: "fill-amber-400",
  outline: "fill-amber-900",
};

function nameHash(name: string): number {
  let hash = 0;
  for (let char = 0; char < name.length; char += 1) {
    hash = (hash * 31 + name.charCodeAt(char)) >>> 0;
  }
  return hash;
}

/**
 * A member's bee: the queen for the coordinator, else a hue hashed from the name. A clash moves
 * to the next free hue in join order, and members only ever join, so a bee never changes colour.
 */
export function memberBee(members: ReadonlyArray<AgySwarmMember>, name: string): BeeColors {
  if (name === COORDINATOR) return QUEEN_BEE;
  const taken = new Set<number>();
  for (const member of members) {
    if (member.role === "coordinator") {
      if (member.name === name) return QUEEN_BEE;
      continue;
    }
    let hue = nameHash(member.name) % WORKER_BEES.length;
    while (taken.size < WORKER_BEES.length && taken.has(hue)) {
      hue = (hue + 1) % WORKER_BEES.length;
    }
    if (member.name === name) return WORKER_BEES[hue]!;
    taken.add(hue);
  }
  return WORKER_BEES[nameHash(name) % WORKER_BEES.length]!;
}

/** A one-shot bee animation; a new `key` plays it again. */
export interface BeeCue {
  readonly kind: "flap" | "settle";
  readonly key: string;
}

const isDone = (post: AgySwarmPost) => /^\[done\]/iu.test(postBody(post));

/** A post that arrived after `sinceSeq` flaps its sender, or settles it when it reports `[done]`. */
export function postCue(post: AgySwarmPost, sinceSeq: number): BeeCue | undefined {
  if (post.seq <= sinceSeq) return undefined;
  return { kind: isDone(post) ? "settle" : "flap", key: `post-${post.seq}` };
}

/** A member flaps when it joins or posts after the view opened, and settles on its `[done]`. */
export function memberCue(
  member: AgySwarmMember,
  posts: ReadonlyArray<AgySwarmPost>,
  since: { readonly seq: number; readonly names: ReadonlySet<string> },
): BeeCue | undefined {
  if (member.lastPostSeq !== null && member.lastPostSeq > since.seq) {
    const last = posts.findLast((post) => post.seq === member.lastPostSeq);
    return last ? postCue(last, since.seq) : { kind: "flap", key: `post-${member.lastPostSeq}` };
  }
  return since.names.has(member.name) ? undefined : { kind: "flap", key: "joined" };
}

/** `fix` names the group `fix-1`..`fix-k`; a member's own name always matches. Mirrors the server. */
function isNamed(member: AgySwarmMember, token: string): boolean {
  return (
    member.name === token ||
    (member.name.startsWith(`${token}-`) && /^\d+$/u.test(member.name.slice(token.length + 1)))
  );
}

/** Who a mention token reaches: a member or numbered group, `all`, or a channel's members. */
function mentionTargets(
  members: ReadonlyArray<AgySwarmMember>,
  token: string,
): ReadonlyArray<AgySwarmMember> {
  if (token === "all") return members;
  if (token.startsWith("#")) {
    const channel = token.slice(1);
    return members.filter(
      (member) => member.role === "coordinator" || member.channels.includes(channel),
    );
  }
  return members.filter((member) => isNamed(member, token));
}

/** Whether a post is from `name` or reaches it through a mention. */
function postInvolves(
  members: ReadonlyArray<AgySwarmMember>,
  post: AgySwarmPost,
  name: string,
): boolean {
  if (post.from === name) return true;
  return post.mentions.some((token) =>
    mentionTargets(members, token).some((member) => member.name === name),
  );
}

const LEADING_MENTION = /^\s*@(#?[a-z][a-z0-9_-]*)[\s,:]*/u;

/** The text under the header: the leading mentions the header lists, and a stall's tag, removed. */
export function postBody(post: AgySwarmPost): string {
  let text = post.text;
  for (;;) {
    const match = LEADING_MENTION.exec(text);
    if (match === null || !post.mentions.includes(match[1]!)) break;
    text = text.slice(match[0].length);
  }
  if (post.kind === "stall") text = text.replace(/^\[stall\]\s*/u, "");
  return text.trim();
}

export function visibleChannels(snapshot: AgySwarmSnapshot): ReadonlyArray<string> {
  const names = new Set<string>([MAIN_CHANNEL]);
  for (const channel of snapshot.channels) if (!channel.archived) names.add(channel.name);
  for (const post of snapshot.posts) names.add(post.channel);
  return [...names];
}

export interface PostFilter {
  /** Posts from or to this member. */
  readonly member: string | null;
  readonly channel: string | null;
  readonly query: string;
}

export const NO_POST_FILTER: PostFilter = { member: null, channel: null, query: "" };

export function mergePosts(
  older: ReadonlyArray<AgySwarmPost>,
  live: ReadonlyArray<AgySwarmPost>,
): ReadonlyArray<AgySwarmPost> {
  if (older.length === 0) return live;
  const bySeq = new Map<number, AgySwarmPost>();
  for (const post of older) bySeq.set(post.seq, post);
  for (const post of live) bySeq.set(post.seq, post);
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

export function filterPosts(
  snapshot: AgySwarmSnapshot,
  filter: PostFilter,
  sourcePosts: ReadonlyArray<AgySwarmPost> = snapshot.posts,
): ReadonlyArray<AgySwarmPost> {
  const query = filter.query.trim().toLowerCase();
  if (filter.member === null && filter.channel === null && query === "") return sourcePosts;
  return sourcePosts.filter(
    (post) =>
      (filter.channel === null || post.channel === filter.channel) &&
      (filter.member === null || postInvolves(snapshot.members, post, filter.member)) &&
      (query === "" ||
        post.text.toLowerCase().includes(query) ||
        post.from.toLowerCase().includes(query)),
  );
}

/**
 * The first post the viewed member has not read: the member whose thread is open, or the
 * coordinator when the open thread is not a member's. Its own posts never count as unread.
 */
export function firstUnreadSeq(
  snapshot: AgySwarmSnapshot,
  viewerThreadId: string,
  posts: ReadonlyArray<AgySwarmPost> = snapshot.posts,
): number | null {
  const viewer =
    snapshot.members.find((member) => member.threadId === viewerThreadId) ??
    snapshot.members.find((member) => member.role === "coordinator");
  if (viewer === undefined) return null;
  const unread = posts.find((post) => post.seq > viewer.lastReadSeq && post.from !== viewer.name);
  return unread?.seq ?? null;
}

export interface MemberGroups {
  readonly coordinators: ReadonlyArray<AgySwarmMember>;
  readonly active: ReadonlyArray<AgySwarmMember>;
  readonly standingBy: ReadonlyArray<AgySwarmMember>;
  readonly retired: ReadonlyArray<AgySwarmMember>;
}

export function groupMembers(members: ReadonlyArray<AgySwarmMember>, query: string): MemberGroups {
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? members.filter(
        (member) =>
          member.name.toLowerCase().includes(needle) ||
          (member.model?.toLowerCase().includes(needle) ?? false),
      )
    : members;
  const coordinators: AgySwarmMember[] = [];
  const active: AgySwarmMember[] = [];
  const standingBy: AgySwarmMember[] = [];
  const retired: AgySwarmMember[] = [];
  for (const member of shown) {
    if (member.state === "killed") retired.push(member);
    else if (member.role === "coordinator") coordinators.push(member);
    else if (member.state === "working" || member.state === "needs-input") active.push(member);
    else standingBy.push(member);
  }
  return { coordinators, active, standingBy, retired };
}

/** What a member is on: its live activity while it works or after it stopped, else its last post. */
export function memberSnippet(member: AgySwarmMember, posts: ReadonlyArray<AgySwarmPost>): string {
  if ((member.state === "working" || member.state === "stopped") && member.activity) {
    return member.activity.replace(/\s+/gu, " ").trim();
  }
  if (member.lastPostSeq === null) return "";
  const last = posts.findLast((post) => post.seq === member.lastPostSeq);
  if (last === undefined) return "";
  // One line of plain text: Markdown emphasis, code ticks and list markers would read as noise.
  return postBody(last)
    .replace(
      /`([^`]+)`|(?<![\w/\\*])\*\*(\S(?:.*?\S)?)\*\*(?![\w/\\*])/gu,
      (_match, code: string | undefined, bold: string | undefined) =>
        code ?? (bold ?? "").replace(/`([^`]+)`/gu, "$1"),
    )
    .replace(/^\s*[-*]\s+/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export const liveMemberCount = (members: ReadonlyArray<AgySwarmMember>): number =>
  members.filter((member) => member.state !== "killed").length;

export interface SwarmEdge {
  readonly from: string;
  readonly to: string;
  readonly count: number;
  /** Drawn only because of `@all`, which Expand @all turns into one edge per member. */
  readonly viaAll: boolean;
}

export interface GraphFrame {
  readonly edges: ReadonlyArray<SwarmEdge>;
  /** How many `@all` posts each member made, for the nodes' badges. */
  readonly allPosts: ReadonlyMap<string, number>;
  /** Members that posted at least once with no mention. */
  readonly unaddressed: ReadonlySet<string>;
  /** Members that posted or were mentioned. */
  readonly active: ReadonlySet<string>;
}

/** Who mentioned whom in `posts`. Notices and stall alerts are the server's, not a member's. */
export function graphFrame(
  members: ReadonlyArray<AgySwarmMember>,
  posts: ReadonlyArray<AgySwarmPost>,
  expandAll: boolean,
): GraphFrame {
  const names = new Set(members.map((member) => member.name));
  const edges = new Map<string, { from: string; to: string; count: number; viaAll: boolean }>();
  const allPosts = new Map<string, number>();
  const unaddressed = new Set<string>();
  const active = new Set<string>();
  const addEdge = (from: string, to: string, viaAll: boolean) => {
    const key = `${from}>${to}`;
    const existing = edges.get(key);
    if (existing === undefined) edges.set(key, { from, to, count: 1, viaAll });
    else {
      existing.count += 1;
      existing.viaAll &&= viaAll;
    }
  };
  for (const post of posts) {
    if (post.kind === "system" || post.kind === "stall" || !names.has(post.from)) continue;
    // A retired member is drawn only for what reached it before it left.
    const reachable = members.filter(
      (member) => member.killedAt === null || member.killedAt > post.createdAt,
    );
    active.add(post.from);
    if (post.kind === "brief") continue;
    if (post.mentions.length === 0) unaddressed.add(post.from);
    const direct = new Set<string>();
    for (const token of post.mentions) {
      if (token === "all") {
        allPosts.set(post.from, (allPosts.get(post.from) ?? 0) + 1);
        continue;
      }
      for (const target of mentionTargets(reachable, token)) direct.add(target.name);
    }
    direct.delete(post.from);
    for (const name of direct) {
      addEdge(post.from, name, false);
      active.add(name);
    }
    if (expandAll && post.mentions.includes("all")) {
      for (const member of reachable) {
        if (member.name === post.from || direct.has(member.name)) continue;
        addEdge(post.from, member.name, true);
        active.add(member.name);
      }
    }
  }
  return { edges: [...edges.values()], allPosts, unaddressed, active };
}

export interface GraphNode {
  readonly member: AgySwarmMember;
  readonly x: number;
  readonly y: number;
}

/** The coordinator on top, everyone else clockwise around an ellipse in a width by height box. */
export function layoutGraph(
  members: ReadonlyArray<AgySwarmMember>,
  width: number,
  height: number,
): ReadonlyArray<GraphNode> {
  const ordered = [
    ...members.filter((member) => member.name === COORDINATOR),
    ...members.filter((member) => member.name !== COORDINATOR),
  ];
  const radiusX = width * 0.36;
  const radiusY = height * 0.38;
  return ordered.map((member, index) => {
    const angle = (index / ordered.length) * Math.PI * 2 - Math.PI / 2;
    return {
      member,
      x: width / 2 + Math.cos(angle) * radiusX,
      y: height / 2 + Math.sin(angle) * radiusY,
    };
  });
}

/** Milliseconds from the first to the last of `posts`. */
export function postsSpanMs(posts: ReadonlyArray<AgySwarmPost>): number {
  const first = posts.at(0);
  const last = posts.at(-1);
  if (first === undefined || last === undefined) return 0;
  return Math.max(0, Date.parse(last.createdAt) - Date.parse(first.createdAt));
}

/** Compact human-readable token counter (e.g. `420`, `1.2k`, `48k`, `1.4M`). */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) return String(Math.max(0, Math.round(tokens)));
  if (tokens < 10_000) {
    const tenths = Math.round(tokens / 100) / 10;
    return `${tenths.toFixed(1).replace(/\.0$/u, "")}k`;
  }
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  const tenths = Math.round(tokens / 100_000) / 10;
  return `${tenths.toFixed(1).replace(/\.0$/u, "")}M`;
}

/** Whether a kill error message indicates a dirty worktree that requires `force: true`. */
export function isDirtyWorktreeKillError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /uncommitted changes|force\s*:\s*true/iu.test(message);
}

/** Parse comma- or newline-separated paths/items, trimming blanks and removing duplicates. */
export function parseDelimitedList(raw: string): string[] {
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
