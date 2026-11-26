import "~/index.css";

import {
  EnvironmentId,
  ThreadId,
  type AgySwarmMember,
  type AgySwarmPlan,
  type AgySwarmPost,
  type AgySwarmSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { SwarmOverview } from "./SwarmOverview";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-coordinator"),
};

function makeMember(name: string, overrides: Partial<AgySwarmMember> = {}): AgySwarmMember {
  return {
    name,
    threadId: ThreadId.make(`thread-${name}`),
    role: name === "coordinator" ? "coordinator" : "worker",
    workspace: "inherit",
    channels: ["main"],
    state: "working",
    lastReadSeq: 0,
    lastPostSeq: null,
    killedAt: null,
    activity: null,
    model: "gemini-3.1-pro",
    ...overrides,
  } as AgySwarmMember;
}

function makePost(seq: number, overrides: Partial<AgySwarmPost> = {}): AgySwarmPost {
  return {
    seq,
    from: "coordinator",
    text: "",
    mentions: [],
    channel: "main",
    kind: "post",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<AgySwarmSnapshot> = {}): AgySwarmSnapshot {
  const members: ReadonlyArray<AgySwarmMember> = [
    makeMember("coordinator", {
      state: "waiting",
      lastPostSeq: 1,
    }),
    makeMember("alpha", { state: "working", activity: "Auditing layout tokens" }),
    makeMember("beta", { state: "working", activity: "Running browser checks" }),
    makeMember("gamma", { state: "waiting", lastPostSeq: 2 }),
    makeMember("delta", { state: "needs-input", activity: "Waiting for confirmation" }),
    makeMember("epsilon", { state: "working" }),
    makeMember("zeta", { state: "working" }),
    makeMember("eta", { state: "stopped" }),
  ];
  const posts: ReadonlyArray<AgySwarmPost> = [
    makePost(1, {
      from: "coordinator",
      text: "Spinning up specialists to map every surface before building.",
    }),
    makePost(2, {
      from: "gamma",
      mentions: ["coordinator"],
      text: "@coordinator [done] Verified contracts and helper exports.",
    }),
  ];
  return {
    id: "swarm-1",
    kind: "swarm",
    title: "Overview Redesign",
    coordinatorThreadId: ThreadId.make("thread-coordinator"),
    head: posts.length,
    doneAt: null,
    channels: [{ name: "main", archived: false }],
    members,
    posts,
    plan: null,
    ...overrides,
  } as unknown as AgySwarmSnapshot;
}

describe("SwarmOverview", () => {
  it("renders the Antigravity-inspired starting state and interactive team selector before a plan exists", async () => {
    const onOpenMember = vi.fn();
    const onFilterBoardByMember = vi.fn();
    const swarm = makeSnapshot();

    await using screen = await render(
      <div className="flex h-[760px] w-[460px] flex-col bg-background text-foreground">
        <SwarmOverview
          swarm={swarm}
          threadRef={threadRef}
          onOpenMember={onOpenMember}
          onFilterBoardByMember={onFilterBoardByMember}
        />
      </div>,
    );

    await expect.element(screen.getByText("Your swarm is starting")).toBeVisible();
    await expect.element(screen.getByText("One goal")).toBeVisible();
    await expect.element(screen.getByText("Many workers")).toBeVisible();
    await expect.element(screen.getByText("One board")).toBeVisible();
    await expect.element(screen.getByText("Waiting for the first update")).toBeVisible();

    const coordinatorCard = screen.getByTestId("swarm-overview-coordinator");
    await expect.element(coordinatorCard).toBeVisible();
    await expect
      .element(
        coordinatorCard.getByText("Spinning up specialists to map every surface before building."),
      )
      .toBeVisible();

    const strip = screen.getByTestId("swarm-overview-team-strip");
    const allTile = strip.element().querySelector<HTMLButtonElement>('[data-team-tile="all"]');
    expect(allTile?.getAttribute("aria-pressed")).toBe("true");
    // 5 visible alphabetically: alpha, beta, delta, epsilon, eta; gamma & zeta behind +2.
    expect(strip.element().querySelector('[data-team-tile="alpha"]')).not.toBeNull();
    expect(strip.element().querySelector('[data-team-tile="zeta"]')).toBeNull();
    const moreTile = strip.element().querySelector<HTMLButtonElement>('[data-team-tile="more"]');
    expect(moreTile).not.toBeNull();
    expect(moreTile?.textContent).toContain("+2");

    // Clicking a worker tile selects it, keeps the Coordinator card unchanged, and reveals actions.
    const alphaTile = strip.element().querySelector<HTMLButtonElement>('[data-team-tile="alpha"]')!;
    await userEvent.click(alphaTile);
    expect(alphaTile.getAttribute("aria-pressed")).toBe("true");
    expect(allTile?.getAttribute("aria-pressed")).toBe("false");
    await expect
      .element(
        coordinatorCard.getByText("Spinning up specialists to map every surface before building."),
      )
      .toBeVisible();

    const detail = screen.getByTestId("swarm-overview-worker-detail");
    await expect.element(detail).toBeVisible();
    await expect.element(detail.getByText("Auditing layout tokens")).toBeVisible();

    await userEvent.click(detail.getByRole("button", { name: "Open thread" }));
    expect(onOpenMember).toHaveBeenCalledTimes(1);
    expect(onOpenMember.mock.calls[0]?.[0]?.name).toBe("alpha");

    await userEvent.click(detail.getByRole("button", { name: "View on board" }));
    expect(onFilterBoardByMember).toHaveBeenCalledWith("alpha");

    // Expand +2 to see gamma and zeta, then collapse back with Less.
    await userEvent.click(moreTile!);
    expect(strip.element().querySelector('[data-team-tile="zeta"]')).not.toBeNull();
    const lessTile = strip.element().querySelector<HTMLButtonElement>('[data-team-tile="less"]')!;
    await userEvent.click(lessTile);
    expect(strip.element().querySelector('[data-team-tile="zeta"]')).toBeNull();

    // Selecting All clears the worker detail card.
    await userEvent.click(allTile!);
    await expect
      .element(screen.getByTestId("swarm-overview-worker-detail"))
      .not.toBeInTheDocument();
  });

  it("renders plan progress, milestones, and filters threads and rounds by selected worker", async () => {
    const plan: AgySwarmPlan = {
      goal: {
        title: "Ship Swarm Overview",
        line: "Unify starting hero, team roster, and execution plan.",
      },
      mode: "teamwork",
      integrityMode: "development",
      projectDir: "/repo/swarmcode",
      milestones: [
        {
          id: "m1",
          title: "Design tokens & sprites",
          status: "passed",
          gates: { critic: "passed", challenger: "passed", auditor: "passed" },
        },
        {
          id: "m2",
          title: "Browser verification",
          status: "in_progress",
          gates: { critic: "passed", challenger: "running", auditor: "pending" },
        },
      ],
      rounds: [
        { round: 1, worker: "alpha", status: "fixed", summary: "Tightened tile alignment." },
        { round: 2, worker: "beta", status: "clean", summary: "Browser assertions green." },
      ],
      finalAudit: { status: "pending", summary: "Awaiting milestone 2." },
      artifacts: [{ label: "Spec", path: "docs/overview.md" }],
      threads: [
        { id: "t-ui", title: "UI Polish", goal: "Match Antigravity layout", tasks: ["alpha"] },
        { id: "t-qa", title: "Verification", goal: "Cover regressions", tasks: ["beta"] },
      ],
      tasks: {
        alpha: "Build starting hero and team strip",
        beta: "Write Chromium component tests",
      },
    };
    const swarm = makeSnapshot({ plan });

    await using screen = await render(
      <div className="flex h-[760px] w-[460px] flex-col bg-background text-foreground">
        <SwarmOverview
          swarm={swarm}
          threadRef={threadRef}
          onOpenMember={vi.fn()}
          onFilterBoardByMember={vi.fn()}
        />
      </div>,
    );

    await expect
      .element(screen.getByTestId("swarm-overview-starting-hero"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Ship Swarm Overview")).toBeVisible();
    await expect.element(screen.getByText("Design tokens & sprites")).toBeVisible();
    await expect.element(screen.getByText("UI Polish")).toBeVisible();
    await expect.element(screen.getByText("Verification")).toBeVisible();
    await expect.element(screen.getByText("Tightened tile alignment.")).toBeVisible();
    await expect.element(screen.getByText("Browser assertions green.")).toBeVisible();

    const strip = screen.getByTestId("swarm-overview-team-strip");
    await userEvent.click(
      strip.element().querySelector<HTMLButtonElement>('[data-team-tile="alpha"]')!,
    );

    await expect.element(screen.getByText("UI Polish")).toBeVisible();
    await expect.element(screen.getByText("Tightened tile alignment.")).toBeVisible();
    await expect.element(screen.getByText("Verification")).not.toBeInTheDocument();
    await expect.element(screen.getByText("Browser assertions green.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show all" }));
    await expect.element(screen.getByText("Verification")).toBeVisible();
    await expect.element(screen.getByText("Browser assertions green.")).toBeVisible();
  });
});
