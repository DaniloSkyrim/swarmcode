import { assert, it } from "@effect/vitest";

import * as Board from "./swarmBoard.ts";

const at = (minute: number) => `2026-11-24T10:${String(minute).padStart(2, "0")}:00.000Z`;

function swarmWith(names: ReadonlyArray<string>) {
  const swarm = Board.newSwarm({
    id: "s1",
    kind: "swarm",
    projectId: "p1",
    coordinatorThreadId: "t-coordinator",
    instanceId: "claude",
    model: "claude/sonnet",
    now: at(0),
  });
  for (const name of names) {
    swarm.members.push({
      ...swarm.members[0]!,
      name,
      threadId: `t-${name}`,
      role: "worker",
      addedBy: Board.COORDINATOR,
      channels: [Board.MAIN_CHANNEL],
      brief: `do ${name}`,
    });
  }
  return swarm;
}

const post = (swarm: Board.StoredSwarm, from: string, text: string, minute = 1) => {
  const result = Board.appendPost(swarm, { from, text, now: at(minute) });
  if ("refused" in result) throw new Error(result.refused);
  return result;
};

it("a mention wakes the named member, a numbered group, and @all, never the author", () => {
  const swarm = swarmWith(["parser", "fix-1", "fix-2", "fixer"]);
  const names = (text: string) =>
    Board.wakeTargets(swarm, post(swarm, "parser", text)).map((member) => member.name);

  assert.deepStrictEqual(names("@coordinator done"), ["coordinator"]);
  assert.deepStrictEqual(names("@fix please"), ["fix-1", "fix-2"]);
  assert.deepStrictEqual(names("@all heads up"), ["coordinator", "fix-1", "fix-2", "fixer"]);
  assert.deepStrictEqual(names("no one in particular"), []);
  assert.deepStrictEqual(names("mail me at a@parser.dev"), []);
});

it("channels scope wakes and reads, and @#main is refused", () => {
  const swarm = swarmWith(["ui", "api"]);
  swarm.channels.push({ name: "web", topic: "", createdBy: "coordinator", archived: false });
  Board.memberByName(swarm, "ui")!.channels.push("web");

  const inWeb = Board.appendPost(swarm, { from: "ui", text: "@#web styles landed", now: at(1) });
  assert.isFalse("refused" in inWeb);
  if ("refused" in inWeb) return;
  assert.strictEqual(inWeb.channel, "web");
  assert.deepStrictEqual(
    Board.wakeTargets(swarm, inWeb).map((member) => member.name),
    ["coordinator"],
  );
  const api = Board.memberByName(swarm, "api")!;
  assert.deepStrictEqual(Board.readPosts(swarm, api, { since: 0, limit: 10 }), []);

  const refused = Board.appendPost(swarm, { from: "ui", text: "@#main everyone", now: at(2) });
  assert.isTrue("refused" in refused);
});

it("the coordinator's unaddressed [done] ends the swarm, a mentioned one does not", () => {
  const swarm = swarmWith(["parser"]);
  const midBrief = Board.appendPost(swarm, {
    from: "parser",
    text: "initial task",
    kind: "brief",
    now: at(0),
  });
  assert.isFalse("refused" in midBrief);
  assert.isNull(swarm.doneAt);
  post(swarm, Board.COORDINATOR, "[done] @parser thanks");
  assert.isNull(swarm.doneAt);
  post(swarm, Board.COORDINATOR, "[done] parser shipped");
  assert.strictEqual(swarm.doneAt, at(1));

  // Non-brief posts after [done] leave the finished board closed.
  const killNotice = Board.appendPost(swarm, {
    from: Board.COORDINATOR,
    text: "killed parser",
    kind: "system",
    now: at(2),
  });
  assert.isFalse("refused" in killNotice);
  assert.strictEqual(swarm.doneAt, at(1));

  const reopen = Board.appendPost(swarm, {
    from: "parser",
    text: "next task",
    kind: "brief",
    now: at(3),
  });
  assert.isFalse("refused" in reopen);
  assert.isNull(swarm.doneAt);

  post(swarm, Board.COORDINATOR, "[done] next task shipped", 4);
  assert.strictEqual(swarm.doneAt, at(4));
});

it("names are validated, reserved, and never reused after a kill", () => {
  const swarm = swarmWith(["parser"]);
  assert.isNotNull(Board.validateNewName(swarm, "Parser"));
  assert.isNotNull(Board.validateNewName(swarm, "all"));
  assert.isNotNull(Board.validateNewName(swarm, "parser"));
  Board.memberByName(swarm, "parser")!.killedAt = at(2);
  assert.match(Board.validateNewName(swarm, "parser") ?? "", /killed/u);
  assert.isNull(Board.validateNewName(swarm, "lexer"));
});

it("the stall monitor nudges an unanswered member once, then escalates to the coordinator", () => {
  const swarm = swarmWith(["parser"]);
  post(swarm, Board.COORDINATOR, "@parser take the parser", 0);
  Board.memberByName(swarm, Board.COORDINATOR)!.lastReadSeq = Board.head(swarm);
  const idle = swarm.members.map((member) => ({
    name: member.name,
    state: "waiting" as const,
    lastPostSeq: Board.lastPostSeq(swarm, member.name),
  }));
  const options = { nowMs: Date.parse(at(5)), quietMs: 3 * 60_000, repeatMs: 10 * 60_000 };

  const first = Board.detectStall(swarm, idle, options);
  assert.strictEqual(first?.to, "parser");
  swarm.stall = { key: first!.key, count: 1, lastAt: at(5), headAtAlert: Board.head(swarm) };

  const second = Board.detectStall(swarm, idle, options);
  assert.strictEqual(second?.to, Board.COORDINATOR);
  assert.match(second?.text ?? "", /even after a reminder/u);

  const working = idle.map((state) => ({ ...state, state: "working" as const }));
  assert.isNull(Board.detectStall(swarm, working, options));
});

it("the stall monitor stays quiet until the board has been quiet long enough", () => {
  const swarm = swarmWith(["parser"]);
  post(swarm, "parser", "thinking out loud", 4);
  const idle = swarm.members.map((member) => ({
    name: member.name,
    state: "waiting" as const,
    lastPostSeq: null,
  }));
  assert.isNull(
    Board.detectStall(swarm, idle, { nowMs: Date.parse(at(5)), quietMs: 3 * 60_000, repeatMs: 0 }),
  );
  const late = Board.detectStall(swarm, idle, {
    nowMs: Date.parse(at(9)),
    quietMs: 3 * 60_000,
    repeatMs: 0,
  });
  assert.match(late?.text ?? "", /#1 \(parser\) addressed nobody/u);
});

it("the stall monitor wakes the coordinator when workers only answered each other", () => {
  const swarm = swarmWith(["alpha", "beta"]);
  post(swarm, Board.COORDINATOR, "@alpha count, @beta check it", 0);
  post(swarm, "alpha", "@beta 377 lines", 1);
  post(swarm, "beta", "@alpha above 300: yes", 2);
  const idle = swarm.members.map((member) => ({
    name: member.name,
    state: "waiting" as const,
    lastPostSeq: Board.lastPostSeq(swarm, member.name),
  }));
  const alert = Board.detectStall(swarm, idle, {
    nowMs: Date.parse(at(9)),
    quietMs: 3 * 60_000,
    repeatMs: 10 * 60_000,
  });
  assert.strictEqual(alert?.to, Board.COORDINATOR);
  assert.match(alert?.text ?? "", /not read #2 \(alpha\), #3 \(beta\)/u);
});

it("graph edges count mentions per pair", () => {
  const swarm = swarmWith(["parser", "lexer"]);
  post(swarm, Board.COORDINATOR, "@parser go");
  post(swarm, Board.COORDINATOR, "@parser again");
  post(swarm, "parser", "@all done");
  const edges = Board.graphEdges(swarm);
  assert.deepStrictEqual(
    edges.find((edge) => edge.from === "coordinator" && edge.to === "parser")?.count,
    2,
  );
  assert.strictEqual(edges.filter((edge) => edge.from === "parser").length, 2);
});

it("a member is rung once for the posts that named it, not again until the board moves", () => {
  const swarm = swarmWith(["parser"]);
  const coordinator = Board.memberByName(swarm, Board.COORDINATOR)!;
  for (const text of ["@coordinator one", "@coordinator two", "for nobody"]) {
    const created = post(swarm, "parser", text);
    for (const target of Board.wakeTargets(swarm, created)) target.lastWakeSeq = created.seq;
  }
  const unread = Board.unreadWakePosts(swarm, coordinator, 0);
  assert.deepEqual(
    unread.map((item) => item.text),
    ["@coordinator one", "@coordinator two"],
  );
  assert.deepEqual(Board.unreadWakePosts(swarm, coordinator, coordinator.lastWakeSeq), []);
  coordinator.lastReadSeq = Board.head(swarm);
  assert.deepEqual(Board.unreadWakePosts(swarm, coordinator, 0), []);
});
