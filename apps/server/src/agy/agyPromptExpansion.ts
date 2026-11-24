// Fork: turns `/plan`, `/swarm` and the other Antigravity-style commands into instructions for
// providers that lack them. The transcript keeps the user's text; only the provider sees this.
import { type AgyPromptCommand, parseAgyPromptCommands } from "@t3tools/contracts";

import {
  BOOST_PROMPT,
  BROWSER_PROMPT,
  GOAL_PROMPT,
  GRILL_ME_PROMPT,
  LEARN_PROMPT,
  PLAN_PROMPT,
  RUN_WORKFLOW_PROMPT,
  SCHEDULE_PROMPT,
  SWARM_COORDINATOR_PROMPT,
  TEAMWORK_PROMPT,
} from "./agyPrompts.ts";

/** Providers whose own CLI runs these commands; their text goes through untouched. */
const NATIVE_DRIVERS: ReadonlySet<string> = new Set(["antigravity"]);
/** Single commands a provider's CLI runs itself, beyond what its session advertises. */
const NATIVE_COMMANDS: Readonly<Record<string, ReadonlyArray<AgyPromptCommand>>> = {
  opencode: ["goal"],
};

const INSTRUCTIONS: Record<AgyPromptCommand, ReadonlyArray<string>> = {
  plan: [PLAN_PROMPT],
  "grill-me": [GRILL_ME_PROMPT],
  boost: [SWARM_COORDINATOR_PROMPT, BOOST_PROMPT],
  swarm: [SWARM_COORDINATOR_PROMPT],
  teamwork: [SWARM_COORDINATOR_PROMPT, TEAMWORK_PROMPT],
  goal: [GOAL_PROMPT],
  learn: [LEARN_PROMPT],
  browser: [BROWSER_PROMPT],
  schedule: [SCHEDULE_PROMPT],
  "run-workflow": [RUN_WORKFLOW_PROMPT],
};

export interface AgyExpansionSession {
  readonly driver: string;
  /** The provider runs `/goal` itself. */
  readonly nativeGoals: boolean;
}

export function expandAgyCommandText(text: string, session: AgyExpansionSession): string | null {
  if (NATIVE_DRIVERS.has(session.driver)) return null;
  const parsed = parseAgyPromptCommands(
    text,
    (command) =>
      !(command === "goal" && session.nativeGoals) &&
      !(NATIVE_COMMANDS[session.driver] ?? []).includes(command),
  );
  if (parsed === null) return null;
  const blocks = [...new Set(parsed.commands.flatMap((command) => INSTRUCTIONS[command]))];
  const task = parsed.task === "" ? "(no task text)" : parsed.task;
  return `${blocks.join("\n\n")}\n\nThe user invoked ${parsed.commands.map((command) => `/${command}`).join(" ")}. Their request:\n<user_request>\n${task}\n</user_request>`;
}

/** `message` with its text expanded, or `message` itself when nothing applies. */
export function expandAgyMessage<M extends { readonly text: string }>(
  message: M,
  session: AgyExpansionSession,
): M {
  const text = expandAgyCommandText(message.text, session);
  return text === null ? message : { ...message, text };
}
