import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

type SqliteDatabase = import("node:sqlite").DatabaseSync;

function workspacePath(): string {
  return (
    process.env.OPENCLAW_WORKSPACE ??
    join(process.env.HOME ?? "/home/teej", ".openclaw", "workspace")
  );
}

function getCostDb(): SqliteDatabase | null {
  try {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dbPath = join(workspacePath(), "usage_costs.sqlite");
    if (!existsSync(dbPath)) return null;
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

type ActivityEntry = {
  ts: string;
  category: string;
  cardId?: string;
  cardName?: string;
  message?: string;
};

/** Build time windows for a card from activity.jsonl (activate → done/next activate). */
function getCardTimeWindows(cardId: string): Array<{ start: string; end: string | null }> {
  const logPath = join(workspacePath(), "activity.jsonl");
  if (!existsSync(logPath)) return [];

  const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
  const entries: ActivityEntry[] = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const windows: Array<{ start: string; end: string | null }> = [];
  let currentStart: string | null = null;

  for (const entry of entries) {
    if (entry.category === "activate" && entry.cardId === cardId) {
      currentStart = entry.ts;
    } else if (currentStart && entry.category === "activate" && entry.cardId !== cardId) {
      // Different card activated — close window
      windows.push({ start: currentStart, end: entry.ts });
      currentStart = null;
    } else if (currentStart && entry.category === "done" && entry.cardId === cardId) {
      windows.push({ start: currentStart, end: entry.ts });
      currentStart = null;
    }
  }

  // If card is still active, window is open
  if (currentStart) {
    windows.push({ start: currentStart, end: null });
  }

  return windows;
}

function readTaskQueueConfig(): {
  boardId: string;
  apiKey: string;
  apiToken: string;
  approvedLabelId: string;
  newLabelId: string;
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
      approvedLabelId: config.labels?.approved ?? config.approvedLabelId ?? "",
      newLabelId: config.labels?.new ?? "",
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

async function deleteTrello(path: string, apiKey: string, apiToken: string): Promise<void> {
  const url = trelloUrl(path, apiKey, apiToken);
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Trello API error: ${res.status}`);
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
          `/boards/${config.boardId}/cards?fields=name,desc,idList,url,labels,idChecklists,dateLastActivity,badges`,
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
            badges: { checkItems: number; checkItemsChecked: number; comments: number };
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
          checkItems: c.badges?.checkItems ?? 0,
          checkItemsChecked: c.badges?.checkItemsChecked ?? 0,
          commentCount: c.badges?.comments ?? 0,
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
      // Add approved label (ignore if already present)
      if (config.approvedLabelId) {
        await postTrello(`/cards/${cardId}/idLabels`, config.apiKey, config.apiToken, {
          value: config.approvedLabelId,
        }).catch(() => {});
      }
      // Remove "New" label
      if (config.newLabelId) {
        await deleteTrello(
          `/cards/${cardId}/idLabels/${config.newLabelId}`,
          config.apiKey,
          config.apiToken,
        ).catch(() => {});
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

  "taskQueue.markSeen": async ({ params, respond }) => {
    const config = requireConfig(respond);
    if (!config) return;
    const { cardId } = params as { cardId?: string };
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
      return;
    }

    try {
      if (config.newLabelId) {
        await deleteTrello(
          `/cards/${cardId}/idLabels/${config.newLabelId}`,
          config.apiKey,
          config.apiToken,
        ).catch(() => {});
      }
      respond(true, { ok: true });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to mark seen: ${String(err)}`),
      );
    }
  },

  "taskQueue.cardMetrics": ({ params, respond }) => {
    const { cardId } = params as { cardId?: string };
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
      return;
    }

    const windows = getCardTimeWindows(cardId);
    if (windows.length === 0) {
      respond(true, {
        cardId,
        windows: [],
        totalCost: 0,
        totalEvents: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheTokens: 0,
        totalDurationMin: 0,
        byModel: [],
        fetchedAt: Date.now(),
      });
      return;
    }

    const db = getCostDb();
    if (!db) {
      respond(true, {
        cardId,
        windows,
        totalCost: 0,
        totalEvents: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheTokens: 0,
        totalDurationMin: 0,
        byModel: [],
        noDb: true,
        fetchedAt: Date.now(),
      });
      return;
    }

    try {
      // Build a UNION of time window conditions
      const conditions = windows.map((w) => {
        const start = w.start.replace(/'/g, "''");
        if (w.end) {
          const end = w.end.replace(/'/g, "''");
          return `(ts >= '${start}' AND ts <= '${end}')`;
        }
        return `(ts >= '${start}')`;
      });
      const whereClause = conditions.join(" OR ");

      const summary = db.prepare(
        `SELECT COUNT(*) as events, ROUND(COALESCE(SUM(cost_total), 0), 4) as cost,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(cache_read), 0) as cache_tokens,
          MIN(ts) as first_event, MAX(ts) as last_event
         FROM usage_events WHERE ${whereClause}`,
      ).all();

      const byModel = db.prepare(
        `SELECT model, COUNT(*) as events, ROUND(SUM(cost_total), 4) as cost,
          SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
         FROM usage_events WHERE (${whereClause})
         AND model NOT IN ('unknown', 'delivery-mirror')
         GROUP BY model ORDER BY cost DESC`,
      ).all();

      db.close();

      const s = (summary[0] ?? {}) as Record<string, unknown>;

      // Calculate total active time from windows
      let totalDurationMs = 0;
      for (const w of windows) {
        const start = new Date(w.start).getTime();
        const end = w.end ? new Date(w.end).getTime() : Date.now();
        totalDurationMs += end - start;
      }

      respond(true, {
        cardId,
        windows: windows.map((w) => ({
          start: w.start,
          end: w.end,
          durationMin: Math.round(
            ((w.end ? new Date(w.end).getTime() : Date.now()) - new Date(w.start).getTime()) /
              60000,
          ),
        })),
        totalCost: Number(s.cost ?? 0),
        totalEvents: Number(s.events ?? 0),
        totalInputTokens: Number(s.input_tokens ?? 0),
        totalOutputTokens: Number(s.output_tokens ?? 0),
        totalCacheTokens: Number(s.cache_tokens ?? 0),
        totalDurationMin: Math.round(totalDurationMs / 60000),
        firstEvent: s.first_event ?? null,
        lastEvent: s.last_event ?? null,
        byModel,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      try { db.close(); } catch {}
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INTERNAL_ERROR, `Card metrics query failed: ${String(err)}`),
      );
    }
  },
};
