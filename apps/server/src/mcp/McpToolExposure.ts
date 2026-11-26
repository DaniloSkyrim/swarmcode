import type { McpToolExposureMode } from "@t3tools/provider-core/server/mcpSession";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export const TOOL_SEARCH = "tool_search";
export const T3_CALL = "t3_call";

/** What a `deferred` client lists before it searches. */
const DIRECT_TOOLS: ReadonlySet<string> = new Set([
  "orchestrator_capabilities",
  "delegate_task",
  "task_status",
  TOOL_SEARCH,
]);

/** Fixed eager set listed to `proxy` clients; never grows across turns. */
const PROXY_DIRECT_TOOLS: ReadonlySet<string> = new Set([
  "orchestrator_capabilities",
  "delegate_task",
  "task_status",
  "t3_swarm",
  "post_message",
  "read_board",
  "swarm_wait",
  TOOL_SEARCH,
  T3_CALL,
]);

const MAX_RESULTS = 10;
// Sessions that ended are never reported here, so keep only the newest.
const MAX_SESSIONS = 256;

export interface CatalogTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ListedTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
}

export class McpToolExposure extends Context.Service<
  McpToolExposure,
  {
    /**
     * Finds tools for the query. In `deferred` mode (default), adds matches to the session's
     * `tools/list` and notifies `list_changed`. In `proxy` mode, returns compact `inputSchema`s
     * for immediate invocation via `t3_call` without mutating `tools/list`.
     */
    readonly search: (
      providerSessionId: string,
      query: string,
      mode?: McpToolExposureMode,
    ) => Effect.Effect<ReadonlyArray<ListedTool>>;
    readonly isListed: (
      providerSessionId: string,
      tool: string,
      mode?: McpToolExposureMode,
    ) => boolean;
  }
>()("t3/mcp/McpToolExposure") {}

const score = (tool: CatalogTool, terms: ReadonlyArray<string>) => {
  const name = tool.name.toLowerCase();
  const description = tool.description.toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (term === name) total += 100;
    else if (name.includes(term)) total += 3;
    else if (description.includes(term)) total += 1;
  }
  return total;
};

export const make = (
  tools: () => ReadonlyArray<CatalogTool>,
  announceListChanged: () => Effect.Effect<void>,
) => {
  const loaded = new Map<string, Set<string>>();
  const load = (providerSessionId: string, names: ReadonlyArray<string>) => {
    const listed = loaded.get(providerSessionId) ?? new Set<string>();
    loaded.delete(providerSessionId);
    loaded.set(providerSessionId, listed);
    for (const name of names) listed.add(name);
    for (const oldest of loaded.keys()) {
      if (loaded.size <= MAX_SESSIONS) break;
      loaded.delete(oldest);
    }
  };
  return McpToolExposure.of({
    search: Effect.fn("McpToolExposure.search")(function* (
      providerSessionId,
      query,
      mode = "deferred",
    ) {
      const terms = query
        .toLowerCase()
        .split(/[^a-z0-9_]+/u)
        .filter(Boolean);
      const found = tools()
        .filter((tool) => tool.name !== TOOL_SEARCH && tool.name !== T3_CALL)
        .map((tool) => ({ tool, score: score(tool, terms) }))
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTS)
        .map((match) => match.tool);
      if (mode === "proxy") {
        return found.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        }));
      }
      if (found.length > 0) {
        load(
          providerSessionId,
          found.map((tool) => tool.name),
        );
        yield* announceListChanged();
      }
      return found.map(({ name, description }) => ({ name, description }));
    }),
    isListed: (providerSessionId, tool, mode = "deferred") => {
      if (mode === "proxy") return PROXY_DIRECT_TOOLS.has(tool);
      if (tool === T3_CALL) return false;
      return DIRECT_TOOLS.has(tool) || loaded.get(providerSessionId)?.has(tool) === true;
    },
  });
};
