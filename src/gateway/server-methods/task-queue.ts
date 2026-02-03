import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function readTaskQueueConfig(): {
  boardId: string;
  apiKey: string;
  apiToken: string;
  approvedLabelId: string;
} | null {
  try {
    const workspace =
      process.env.OPENCLAW_WORKSPACE ??
      join(process.env.HOME ?? "/home/teej", ".openclaw", "workspace");
    const configPath = join(workspace, "trello_task_queue.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const apiKey = process.env.TRELLO_API_KEY;
    const apiToken = process.env.TRELLO_TOKEN;
    if (!apiKey || !apiToken) return null;
    return {
      boardId: config.boardId,
      apiKey,
      apiToken,
      approvedLabelId: config.approvedLabelId ?? "",
    };
  } catch {
    return null;
  }
}

function trelloUrl(path: string, apiKey: string, apiToken: string): string {
  return `https://api.trello.com/1${path}${path.includes("?") ? "&" : "?"}key=${apiKey}&token=${apiToken}`;
}

async function fetchTrello(path: string, apiKey: string, apiToken: string): Promise<unknown> {
  const res = await fetch(trelloUrl(path, apiKey, apiToken));
  if (!res.ok) throw new Error(`Trello API error: ${res.status}`);
  return res.json();
}

async function postTrello(
  path: string,
  apiKey: string,
  apiToken: string,
  body?: Record<string, string>,
): Promise<unknown> {
  const url = trelloUrl(path, apiKey, apiToken);
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (!res.ok) throw new Error(`Trello API error: ${res.status}`);
  return res.json();
}

async function putTrello(
  path: string,
  apiKey: string,
  apiToken: string,
  body?: Record<string, string>,
): Promise<unknown> {
  const url = trelloUrl(path, apiKey, apiToken);
  const res = await fetch(url, {
    method: "PUT",
    headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (!res.ok) throw new Error(`Trello API error: ${res.status}`);
  return res.json();
}

function requireConfig(respond: (...args: unknown[]) => void) {
  const config = readTaskQueueConfig();
  if (!config) {
    respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "Task queue not configured"));
    return null;
  }
  return config;
}

export const taskQueueHandlers: GatewayRequestHandlers = {
  "taskQueue.list": async ({ respond }) => {
    const config = requireConfig(respond);
    if (!config) return;

    try {
      const [lists, cards] = await Promise.all([
        fetchTrello(
          `/boards/${config.boardId}/lists?fields=name,closed`,
          config.apiKey,
          config.apiToken,
        ) as Promise<Array<{ id: string; name: string; closed: boolean }>>,
        fetchTrello(
          `/boards/${config.boardId}/cards?fields=name,desc,idList,url,labels,idChecklists,dateLastActivity`,
          config.apiKey,
          config.apiToken,
        ) as Promise<
          Array<{
            id: string;
            name: string;
            desc: string;
            idList: string;
            url: string;
            labels: Array<{ id: string; name: string }>;
            idChecklists: string[];
            dateLastActivity: string;
          }>
        >,
      ]);

      const listMap = new Map(lists.map((l) => [l.id, l.name]));

      const snapshot = {
        board: {
          id: config.boardId,
          name: "Jeeves Task Queue",
          url: `https://trello.com/b/${config.boardId}`,
        },
        lists: lists.map((l) => ({ id: l.id, name: l.name, closed: l.closed })),
        cards: cards.map((c) => ({
          id: c.id,
          name: c.name,
          desc: c.desc ?? "",
          url: c.url,
          listId: c.idList,
          listName: listMap.get(c.idList) ?? null,
          labels: c.labels.map((l) => l.name),
          labelIds: c.labels.map((l) => l.id),
          hasChecklists: (c.idChecklists?.length ?? 0) > 0,
          dateLastActivity: c.dateLastActivity,
        })),
        fetchedAt: Date.now(),
      };

      respond(true, snapshot);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to fetch task queue: ${String(err)}`),
      );
    }
  },

  "taskQueue.cardDetail": async ({ params, respond }) => {
    const config = requireConfig(respond);
    if (!config) return;
    const cardId = (params as { cardId?: string }).cardId;
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
      return;
    }

    try {
      const [card, actions, checklists] = await Promise.all([
        fetchTrello(
          `/cards/${cardId}?fields=name,desc,idList,url,labels,dateLastActivity`,
          config.apiKey,
          config.apiToken,
        ) as Promise<Record<string, unknown>>,
        fetchTrello(
          `/cards/${cardId}/actions?filter=commentCard&limit=20`,
          config.apiKey,
          config.apiToken,
        ) as Promise<
          Array<{
            id: string;
            date: string;
            data: { text: string };
            memberCreator: { fullName: string };
          }>
        >,
        fetchTrello(`/cards/${cardId}/checklists`, config.apiKey, config.apiToken) as Promise<
          Array<{
            id: string;
            name: string;
            checkItems: Array<{
              id: string;
              name: string;
              state: string;
            }>;
          }>
        >,
      ]);

      respond(true, {
        card,
        comments: actions.map((a) => ({
          id: a.id,
          date: a.date,
          text: a.data.text,
          author: a.memberCreator.fullName,
        })),
        checklists: checklists.map((cl) => ({
          id: cl.id,
          name: cl.name,
          items: cl.checkItems.map((ci) => ({
            id: ci.id,
            name: ci.name,
            complete: ci.state === "complete",
          })),
        })),
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to fetch card: ${String(err)}`),
      );
    }
  },

  "taskQueue.moveCard": async ({ params, respond }) => {
    const config = requireConfig(respond);
    if (!config) return;
    const { cardId, listId } = params as { cardId?: string; listId?: string };
    if (!cardId || !listId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "cardId and listId required"),
      );
      return;
    }

    try {
      await putTrello(`/cards/${cardId}`, config.apiKey, config.apiToken, { idList: listId });
      respond(true, { ok: true });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to move card: ${String(err)}`),
      );
    }
  },

  "taskQueue.approveCard": async ({ params, respond }) => {
    const config = requireConfig(respond);
    if (!config) return;
    const { cardId } = params as { cardId?: string };
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
      return;
    }

    try {
      // Add approved label
      if (config.approvedLabelId) {
        await postTrello(`/cards/${cardId}/idLabels`, config.apiKey, config.apiToken, {
          value: config.approvedLabelId,
        });
      }
      // Find the Approved list
      const lists = (await fetchTrello(
        `/boards/${config.boardId}/lists?fields=name`,
        config.apiKey,
        config.apiToken,
      )) as Array<{ id: string; name: string }>;
      const approvedList = lists.find((l) => l.name === "Approved");
      if (approvedList) {
        await putTrello(`/cards/${cardId}`, config.apiKey, config.apiToken, {
          idList: approvedList.id,
        });
      }
      respond(true, { ok: true });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to approve card: ${String(err)}`),
      );
    }
  },

  "taskQueue.addComment": async ({ params, respond }) => {
    const config = requireConfig(respond);
    if (!config) return;
    const { cardId, text } = params as { cardId?: string; text?: string };
    if (!cardId || !text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId and text required"));
      return;
    }

    try {
      await postTrello(`/cards/${cardId}/actions/comments`, config.apiKey, config.apiToken, {
        text,
      });
      respond(true, { ok: true });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to add comment: ${String(err)}`),
      );
    }
  },

  "taskQueue.toggleCheckItem": async ({ params, respond }) => {
    const config = requireConfig(respond);
    if (!config) return;
    const { cardId, checkItemId, complete } = params as {
      cardId?: string;
      checkItemId?: string;
      complete?: boolean;
    };
    if (!cardId || !checkItemId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "cardId and checkItemId required"),
      );
      return;
    }

    try {
      await putTrello(`/cards/${cardId}/checkItem/${checkItemId}`, config.apiKey, config.apiToken, {
        state: complete ? "complete" : "incomplete",
      });
      respond(true, { ok: true });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to toggle check item: ${String(err)}`),
      );
    }
  },
};
