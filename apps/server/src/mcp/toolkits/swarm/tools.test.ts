import { assert, it } from "@effect/vitest";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { advertisedJsonSchema } from "../../advertisedJsonSchema.ts";
import { SwarmToolkit } from "./tools.ts";

function findForbiddenSchemaConstructs(node: unknown, path = "$"): string[] {
  const issues: string[] = [];
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      issues.push(...findForbiddenSchemaConstructs(item, `${path}[${index}]`));
    }
    return issues;
  }
  if (!Predicate.isObject(node)) return issues;
  for (const [key, value] of Object.entries(node)) {
    if (key === "anyOf" || key === "oneOf") {
      issues.push(`${path}.${key}`);
    }
    if (key === "additionalProperties" && Predicate.isObject(value)) {
      issues.push(`${path}.additionalProperties(object)`);
    }
    issues.push(...findForbiddenSchemaConstructs(value, `${path}.${key}`));
  }
  return issues;
}

it("advertises flat Antigravity-compatible JSON Schemas for all swarm tools", () => {
  const toolNames = Object.keys(SwarmToolkit.tools).toSorted();
  assert.deepStrictEqual(toolNames, ["post_message", "read_board", "swarm_wait", "t3_swarm"]);

  for (const [name, tool] of Object.entries(SwarmToolkit.tools)) {
    const schema = advertisedJsonSchema(tool);
    assert.deepStrictEqual(
      findForbiddenSchemaConstructs(schema),
      [],
      `Tool ${name} advertised an incompatible JSON Schema construct`,
    );
  }

  const swarmProps = advertisedJsonSchema(SwarmToolkit.tools.t3_swarm).properties as Record<
    string,
    { type?: string }
  >;
  assert.strictEqual(swarmProps.n?.type, "integer");

  const readProps = advertisedJsonSchema(SwarmToolkit.tools.read_board).properties as Record<
    string,
    { type?: string }
  >;
  assert.strictEqual(readProps.since?.type, "integer");
  assert.strictEqual(readProps.limit?.type, "integer");

  const waitProps = advertisedJsonSchema(SwarmToolkit.tools.swarm_wait).properties as Record<
    string,
    { type?: string }
  >;
  assert.strictEqual(waitProps.since?.type, "integer");
  assert.strictEqual(waitProps.timeout?.type, "integer");

  const swarmPayloadBytes = Buffer.byteLength(
    JSON.stringify({
      name: SwarmToolkit.tools.t3_swarm.name,
      description: SwarmToolkit.tools.t3_swarm.description,
      inputSchema: advertisedJsonSchema(SwarmToolkit.tools.t3_swarm),
    }),
  );
  assert.isBelow(
    swarmPayloadBytes,
    5_200,
    `t3_swarm advertised payload grew to ${swarmPayloadBytes} bytes`,
  );
});

it("decodes batch workers, workerTasks, and planTasks cleanly", () => {
  const decode = Schema.decodeUnknownSync(SwarmToolkit.tools.t3_swarm.parametersSchema);
  const batch = decode({
    action: "add",
    workers: [
      { name: "api", brief: "implement endpoints", workspace: "worktree" },
      { name: "ui", brief: "wire panel", channels: ["frontend"] },
    ],
  });
  assert.lengthOf(batch.workers ?? [], 2);

  const plan = decode({
    action: "plan",
    goal: { title: "Ship swarm fixes", line: "Stabilize board and spawns." },
    planTasks: [{ worker: "api", summary: "endpoints" }],
  });
  assert.deepStrictEqual(plan.planTasks, [{ worker: "api", summary: "endpoints" }]);

  const numbered = decode({
    action: "add",
    name: "fix",
    brief: "fix lint errors",
    n: 2,
    workerTasks: ["packages/contracts", "apps/server"],
  });
  assert.strictEqual(numbered.n, 2);
  assert.lengthOf(numbered.workerTasks ?? [], 2);

  const withPhase3 = decode({
    action: "add",
    name: "worker",
    brief: "implement feature",
    reasoningEffort: "high",
    owns: ["apps/server/src/agy"],
  });
  assert.strictEqual(withPhase3.reasoningEffort, "high");
  assert.deepStrictEqual(withPhase3.owns, ["apps/server/src/agy"]);

  const selfSwitch = decode({
    action: "model",
    model: "gemini-3.8-flash",
    reasoningEffort: "medium",
    resume: true,
  });
  assert.isUndefined(selfSwitch.name);
  assert.strictEqual(selfSwitch.resume, true);

  const teamworkManager = decode({
    action: "add",
    name: "orchestrator",
    brief: "Drive milestones",
    manager: true,
    workers: [{ name: "auditor", brief: "Audit codebase", readOnly: true }],
  });
  assert.strictEqual(teamworkManager.manager, true);
  assert.strictEqual(teamworkManager.workers?.[0]?.readOnly, true);

  const richPlan = decode({
    action: "plan",
    goal: { title: "Ship Teamwork v2", line: "3 milestones with review gates" },
    mode: "general",
    integrityMode: "development",
    projectDir: "/tmp/project",
    artifacts: [{ label: "Plan", path: "/tmp/project/plan.md" }],
    milestones: [
      {
        id: "m1",
        title: "Bootstrap",
        status: "verifying",
        gates: { critic: "passed", challenger: "running", auditor: "pending" },
      },
    ],
    rounds: [{ round: 0, status: "fixed", worker: "deep-coder", summary: "Baseline done" }],
    finalAudit: { status: "running", auditor: "success-auditor", summary: "Checking build" },
  });
  assert.strictEqual(richPlan.integrityMode, "development");
  assert.strictEqual(richPlan.milestones?.[0]?.gates?.critic, "passed");
  assert.strictEqual(richPlan.rounds?.[0]?.status, "fixed");
  assert.strictEqual(richPlan.finalAudit?.status, "running");
});
