/**
 * Task Queue RPC handlers — provider-backed.
 *
 * All operations delegate to the active TaskProvider (Trello, local, GitHub, etc).
 * The provider is auto-detected from config at startup.
 */
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { getProvider } from "./task-provider.js";

/** Wrap an RPC handler with catch-all error boundary. */
function safe(
  handler: (ctx: { params: unknown; respond: (...args: unknown[]) => void }) => unknown,
): (ctx: { params: unknown; respond: (...args: unknown[]) => void }) => unknown {
  return (ctx) => {
    try {
      const result = handler(ctx);
      if (result instanceof Promise) {
        return result.catch((err: unknown) => {
          ctx.respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `Unexpected error: ${String(err)}`));
        });
      }
      return result;
    } catch (err) {
      ctx.respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `Unexpected error: ${String(err)}`));
    }
  };
}

function requireProvider(respond: (...args: unknown[]) => void) {
  const provider = getProvider();
  if (!provider.isConfigured()) {
    respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `Task provider "${provider.name}" not configured`));
    return null;
  }
  return provider;
}

export const taskQueueHandlers: GatewayRequestHandlers = {

  "taskQueue.list": safe(async ({ respond }) => {
    const provider = requireProvider(respond);
    if (!provider) return;
    const result = await provider.list();
    respond(true, result);
  }),

  "taskQueue.cardDetail": safe(async ({ params, respond }) => {
    const provider = requireProvider(respond);
    if (!provider) return;
    const cardId = (params as { cardId?: string }).cardId;
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
      return;
    }
    const result = await provider.cardDetail(cardId);
    if (!result) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "Card not found"));
      return;
    }
    respond(true, result);
  }),

  "taskQueue.moveCard": safe(async ({ params, respond }) => {
    const provider = requireProvider(respond);
    if (!provider) return;
    const { cardId, listId } = params as { cardId?: string; listId?: string };
    if (!cardId || !listId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId and listId required"));
      return;
    }
    const result = await provider.moveCard(cardId, listId);
    respond(true, result);
  }),

  "taskQueue.approveCard": safe(async ({ params, respond }) => {
    const provider = requireProvider(respond);
    if (!provider) return;
    const { cardId } = params as { cardId?: string };
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
      return;
    }
    const result = await provider.approveCard(cardId);
    respond(true, result);
  }),

  "taskQueue.addComment": safe(async ({ params, respond }) => {
    const provider = requireProvider(respond);
    if (!provider) return;
    const { cardId, text } = params as { cardId?: string; text?: string };
    if (!cardId || !text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId and text required"));
      return;
    }
    const result = await provider.addComment(cardId, text);
    respond(true, result);
  }),

  "taskQueue.toggleCheckItem": safe(async ({ params, respond }) => {
    const provider = requireProvider(respond);
    if (!provider) return;
    const { cardId, checkItemId, complete } = params as { cardId?: string; checkItemId?: string; complete?: boolean };
    if (!cardId || !checkItemId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId and checkItemId required"));
      return;
    }
    const result = await provider.toggleCheckItem(cardId, checkItemId, complete ?? false);
    respond(true, result);
  }),

  "taskQueue.markSeen": safe(async ({ params, respond }) => {
    const provider = requireProvider(respond);
    if (!provider) return;
    const { cardId } = params as { cardId?: string };
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
      return;
    }
    const result = await provider.markSeen(cardId);
    respond(true, result);
  }),

  "taskQueue.cardMetrics": safe(({ params, respond }) => {
    const provider = requireProvider(respond);
    if (!provider) return;
    const { cardId } = params as { cardId?: string };
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
      return;
    }
    const result = provider.cardMetrics(cardId);
    respond(true, result);
  }),
};
