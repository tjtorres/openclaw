/**
 * Task Queue RPC handlers.
 *
 * Read operations use tasks.sqlite (fast, offline-capable).
 * Write operations go to Trello API (source of truth) + update DB via sync.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  getTasksDb,
  getTasksDbWritable,
  refreshTasksDb,
  getLists,
  getCardsByBoard,
  getCard,
  getChecklists,
  getChecklistProgress,
  getComments,
  getActivityByCard,
  workspacePath,
} from "./tasks-db.js";

type SqliteDatabase = import("node:sqlite").DatabaseSync;

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

function readTaskQueueConfig(): {
  boardId: string;
  apiKey: string;
  apiToken: string;
  approvedLabelId: string;
  newLabelId: string;
} | null {
  try {
    const configPath = join(workspacePath(), "trello_task_queue.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const apiKey = process.env.TRELLO_API_KEY;
    const apiToken = process.env.TRELLO_TOKEN;
    if (!apiKey || !apiToken) return null;
    return {
      boardId: config.boardId,
      apiKey,
      apiToken,
      approvedLabelId: config.labels?.approved ?? "",
      newLabelId: config.labels?.new ?? "",
    };
  } catch {
    return null;
  }
}

// ── Trello API helpers (for writes only) ─────────────────────

function trelloUrl(path: string, apiKey: string, apiToken: string): string {
  return `https://api.trello.com/1${path}${path.includes("?") ? "&" : "?"}key=${apiKey}&token=${apiToken}`;
}

async function putTrello(path: string, key: string, token: string, body?: Record<string, string>) {
  const res = await fetch(trelloUrl(path, key, token), {
    method: "PUT",
    headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (!res.ok) throw new Error(`Trello API error: ${res.status}`);
  return res.json();
}

async function postTrello(path: string, key: string, token: string, body?: Record<string, string>) {
  const res = await fetch(trelloUrl(path, key, token), {
    method: "POST",
    headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (!res.ok) throw new Error(`Trello API error: ${res.status}`);
  return res.json();
}

async function deleteTrello(path: string, key: string, token: string) {
  const res = await fetch(trelloUrl(path, key, token), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Trello API error: ${res.status}`);
}

function requireConfig(respond: (...args: unknown[]) => void) {
  const config = readTaskQueueConfig();
  if (!config) {
    respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "Task queue not configured"));
    return null;
  }
  return config;
}

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

export const taskQueueHandlers: GatewayRequestHandlers = {
  /**
   * List all cards on the board — reads from DB.
   * Falls back to Trello API if DB unavailable.
   */
  "taskQueue.list": safe(async ({ respond }) => {
    const config = requireConfig(respond);
    if (!config) return;

    const db = getTasksDb();
    if (db) {
      try {
        const lists = getLists(db, config.boardId);
        const cards = getCardsByBoard(db, config.boardId);

        const listMap = new Map(lists.map((l) => [l.id, l.name]));

        // Batch get checklist progress for all cards
        const cardData = cards.map((c) => {
          const progress = getChecklistProgress(db, c.id);
          let labels: Array<{ id: string; name: string; color?: string }> = [];
          try { labels = JSON.parse(c.labels || "[]"); } catch {}
          const commentCount = db.prepare("SELECT COUNT(*) as cnt FROM comments WHERE card_id=?").all(c.id);

          return {
            id: c.id,
            name: c.name,
            desc: c.description ?? "",
            url: c.url || `https://trello.com/c/${c.id}`,
            listId: c.list_id,
            listName: listMap.get(c.list_id) ?? null,
            labels: labels.map((l) => l.name),
            labelIds: labels.map((l) => l.id),
            hasChecklists: progress.total > 0,
            checkItems: progress.total,
            checkItemsChecked: progress.done,
            commentCount: Number((commentCount[0] as { cnt: number })?.cnt ?? 0),
            dateLastActivity: c.updated_at,
          };
        });

        // Check staleness — newest synced_at across cards
        const syncedTimes = cards.map((c) => c.synced_at).filter(Boolean).sort();
        const lastSynced = syncedTimes.length > 0 ? syncedTimes[syncedTimes.length - 1] : null;
        const staleMs = lastSynced ? Date.now() - new Date(lastSynced!).getTime() : Infinity;
        const isStale = staleMs > 5 * 60 * 1000; // >5 minutes

        respond(true, {
          board: {
            id: config.boardId,
            name: "Jeeves Task Queue",
            url: `https://trello.com/b/${config.boardId}`,
          },
          lists: lists.map((l) => ({ id: l.id, name: l.name, closed: false })),
          cards: cardData,
          source: "db",
          lastSynced,
          isStale,
          fetchedAt: Date.now(),
        });
        return;
      } catch (err) {
        // Fall through to Trello API
        console.error("DB read failed, falling back to Trello:", err);
      }
    }

    // Fallback: Trello API (same as before)
    try {
      const [lists, cards] = await Promise.all([
        fetch(trelloUrl(`/boards/${config.boardId}/lists?fields=name,closed`, config.apiKey, config.apiToken)).then((r) => r.json()),
        fetch(trelloUrl(`/boards/${config.boardId}/cards?fields=name,desc,idList,url,labels,idChecklists,dateLastActivity,badges`, config.apiKey, config.apiToken)).then((r) => r.json()),
      ]) as [
        Array<{ id: string; name: string; closed: boolean }>,
        Array<{
          id: string; name: string; desc: string; idList: string; url: string;
          labels: Array<{ id: string; name: string }>; idChecklists: string[];
          dateLastActivity: string; badges: { checkItems: number; checkItemsChecked: number; comments: number };
        }>,
      ];

      const listMap = new Map(lists.map((l) => [l.id, l.name]));
      respond(true, {
        board: { id: config.boardId, name: "Jeeves Task Queue", url: `https://trello.com/b/${config.boardId}` },
        lists: lists.map((l) => ({ id: l.id, name: l.name, closed: l.closed })),
        cards: cards.map((c) => ({
          id: c.id, name: c.name, desc: c.desc ?? "", url: c.url,
          listId: c.idList, listName: listMap.get(c.idList) ?? null,
          labels: c.labels.map((l) => l.name), labelIds: c.labels.map((l) => l.id),
          hasChecklists: (c.idChecklists?.length ?? 0) > 0,
          checkItems: c.badges?.checkItems ?? 0, checkItemsChecked: c.badges?.checkItemsChecked ?? 0,
          commentCount: c.badges?.comments ?? 0, dateLastActivity: c.dateLastActivity,
        })),
        source: "trello",
        fetchedAt: Date.now(),
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to fetch: ${String(err)}`));
    }
  }),

  /**
   * Card detail — reads from DB, falls back to Trello.
   */
  "taskQueue.cardDetail": safe(async ({ params, respond }) => {
    const config = requireConfig(respond);
    if (!config) return;
    const cardId = (params as { cardId?: string }).cardId;
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
      return;
    }

    const db = getTasksDb();
    if (db) {
      try {
        const card = getCard(db, cardId);
        if (card) {
          const checklists = getChecklists(db, cardId);
          const comments = getComments(db, cardId, 20);

          let labels: Array<{ id: string; name: string; color?: string }> = [];
          try { labels = JSON.parse(card.labels || "[]"); } catch {}

          respond(true, {
            card: {
              id: card.id,
              name: card.name,
              desc: card.description,
              idList: card.list_id,
              url: card.url || `https://trello.com/c/${card.id}`,
              labels,
              dateLastActivity: card.updated_at,
            },
            comments: comments.map((c) => ({
              id: c.id,
              date: c.created_at,
              text: c.text,
              author: c.author,
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
            source: "db",
          });
          return;
        }
      } catch (err) {
        console.error("DB cardDetail failed, falling back to Trello:", err);
      }
    }

    // Fallback: Trello API
    try {
      const [card, actions, checklists] = await Promise.all([
        fetch(trelloUrl(`/cards/${cardId}?fields=name,desc,idList,url,labels,dateLastActivity`, config.apiKey, config.apiToken)).then((r) => r.json()),
        fetch(trelloUrl(`/cards/${cardId}/actions?filter=commentCard&limit=20`, config.apiKey, config.apiToken)).then((r) => r.json()),
        fetch(trelloUrl(`/cards/${cardId}/checklists`, config.apiKey, config.apiToken)).then((r) => r.json()),
      ]);

      respond(true, {
        card,
        comments: (actions as Array<{ id: string; date: string; data: { text: string }; memberCreator: { fullName: string } }>).map((a) => ({
          id: a.id, date: a.date, text: a.data.text, author: a.memberCreator.fullName,
        })),
        checklists: (checklists as Array<{ id: string; name: string; checkItems: Array<{ id: string; name: string; state: string }> }>).map((cl) => ({
          id: cl.id, name: cl.name,
          items: cl.checkItems.map((ci) => ({ id: ci.id, name: ci.name, complete: ci.state === "complete" })),
        })),
        source: "trello",
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to fetch card: ${String(err)}`));
    }
  }),

  // ── Write operations: Trello API + DB update ───────────────

  "taskQueue.moveCard": safe(async ({ params, respond }) => {
    const config = requireConfig(respond);
    if (!config) return;
    const { cardId, listId } = params as { cardId?: string; listId?: string };
    if (!cardId || !listId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId and listId required"));
      return;
    }

    try {
      await putTrello(`/cards/${cardId}`, config.apiKey, config.apiToken, { idList: listId });
      // Update DB
      const wdb = getTasksDbWritable();
      if (wdb) {
        wdb.prepare("UPDATE cards SET list_id=? WHERE id=?").run(listId, cardId);
        wdb.close();
        refreshTasksDb();
      }
      respond(true, { ok: true });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to move card: ${String(err)}`));
    }
  }),

  "taskQueue.approveCard": safe(async ({ params, respond }) => {
    const config = requireConfig(respond);
    if (!config) return;
    const { cardId } = params as { cardId?: string };
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
      return;
    }

    try {
      if (config.approvedLabelId) {
        await postTrello(`/cards/${cardId}/idLabels`, config.apiKey, config.apiToken, {
          value: config.approvedLabelId,
        }).catch(() => {});
      }
      if (config.newLabelId) {
        await deleteTrello(`/cards/${cardId}/idLabels/${config.newLabelId}`, config.apiKey, config.apiToken).catch(() => {});
      }
      // Move to Approved list
      const db = getTasksDb();
      const approvedList = db
        ? (db.prepare("SELECT id FROM lists WHERE board_id=? AND name='Approved'").all(config.boardId) as Array<{ id: string }>)[0]
        : null;
      const approvedListId = approvedList?.id;
      if (approvedListId) {
        await putTrello(`/cards/${cardId}`, config.apiKey, config.apiToken, { idList: approvedListId });
        const wdb = getTasksDbWritable();
        if (wdb) {
          wdb.prepare("UPDATE cards SET list_id=? WHERE id=?").run(approvedListId, cardId);
          wdb.close();
          refreshTasksDb();
        }
      }
      respond(true, { ok: true });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to approve card: ${String(err)}`));
    }
  }),

  "taskQueue.addComment": safe(async ({ params, respond }) => {
    const config = requireConfig(respond);
    if (!config) return;
    const { cardId, text } = params as { cardId?: string; text?: string };
    if (!cardId || !text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId and text required"));
      return;
    }

    try {
      const result = await postTrello(`/cards/${cardId}/actions/comments`, config.apiKey, config.apiToken, { text });
      // Also write to DB
      const wdb = getTasksDbWritable();
      if (wdb && result && typeof result === "object" && "id" in result) {
        wdb.prepare("INSERT OR IGNORE INTO comments (id, card_id, text, author, created_at, synced_at) VALUES (?,?,?,?,datetime('now'),datetime('now'))").run(
          (result as { id: string }).id, cardId, text, "Jeeves", 
        );
        wdb.close();
        refreshTasksDb();
      }
      respond(true, { ok: true });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to add comment: ${String(err)}`));
    }
  }),

  "taskQueue.toggleCheckItem": safe(async ({ params, respond }) => {
    const config = requireConfig(respond);
    if (!config) return;
    const { cardId, checkItemId, complete } = params as { cardId?: string; checkItemId?: string; complete?: boolean };
    if (!cardId || !checkItemId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId and checkItemId required"));
      return;
    }

    try {
      const state = complete ? "complete" : "incomplete";
      await putTrello(`/cards/${cardId}/checkItem/${checkItemId}`, config.apiKey, config.apiToken, { state });
      // Update DB
      const wdb = getTasksDbWritable();
      if (wdb) {
        wdb.prepare("UPDATE checklist_items SET state=? WHERE id=? AND card_id=?").run(state, checkItemId, cardId);
        wdb.close();
        refreshTasksDb();
      }
      respond(true, { ok: true });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to toggle check item: ${String(err)}`));
    }
  }),

  "taskQueue.markSeen": safe(async ({ params, respond }) => {
    const config = requireConfig(respond);
    if (!config) return;
    const { cardId } = params as { cardId?: string };
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
      return;
    }

    try {
      if (config.newLabelId) {
        await deleteTrello(`/cards/${cardId}/idLabels/${config.newLabelId}`, config.apiKey, config.apiToken).catch(() => {});
        // Update labels in DB
        const wdb = getTasksDbWritable();
        if (wdb) {
          const row = wdb.prepare("SELECT labels FROM cards WHERE id=?").all(cardId);
          if (row.length > 0) {
            try {
              const labels = JSON.parse((row[0] as { labels: string }).labels || "[]");
              const filtered = labels.filter((l: { id: string }) => l.id !== config.newLabelId);
              wdb.prepare("UPDATE cards SET labels=? WHERE id=?").run(JSON.stringify(filtered), cardId);
            } catch {}
          }
          wdb.close();
          refreshTasksDb();
        }
      }
      respond(true, { ok: true });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `Failed to mark seen: ${String(err)}`));
    }
  }),

  /**
   * Card metrics — reads from tasks.sqlite activity table + usage_costs.sqlite.
   */
  "taskQueue.cardMetrics": safe(({ params, respond }) => {
    const { cardId } = params as { cardId?: string };
    if (!cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cardId required"));
      return;
    }

    // Get time windows from activity DB instead of .jsonl
    const tasksDb = getTasksDb();
    const windows: Array<{ start: string; end: string | null }> = [];

    if (tasksDb) {
      const entries = tasksDb.prepare(
        "SELECT ts, category, card_id FROM activity WHERE category IN ('task', 'done') ORDER BY ts ASC"
      ).all() as Array<{ ts: string; category: string; card_id: string | null }>;

      let currentStart: string | null = null;
      for (const entry of entries) {
        if (entry.category === "task" && entry.card_id === cardId) {
          currentStart = entry.ts;
        } else if (currentStart && entry.category === "task" && entry.card_id !== cardId) {
          windows.push({ start: currentStart, end: entry.ts });
          currentStart = null;
        } else if (currentStart && entry.category === "done" && entry.card_id === cardId) {
          windows.push({ start: currentStart, end: entry.ts });
          currentStart = null;
        }
      }
      if (currentStart) windows.push({ start: currentStart, end: null });
    }

    if (windows.length === 0) {
      respond(true, {
        cardId, windows: [], totalCost: 0, totalEvents: 0,
        totalInputTokens: 0, totalOutputTokens: 0, totalCacheTokens: 0,
        totalDurationMin: 0, byModel: [], fetchedAt: Date.now(),
      });
      return;
    }

    const costDb = getCostDb();
    if (!costDb) {
      respond(true, {
        cardId, windows, totalCost: 0, totalEvents: 0,
        totalInputTokens: 0, totalOutputTokens: 0, totalCacheTokens: 0,
        totalDurationMin: 0, byModel: [], noDb: true, fetchedAt: Date.now(),
      });
      return;
    }

    try {
      const conditions = windows.map((w) => {
        const start = w.start.replace(/'/g, "''");
        if (w.end) {
          const end = w.end.replace(/'/g, "''");
          return `(ts >= '${start}' AND ts <= '${end}')`;
        }
        return `(ts >= '${start}')`;
      });
      const where = conditions.join(" OR ");

      const summary = costDb.prepare(
        `SELECT COUNT(*) as events, ROUND(COALESCE(SUM(cost_total), 0), 4) as cost,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(cache_read), 0) as cache_tokens,
          MIN(ts) as first_event, MAX(ts) as last_event
         FROM usage_events WHERE ${where}`
      ).all();

      const byModel = costDb.prepare(
        `SELECT model, COUNT(*) as events, ROUND(SUM(cost_total), 4) as cost,
          SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
         FROM usage_events WHERE (${where})
         AND model NOT IN ('unknown', 'delivery-mirror')
         GROUP BY model ORDER BY cost DESC`
      ).all();

      costDb.close();

      const s = (summary[0] ?? {}) as Record<string, unknown>;
      let totalDurationMs = 0;
      for (const w of windows) {
        const start = new Date(w.start).getTime();
        const end = w.end ? new Date(w.end).getTime() : Date.now();
        totalDurationMs += end - start;
      }

      respond(true, {
        cardId,
        windows: windows.map((w) => ({
          start: w.start, end: w.end,
          durationMin: Math.round(((w.end ? new Date(w.end).getTime() : Date.now()) - new Date(w.start).getTime()) / 60000),
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
      try { costDb.close(); } catch {}
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `Card metrics query failed: ${String(err)}`));
    }
  }),
};
