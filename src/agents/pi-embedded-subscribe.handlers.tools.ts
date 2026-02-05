import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { EmbeddedPiSubscribeContext } from "./pi-embedded-subscribe.handlers.types.js";
import { logToolCall } from "../gateway/server-methods/event-logger.js";
import { emitAgentEvent } from "../infra/agent-events.js";
import { normalizeTextForComparison } from "./pi-embedded-helpers.js";
import { isMessagingTool, isMessagingToolSendAction } from "./pi-embedded-messaging.js";
import {
  extractToolErrorMessage,
  extractToolResultText,
  extractMessagingToolSend,
  isToolResultError,
  sanitizeToolResult,
} from "./pi-embedded-subscribe.tools.js";
import { inferToolMetaFromArgs } from "./pi-embedded-utils.js";
import { normalizeToolName } from "./tool-policy.js";

function extendExecMeta(toolName: string, args: unknown, meta?: string): string | undefined {
  const normalized = toolName.trim().toLowerCase();
  if (normalized !== "exec" && normalized !== "bash") {
    return meta;
  }
  if (!args || typeof args !== "object") {
    return meta;
  }
  const record = args as Record<string, unknown>;
  const flags: string[] = [];
  if (record.pty === true) {
    flags.push("pty");
  }
  if (record.elevated === true) {
    flags.push("elevated");
  }
  if (flags.length === 0) {
    return meta;
  }
  const suffix = flags.join(" · ");
  return meta ? `${meta} · ${suffix}` : suffix;
}

export async function handleToolExecutionStart(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & { toolName: string; toolCallId: string; args: unknown },
) {
  // Flush pending block replies to preserve message boundaries before tool execution.
  ctx.flushBlockReplyBuffer();
  if (ctx.params.onBlockReplyFlush) {
    void ctx.params.onBlockReplyFlush();
  }

  const rawToolName = String(evt.toolName);
  const toolName = normalizeToolName(rawToolName);
  const toolCallId = String(evt.toolCallId);
  const args = evt.args;

  // Track tool start time and args for duration calculation and event logging
  ctx.state.toolStartTimesById.set(toolCallId, Date.now());
  ctx.state.toolArgsById.set(toolCallId, args);

  if (toolName === "read") {
    const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const filePath = typeof record.path === "string" ? record.path.trim() : "";
    if (!filePath) {
      const argsPreview = typeof args === "string" ? args.slice(0, 200) : undefined;
      ctx.log.warn(
        `read tool called without path: toolCallId=${toolCallId} argsType=${typeof args}${argsPreview ? ` argsPreview=${argsPreview}` : ""}`,
      );
    }
  }

  const meta = extendExecMeta(toolName, args, inferToolMetaFromArgs(toolName, args));
  ctx.state.toolMetaById.set(toolCallId, meta);
  ctx.log.debug(
    `embedded run tool start: runId=${ctx.params.runId} tool=${toolName} toolCallId=${toolCallId}`,
  );

  const shouldEmitToolEvents = ctx.shouldEmitToolResult();
  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "tool",
    data: {
      phase: "start",
      name: toolName,
      toolCallId,
      args: args as Record<string, unknown>,
    },
  });
  // Best-effort typing signal; do not block tool summaries on slow emitters.
  void ctx.params.onAgentEvent?.({
    stream: "tool",
    data: { phase: "start", name: toolName, toolCallId },
  });

  if (
    ctx.params.onToolResult &&
    shouldEmitToolEvents &&
    !ctx.state.toolSummaryById.has(toolCallId)
  ) {
    ctx.state.toolSummaryById.add(toolCallId);
    ctx.emitToolSummary(toolName, meta);
  }

  // Track messaging tool sends (pending until confirmed in tool_execution_end).
  if (isMessagingTool(toolName)) {
    const argsRecord = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const isMessagingSend = isMessagingToolSendAction(toolName, argsRecord);
    if (isMessagingSend) {
      const sendTarget = extractMessagingToolSend(toolName, argsRecord);
      if (sendTarget) {
        ctx.state.pendingMessagingTargets.set(toolCallId, sendTarget);
      }
      // Field names vary by tool: Discord/Slack use "content", sessions_send uses "message"
      const text = (argsRecord.content as string) ?? (argsRecord.message as string);
      if (text && typeof text === "string") {
        ctx.state.pendingMessagingTexts.set(toolCallId, text);
        ctx.log.debug(`Tracking pending messaging text: tool=${toolName} len=${text.length}`);
      }
    }
  }
}

export function handleToolExecutionUpdate(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & {
    toolName: string;
    toolCallId: string;
    partialResult?: unknown;
  },
) {
  const toolName = normalizeToolName(String(evt.toolName));
  const toolCallId = String(evt.toolCallId);
  const partial = evt.partialResult;
  const sanitized = sanitizeToolResult(partial);
  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "tool",
    data: {
      phase: "update",
      name: toolName,
      toolCallId,
      partialResult: sanitized,
    },
  });
  void ctx.params.onAgentEvent?.({
    stream: "tool",
    data: {
      phase: "update",
      name: toolName,
      toolCallId,
    },
  });
}

export function handleToolExecutionEnd(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & {
    toolName: string;
    toolCallId: string;
    isError: boolean;
    result?: unknown;
  },
) {
  const toolName = normalizeToolName(String(evt.toolName));
  const toolCallId = String(evt.toolCallId);
  const isError = Boolean(evt.isError);
  const result = evt.result;
  const isToolError = isError || isToolResultError(result);
  const sanitizedResult = sanitizeToolResult(result);
  const meta = ctx.state.toolMetaById.get(toolCallId);
  ctx.state.toolMetas.push({ toolName, meta });
  ctx.state.toolMetaById.delete(toolCallId);
  ctx.state.toolSummaryById.delete(toolCallId);

  // Calculate duration and retrieve args from state
  const startTime = ctx.state.toolStartTimesById.get(toolCallId);
  const durationMs = startTime ? Date.now() - startTime : undefined;
  const args = ctx.state.toolArgsById.get(toolCallId);

  // Clean up state
  ctx.state.toolStartTimesById.delete(toolCallId);
  ctx.state.toolArgsById.delete(toolCallId);

  // Extract metadata from tool arguments for logging
  const eventMetadata: Record<string, unknown> = {};
  if (toolName === "exec" || toolName === "bash") {
    const argsRecord = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const command = argsRecord.command as string | undefined;
    if (command && typeof command === "string") {
      // Truncate command for logging (max 200 chars)
      eventMetadata.command = command.length > 200 ? command.slice(0, 200) + "..." : command;
    }
    if (argsRecord.pty === true) eventMetadata.pty = true;
    if (argsRecord.elevated === true) eventMetadata.elevated = true;
  } else if (toolName === "read" || toolName === "write" || toolName === "edit") {
    const argsRecord = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const filePath = (argsRecord.path || argsRecord.file_path) as string | undefined;
    if (filePath && typeof filePath === "string") {
      eventMetadata.path = filePath;
    }
  } else if (toolName === "web_search") {
    const argsRecord = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const query = argsRecord.query as string | undefined;
    if (query && typeof query === "string") {
      eventMetadata.query = query.length > 100 ? query.slice(0, 100) + "..." : query;
    }
  } else if (toolName === "web_fetch") {
    const argsRecord = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const url = argsRecord.url as string | undefined;
    if (url && typeof url === "string") {
      eventMetadata.url = url;
    }
  } else if (toolName === "memory_search") {
    const argsRecord = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const query = argsRecord.query as string | undefined;
    if (query && typeof query === "string") {
      eventMetadata.query = query.length > 100 ? query.slice(0, 100) + "..." : query;
    }
  }

  // Log the tool call event
  logToolCall({
    toolName,
    agentId: ctx.params.agentId,
    instanceId: ctx.params.instanceId,
    sessionKey: ctx.params.sessionKey,
    durationMs,
    status: isToolError ? "error" : "ok",
    metadata: eventMetadata,
  });

  if (isToolError) {
    const errorMessage = extractToolErrorMessage(sanitizedResult);
    ctx.state.lastToolError = {
      toolName,
      meta,
      error: errorMessage,
    };
  }

  // Commit messaging tool text on success, discard on error.
  const pendingText = ctx.state.pendingMessagingTexts.get(toolCallId);
  const pendingTarget = ctx.state.pendingMessagingTargets.get(toolCallId);
  if (pendingText) {
    ctx.state.pendingMessagingTexts.delete(toolCallId);
    if (!isToolError) {
      ctx.state.messagingToolSentTexts.push(pendingText);
      ctx.state.messagingToolSentTextsNormalized.push(normalizeTextForComparison(pendingText));
      ctx.log.debug(`Committed messaging text: tool=${toolName} len=${pendingText.length}`);
      ctx.trimMessagingToolSent();
    }
  }
  if (pendingTarget) {
    ctx.state.pendingMessagingTargets.delete(toolCallId);
    if (!isToolError) {
      ctx.state.messagingToolSentTargets.push(pendingTarget);
      ctx.trimMessagingToolSent();
    }
  }

  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "tool",
    data: {
      phase: "result",
      name: toolName,
      toolCallId,
      meta,
      isError: isToolError,
      result: sanitizedResult,
    },
  });
  void ctx.params.onAgentEvent?.({
    stream: "tool",
    data: {
      phase: "result",
      name: toolName,
      toolCallId,
      meta,
      isError: isToolError,
    },
  });

  ctx.log.debug(
    `embedded run tool end: runId=${ctx.params.runId} tool=${toolName} toolCallId=${toolCallId}`,
  );

  if (ctx.params.onToolResult && ctx.shouldEmitToolOutput()) {
    const outputText = extractToolResultText(sanitizedResult);
    if (outputText) {
      ctx.emitToolOutput(toolName, meta, outputText);
    }
  }
}
