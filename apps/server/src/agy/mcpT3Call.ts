// Fork: the `proxy` tool exposure. A provider session that sends that mode lists a fixed
// compact tool set plus `tool_search` and `t3_call`, and reaches every other T3 tool through
// `t3_call`, so its `tools/list` never grows. The registration and dispatch stay in
// McpHttpServer.ts, the only file allowed to touch McpServer; the rest lives here.
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { McpSchema } from "effect/ai";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";
import type { McpToolExposureMode } from "@t3tools/provider-core/server/mcpSession";

import * as McpToolExposure from "../mcp/McpToolExposure.ts";

/** The exposure mode a session asked for in its MCP_TOOL_EXPOSURE_HEADER, as a context field. */
export const toolExposureField = (
  header: string | undefined,
): { readonly toolExposure?: McpToolExposureMode } =>
  header === "deferred" || header === "proxy" ? { toolExposure: header } : {};

export const tool = new McpSchema.Tool({
  name: McpToolExposure.T3_CALL,
  description:
    "Invoke any T3 Code tool found via tool_search in the same turn. Pass the exact tool name and an arguments object matching its inputSchema.",
  inputSchema: {
    type: "object",
    properties: {
      tool: {
        type: "string",
        description:
          "Exact T3 Code tool name returned by tool_search (e.g. preview_open, t3_thread_read).",
      },
      arguments: {
        type: "object",
        description: "Arguments object matching the tool's inputSchema from tool_search.",
      },
    },
    required: ["tool"],
  },
  annotations: {
    title: "Call a T3 Code tool",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
});

export const error = (message: string) =>
  new McpSchema.CallToolResult({
    isError: true,
    content: [{ type: "text", text: message }],
  });

export const unknownToolError = (name: string) =>
  error(
    `Unknown T3 Code tool "${name}". Call tool_search to find available tools and their schemas.`,
  );

export const unavailableToolError = (name: string) =>
  error(
    `T3 Code tool "${name}" is not available in this session. Call tool_search to see enabled tools.`,
  );

const decodeJsonObjectArg = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const normalizeTarget = (raw: string): string => {
  const trimmed = raw.trim();
  const known = resolveT3McpToolId(trimmed);
  if (known !== null) return known;
  const stripped = /^(?:mcp[-_]{1,2})?t3[-_ ]?code(?:__|[-_.:/ ])(?<tool>.+)$/i.exec(trimmed);
  return stripped?.groups?.tool?.trim() || trimmed;
};

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Predicate.isReadonlyObject(value) && !Array.isArray(value);

/** Validates a `t3_call` payload: an error result, or the target tool and its arguments. */
export const parsePayload = (
  payload: unknown,
  fromThread: boolean,
):
  | { readonly error: McpSchema.CallToolResult }
  | { readonly name: string; readonly args: Record<string, unknown> } => {
  if (!fromThread) {
    return {
      error: error(
        "t3_call acts as the calling T3 thread and requires an agent running inside T3 Code.",
      ),
    };
  }
  if (!isPlainObject(payload)) {
    return { error: error("t3_call expects an object with { tool, arguments }.") };
  }
  const name = typeof payload.tool === "string" ? normalizeTarget(payload.tool) : "";
  if (name.length === 0) {
    return {
      error: error(
        "t3_call requires a non-empty `tool` string. Call tool_search to find available tools.",
      ),
    };
  }
  if (name === McpToolExposure.T3_CALL) {
    return {
      error: error(
        "Cannot invoke t3_call recursively. Pass the target T3 Code tool name directly.",
      ),
    };
  }
  const raw = payload.arguments;
  if (raw === undefined || raw === null) return { name, args: {} };
  if (typeof raw === "string") {
    const parsed = decodeJsonObjectArg(raw);
    return Option.isSome(parsed) && isPlainObject(parsed.value)
      ? { name, args: { ...parsed.value } }
      : {
          error: error(
            `t3_call \`arguments\` for ${name} must be a JSON object matching its inputSchema.`,
          ),
        };
  }
  return isPlainObject(raw)
    ? { name, args: { ...raw } }
    : {
        error: error(
          `t3_call \`arguments\` for ${name} must be an object matching its inputSchema.`,
        ),
      };
};

/** Drops a `toolSummary` the target does not declare, which models often add anyway. */
export const withoutUnacceptedToolSummary = (
  target: McpSchema.Tool,
  args: Record<string, unknown>,
): Record<string, unknown> => {
  if (!("toolSummary" in args)) return args;
  const schema = target.inputSchema;
  const properties = Predicate.isReadonlyObject(schema) ? schema.properties : undefined;
  if (Predicate.isReadonlyObject(properties) && Object.hasOwn(properties, "toolSummary")) {
    return args;
  }
  const { toolSummary: _toolSummary, ...rest } = args;
  return rest;
};
