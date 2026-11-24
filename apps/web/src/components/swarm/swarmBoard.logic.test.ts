import type { AgySwarmMember, AgySwarmPost, AgySwarmSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterPosts,
  firstUnreadSeq,
  graphFrame,
  groupMembers,
  layoutGraph,
  memberBee,
  memberCue,
  memberSnippet,
  NO_POST_FILTER,
  postBody,
  postCue,
  QUEEN_BEE,
  visibleChannels,
} from "./swarmBoard.logic";

const member = (name: string, overrides: Partial<AgySwarmMember> = {}): AgySwarmMember =>
  ({
    name,
    threadId: `thread-${name}`,
    role: name === "coordinator" ? "coordinator" : "worker",
    channels: ["main"],
    state: "working",
    lastReadSeq: 0,
    lastPostSeq: null,
    killedAt: null,
    activity: null,
    model: null,
    ...overrides,
  }) as AgySwarmMember;

const post = (seq: number, overrides: Partial<AgySwarmPost> = {}): AgySwarmPost => ({
  seq,
  from: "coordinator",
  text: "",
  mentions: [],
  channel: "main",
  kind: "post",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const snapshot = (
  members: ReadonlyArray<AgySwarmMember>,
  posts: ReadonlyArray<AgySwarmPost>,
): AgySwarmSnapshot =>
  ({ members, posts, channels: [{ name: "fix", archived: false }] }) as unknown as AgySwarmSnapshot;

const team = [
  member("coordinator", { lastReadSeq: 2 }),
  member("fix-1", { channels: ["main", "fix"], lastReadSeq: 4 }),
  member("fix-2", { channels: ["main", "fix"] }),
  member("docs"),
];

describe("swarm board logic", () => {
  it("gives the coordinator the queen and every worker its own lasting hue", () => {
    expect(memberBee(team, "coordinator")).toBe(QUEEN_BEE);
    const workers = Array.from({ length: 9 }, (_, index) => member(`w${index}`));
    const bees = workers.map((worker) => memberBee(workers, worker.name));
    expect(new Set(bees).size).toBe(9);
    expect(bees).not.toContain(QUEEN_BEE);
    const grown = [...workers, member("late")];
    expect(workers.map((worker) => memberBee(grown, worker.name))).toEqual(bees);
    expect(memberBee(team, "monitor")).toBe(memberBee([], "monitor"));
  });

  it("cues a bee only for what lands after the view opened", () => {
    const done = post(6, {
      from: "docs",
      text: "@coordinator [done] shipped",
      mentions: ["coordinator"],
    });
    expect(postCue(post(3), 5)).toBeUndefined();
    expect(postCue(post(7), 5)).toEqual({ kind: "flap", key: "post-7" });
    expect(postCue(done, 5)).toEqual({ kind: "settle", key: "post-6" });
    const since = { seq: 5, names: new Set(["coordinator", "docs"]) };
    expect(memberCue(member("docs", { lastPostSeq: 6 }), [done], since)?.kind).toBe("settle");
    expect(memberCue(member("docs", { lastPostSeq: 4 }), [], since)).toBeUndefined();
    expect(memberCue(member("fix-3"), [], since)).toEqual({ kind: "flap", key: "joined" });
  });

  it("strips the mentions the header already lists, and a stall's tag", () => {
    expect(
      postBody(post(1, { text: "@fix-1, @docs: ship `a.ts`", mentions: ["fix-1", "docs"] })),
    ).toBe("ship `a.ts`");
    expect(postBody(post(2, { text: "@nobody hi", mentions: [] }))).toBe("@nobody hi");
    expect(
      postBody(
        post(3, {
          kind: "stall",
          text: "@coordinator [stall] #2 is waiting",
          mentions: ["coordinator"],
        }),
      ),
    ).toBe("#2 is waiting");
  });

  it("filters posts from or to a member through groups, channels and @all", () => {
    const swarm = snapshot(team, [
      post(1, { mentions: ["fix"] }),
      post(2, { mentions: ["all"] }),
      post(3, { mentions: ["#fix"], channel: "fix" }),
      post(4, { from: "docs", mentions: ["coordinator"], text: "Done with README" }),
    ]);
    const seqs = (filter: Partial<typeof NO_POST_FILTER>) =>
      filterPosts(swarm, { ...NO_POST_FILTER, ...filter }).map((entry) => entry.seq);
    expect(seqs({ member: "fix-2" })).toEqual([1, 2, 3]);
    expect(seqs({ member: "docs" })).toEqual([2, 4]);
    expect(seqs({ channel: "fix" })).toEqual([3]);
    expect(seqs({ query: "readme" })).toEqual([4]);
    expect(visibleChannels(swarm)).toEqual(["main", "fix"]);
  });

  it("marks the first post the viewed member has not read, else the coordinator's", () => {
    const swarm = snapshot(team, [
      post(1),
      post(2),
      post(3, { from: "fix-1" }),
      post(4),
      post(5, { from: "docs" }),
    ]);
    expect(firstUnreadSeq(swarm, "thread-fix-1")).toBe(5);
    expect(firstUnreadSeq(swarm, "some-other-thread")).toBe(3);
    // The coordinator's own post after its read mark is not news to it.
    expect(firstUnreadSeq(swarm, "thread-coordinator", [post(4), post(5, { from: "docs" })])).toBe(
      5,
    );
  });

  it("groups members and finds what each is on", () => {
    const groups = groupMembers(
      [
        member("coordinator", { state: "waiting" }),
        member("a", { state: "needs-input" }),
        member("b", { state: "stopped" }),
        member("c", { state: "killed" }),
      ],
      "",
    );
    expect(
      [groups.coordinators, groups.active, groups.standingBy, groups.retired].map((group) =>
        group.map((entry) => entry.name),
      ),
    ).toEqual([["coordinator"], ["a"], ["b"], ["c"]]);
    expect(
      memberSnippet(member("a", { state: "waiting", activity: "swarm_wait", lastPostSeq: 1 }), [
        post(1, {
          from: "a",
          text: "@coordinator  ready\n- **for** `review`",
          mentions: ["coordinator"],
        }),
      ]),
    ).toBe("ready for review");
  });

  it("counts mentions per direction and leaves @all to its toggle", () => {
    const posts = [
      post(1, { mentions: ["fix"] }),
      post(2, { mentions: ["all"] }),
      post(3, { mentions: ["#fix"] }),
      post(4, { from: "docs", mentions: ["coordinator"] }),
      post(5, { from: "fix-1" }),
      post(6, { kind: "stall", from: "monitor", mentions: ["coordinator"] }),
    ];
    const counts = (expandAll: boolean) => {
      const frame = graphFrame(
        [...team, member("old", { state: "killed", killedAt: "2025-12-31T00:00:00.000Z" })],
        posts,
        expandAll,
      );
      return {
        edges: Object.fromEntries(
          frame.edges.map((edge) => [`${edge.from}>${edge.to}`, [edge.count, edge.viaAll]]),
        ),
        all: Object.fromEntries(frame.allPosts),
        unaddressed: [...frame.unaddressed],
      };
    };
    expect(counts(false)).toEqual({
      edges: {
        "coordinator>fix-1": [2, false],
        "coordinator>fix-2": [2, false],
        "docs>coordinator": [1, false],
      },
      all: { coordinator: 1 },
      unaddressed: ["fix-1"],
    });
    expect(counts(true).edges["coordinator>docs"]).toEqual([1, true]);
    expect(counts(true).edges["coordinator>fix-1"]).toEqual([3, false]);
    expect(counts(true).edges["coordinator>old"]).toBeUndefined();
  });

  it("puts the coordinator on top", () => {
    const nodes = layoutGraph([member("a"), member("coordinator"), member("b")], 100, 100);
    expect(nodes[0]).toMatchObject({ member: { name: "coordinator" }, x: 50 });
    expect(nodes[0]!.y).toBeLessThan(nodes[1]!.y);
  });
});
