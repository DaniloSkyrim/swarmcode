// Fork: the proxy tool exposure and t3_call (see mcpT3Call.ts), next to upstream's deferred mode.
import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import {
  EnvironmentId,
  OrchestratorMcpFailure,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as McpToolAccessTestkit from "../mcp/McpToolAccess.testkit.ts";

const environmentId = EnvironmentId.make("environment-mcp-test");

it.effect("proxy mode lists a fixed set and reaches every other tool through t3_call", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const scopeFor = (token: string): McpInvocationContext.McpThreadInvocationScope => ({
        environmentId,
        requestNamespace: token,
        thread: {
          threadId: ThreadId.make(`thread-${token}`),
          providerSessionId: token,
          providerInstanceId: ProviderInstanceId.make("copilot"),
        },
        client: undefined,
        capabilities: new Set(["orchestration"]),
        issuedAt: 1,
      });
      const scopes = new Map([
        ["deferringToken", scopeFor("deferringToken")],
        ["otherToken", scopeFor("otherToken")],
      ]);
      const tool = <const Name extends string>(name: Name, description: string) =>
        Tool.make(name, {
          description,
          success: Schema.Struct({}),
          failure: OrchestratorMcpFailure,
          failureMode: "return",
        });
      const typedTool = Tool.make("open_url", {
        description: "Opens a URL.",
        parameters: Schema.Struct({ url: Schema.String }),
        success: Schema.Struct({ opened: Schema.String }),
        failure: OrchestratorMcpFailure,
        failureMode: "return",
        dependencies: [McpInvocationContext.McpInvocationContext],
      }).annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);
      const linkedOnlyTool = tool("linked_only", "Requires linked environments.").annotate(
        McpSchema.EnabledWhen,
        McpInvocationContext.hiddenWhileLinksOff,
      );
      const OptionalToolkit = Toolkit.make(
        tool("delegate_task", "Delegates a task."),
        tool("t3_swarm", "Runs a swarm."),
        tool("post_message", "Posts to the board."),
        tool("read_board", "Reads the board."),
        tool("swarm_wait", "Waits for board posts."),
        tool("preview_open", "Opens a browser preview."),
        tool("schedule_task", "Schedules a task."),
        typedTool,
        linkedOnlyTool,
      );
      const reads = McpToolAccess.reads(() => Effect.succeed({}));
      const serverLayer = McpHttpServer.layerMcpTransport(
        Layer.mergeAll(
          McpHttpServer.toolkitRegistration(
            OptionalToolkit,
            McpToolAccess.toLayer(OptionalToolkit, {
              delegate_task: reads,
              t3_swarm: reads,
              post_message: reads,
              read_board: reads,
              swarm_wait: reads,
              preview_open: reads,
              schedule_task: reads,
              open_url: McpToolAccess.readsAsCaller(({ url }) => Effect.succeed({ opened: url })),
              linked_only: reads,
            }),
          ),
          McpHttpServer.layerToolSearch,
        ),
      ).pipe(
        Layer.provide(ServerSettings.layerTest()),
        Layer.provide(McpToolAccessTestkit.liveThreadsLayer),
        Layer.provide(
          Layer.mock(McpSessionRegistry.McpSessionRegistry)({
            resolve: (token) => Effect.succeed(scopes.get(token)),
          }),
        ),
      );
      yield* HttpRouter.serve(serverLayer, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.build,
      );
      const httpClient = yield* HttpClient.HttpClient;
      const session = (token: string, exposure?: "deferred" | "proxy") =>
        Effect.gen(function* () {
          const headers = {
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${token}`,
            ...(exposure ? { "t3-tool-exposure": exposure } : {}),
          };
          const initialize = yield* httpClient.post("/mcp", {
            headers,
            body: HttpBody.text(
              `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}`,
              "application/json",
            ),
          });
          const rpcRaw = (method: string, params: object) =>
            httpClient
              .post("/mcp", {
                headers: {
                  ...headers,
                  "mcp-session-id": initialize.headers["mcp-session-id"]!,
                  "mcp-protocol-version": "2025-06-18",
                },
                body: HttpBody.text(
                  JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }),
                  "application/json",
                ),
              })
              .pipe(
                Effect.flatMap((response) => response.text),
                Effect.map((raw) => ({
                  raw,
                  // tool_search in deferred mode answers over SSE, after its list_changed notification.
                  body: raw
                    .split("\n")
                    .filter((line) => line.startsWith("data: ") || line.startsWith("{"))
                    .map((line) => JSON.parse(line.replace(/^data: /u, "")) as { id?: number })
                    .find((message) => message.id === 2) as unknown,
                })),
              );
          const rpc = (method: string, params: object) =>
            rpcRaw(method, params).pipe(Effect.map(({ body }) => body));
          return {
            listed: rpc("tools/list", {}).pipe(
              Effect.map((body) =>
                (body as { result: { tools: ReadonlyArray<{ name: string }> } }).result.tools
                  .map((listed) => listed.name)
                  .sort(),
              ),
            ),
            callRaw: (name: string, args: object) =>
              rpcRaw("tools/call", { name, arguments: args }),
            call: (name: string, args: object) =>
              rpc("tools/call", { name, arguments: args }).pipe(
                Effect.map(
                  (body) =>
                    (
                      body as {
                        result: {
                          isError?: boolean;
                          structuredContent?: unknown;
                          content?: ReadonlyArray<{ type: string; text?: string }>;
                        };
                      }
                    ).result,
                ),
              ),
          };
        });

      const deferring = yield* session("deferringToken", "deferred");
      const proxied = yield* session("deferringToken", "proxy");
      const other = yield* session("otherToken");

      // Deferred mode (Copilot CLI) keeps only the upstream direct tools — no swarm tools or t3_call.
      expect(yield* deferring.listed).toEqual(["delegate_task", "tool_search"]);
      expect(yield* other.listed).toEqual([
        "delegate_task",
        "open_url",
        "post_message",
        "preview_open",
        "read_board",
        "schedule_task",
        "swarm_wait",
        "t3_swarm",
      ]);
      // Unlisted tools stay callable.
      expect((yield* deferring.call("schedule_task", {})).structuredContent).toEqual({});

      const deferredSearch = yield* deferring.callRaw("tool_search", { query: "browser" });
      expect(deferredSearch.raw).toContain("notifications/tools/list_changed");
      expect(
        (deferredSearch.body as { result: { structuredContent?: unknown } }).result
          .structuredContent,
      ).toEqual({ tools: [{ name: "preview_open", description: "Opens a browser preview." }] });
      expect(yield* deferring.listed).toEqual(["delegate_task", "preview_open", "tool_search"]);
      expect(yield* other.listed).toEqual([
        "delegate_task",
        "open_url",
        "post_message",
        "preview_open",
        "read_board",
        "schedule_task",
        "swarm_wait",
        "t3_swarm",
      ]);

      // Proxy mode (Antigravity) lists a fixed compact set including swarm tools + tool_search + t3_call.
      const proxyDirect = [
        "delegate_task",
        "post_message",
        "read_board",
        "swarm_wait",
        "t3_call",
        "t3_swarm",
        "tool_search",
      ];
      expect(yield* proxied.listed).toEqual(proxyDirect);

      // In proxy mode, tool_search returns compact inputSchema without mutating tools/list or emitting list_changed.
      const proxySearch = yield* proxied.callRaw("tool_search", { query: "browser" });
      expect(proxySearch.raw).not.toContain("notifications/tools/list_changed");
      expect(
        (proxySearch.body as { result: { structuredContent?: unknown } }).result.structuredContent,
      ).toEqual({
        tools: [
          {
            name: "preview_open",
            description: "Opens a browser preview.",
            inputSchema: expect.objectContaining({ type: "object" }),
          },
        ],
      });
      expect(yield* proxied.listed).toEqual(proxyDirect);

      // t3_call invokes unlisted tools in the same turn, passes typed/JSON arguments, and enforces guards & EnabledWhen.
      expect(
        (yield* proxied.call("t3_call", { tool: "preview_open", arguments: {} })).structuredContent,
      ).toEqual({});
      expect(
        (yield* proxied.call("t3_call", {
          tool: "open_url",
          arguments: { url: "https://example.com" },
        })).structuredContent,
      ).toEqual({ opened: "https://example.com" });
      expect(
        (yield* proxied.call("t3_call", { tool: "schedule_task", arguments: "{}" }))
          .structuredContent,
      ).toEqual({});
      expect(yield* proxied.call("t3_call", { tool: "open_url", arguments: {} })).toMatchObject({
        isError: true,
      });
      expect(yield* proxied.call("t3_call", { tool: "linked_only", arguments: {} })).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("not available in this session") }],
      });
      expect(yield* proxied.call("t3_call", { tool: "t3_call", arguments: {} })).toMatchObject({
        isError: true,
      });
      expect(
        yield* proxied.call("t3_call", { tool: "does_not_exist", arguments: {} }),
      ).toMatchObject({
        isError: true,
      });

      // Prefixed T3 tool names normalize cleanly, recursion stays blocked, and stray toolSummary is stripped.
      expect(
        (yield* proxied.call("t3_call", {
          tool: "mcp_t3-code_open_url",
          arguments: { url: "https://prefixed.example", toolSummary: "Open prefixed URL" },
        })).structuredContent,
      ).toEqual({ opened: "https://prefixed.example" });
      expect(
        yield* proxied.call("t3_call", { tool: "mcp_t3-code_t3_call", arguments: {} }),
      ).toMatchObject({
        isError: true,
      });

      // Stateless 2026-07-28 (negotiated by agy via server/discover) has no McpServerClient; t3_call must still work.
      const statelessRpc = (method: string, params: Record<string, unknown>) =>
        httpClient
          .post("/mcp", {
            headers: {
              accept: "application/json, text/event-stream",
              authorization: "Bearer deferringToken",
              "t3-tool-exposure": "proxy",
              "mcp-method": method,
              "mcp-protocol-version": "2026-07-28",
              ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
            },
            body: HttpBody.text(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 9,
                method,
                params: {
                  ...params,
                  _meta: {
                    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                    "io.modelcontextprotocol/clientCapabilities": {},
                    "io.modelcontextprotocol/clientInfo": { name: "agy-probe", version: "1.5.16" },
                  },
                },
              }),
              "application/json",
            ),
          })
          .pipe(
            Effect.flatMap((response) => response.json),
            Effect.map(
              (body) =>
                body as {
                  error?: unknown;
                  result?: {
                    tools?: ReadonlyArray<{ name: string }>;
                    isError?: boolean;
                    structuredContent?: unknown;
                  };
                },
            ),
          );
      const statelessListed = yield* statelessRpc("tools/list", {});
      expect(statelessListed.error).toBeUndefined();
      expect(statelessListed.result?.tools?.map((item) => item.name).sort()).toEqual(proxyDirect);
      const statelessSearch = yield* statelessRpc("tools/call", {
        name: "tool_search",
        arguments: { query: "browser" },
      });
      expect(statelessSearch.error).toBeUndefined();
      expect(statelessSearch.result?.structuredContent).toEqual({
        tools: [
          {
            name: "preview_open",
            description: "Opens a browser preview.",
            inputSchema: expect.objectContaining({ type: "object" }),
          },
        ],
      });
      const statelessCall = yield* statelessRpc("tools/call", {
        name: "t3_call",
        arguments: {
          tool: "mcp_t3-code_open_url",
          arguments: { url: "https://stateless.example", toolSummary: "Open over 2026-07-28" },
        },
      });
      expect(statelessCall.error).toBeUndefined();
      expect(statelessCall.result).toMatchObject({
        isError: false,
        structuredContent: {
          opened: "https://stateless.example",
        },
      });
      const statelessDisabled = yield* statelessRpc("tools/call", {
        name: "t3_call",
        arguments: { tool: "linked_only", arguments: {} },
      });
      expect(statelessDisabled.error).toBeUndefined();
      expect(statelessDisabled.result?.isError).toBe(true);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
