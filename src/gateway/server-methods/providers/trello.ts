/**
 * Trello TaskProvider — extracted from task-queue.ts.
 *
 * Encapsulates all Trello API helpers and implements the TaskProvider
 * interface so task-queue RPC handlers can delegate to a provider instead
 * of containing inline Trello logic.
 *
 * Read operations use tasks.sqlite (fast, offline-capable).
 * Write operations go to Trello API (source of truth) then update DB.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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
  workspacePath,
} from "../tasks-db.js";

type SqliteDatabase = import("node:sqlite").DatabaseSync;

// ── Config ───────────────────────────────────────────────────

export type TrelloConfig = {
  boardId: string;
  apiKey: string;
  apiToken: string;
  approvedLabelId: string;
  newLabelId: string;
};

/** Read Trello config from workspace JSON + env vars. Kept for backward compatibility. */
export function readTaskQueueConfig(): TrelloConfig | null {
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

// ── Trello API helpers ───────────────────────────────────────

export function trelloUrl(path: string, apiKey: string, apiToken: string): string {
  return `https://api.trello.com/1${path}${path.includes("?") ? "&" : "?"}key=${apiKey}&token=${apiToken}`;
}

export async function putTrello(
  path: string,
  key: string,
  token: string,
  body?: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(trelloUrl(path, key, token), {
    method: "PUT",
    headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (!res.ok) throw new Error(`Trello API error: ${res.status}`);
  return res.json();
}

export async function postTrello(
  path: string,
  key: string,
  token: string,
  body?: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(trelloUrl(path, key, token), {
    method: "POST",
    headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (!res.ok) throw new Error(`Trello API error: ${res.status}`);
  return res.json();
}

export async function deleteTrello(path: string, key: string, token: string): Promise<void> {
  const res = await fetch(trelloUrl(path, key, token), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Trello API error: ${res.status}`);
}

// ── TaskProvider interface ───────────────────────────────────

type CardSummary = {
  id: string;
  name: string;
  desc: string;
  url: string;
  listId: string;
  listName: string | null;
  labels: string[];
  labelIds: string[];
  hasChecklists: boolean;
  checkItems: number;
  checkItemsChecked: number;
  commentCount: number;
  dateLastActivity: string | null;
};

type ListInfo = { id: string; name: string; closed: boolean };

type ListResult = {
  board: { id: string; name: string; url: string };
  lists: ListInfo[];
  cards: CardSummary[];
  source: "db" | "trello";
  lastSynced?: string | null;
  isStale?: boolean;
  fetchedAt: number;
};

type CheckItemInfo = { id: string; name: string; complete: boolean };
type ChecklistInfo = { id: string; name: string; items: CheckItemInfo[] };
type CommentInfo = { id: string; date: string | null; text: string; author: string };

type CardDetailResult = {
  card: {
    id: string;
    name: string;
    desc: string;
    idList: string;
    url: string;
    labels: Array<{ id: string; name: string; color?: string }>;
    dateLastActivity: string | null;
  };
  comments: CommentInfo[];
  checklists: ChecklistInfo[];
  source: "db" | "trello";
};

type MutationResult = { ok: boolean };

type CardMetricsWindow = { start: string; end: string | null; durationMin?: number };

type CardMetricsResult = {
  cardId: string;
  windows: CardMetricsWindow[];
  totalCost: number;
  totalEvents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalDurationMin: number;
  firstEvent?: string | null;
  lastEvent?: string | null;
  byModel: unknown[];
  noDb?: boolean;
  fetchedAt: number;
};

export interface TaskProvider {
  /** List all cards on the board. */
  list(config: TrelloConfig): Promise<ListResult>;

  /** Get card detail (checklists + comments). */
  cardDetail(config: TrelloConfig, cardId: string): Promise<CardDetailResult>;

  /** Move a card to a different list. */
  moveCard(config: TrelloConfig, cardId: string, listId: string): Promise<MutationResult>;

  /** Approve a card (add approved label, remove new label, move to Approved list). */
  approveCard(config: TrelloConfig, cardId: string): Promise<MutationResult>;

  /** Add a comment to a card. */
  addComment(config: TrelloConfig, cardId: string, text: string): Promise<MutationResult>;

  /** Toggle a checklist item complete/incomplete. */
  toggleCheckItem(
    config: TrelloConfig,
    cardId: string,
    checkItemId: string,
    complete: boolean,
  ): Promise<MutationResult>;

  /** Remove the "new" label from a card. */
  markSeen(config: TrelloConfig, cardId: string): Promise<MutationResult>;

  /** Get cost/token metrics for a card. */
  cardMetrics(cardId: string): CardMetricsResult;
}

// ── TrelloProvider implementation ────────────────────────────

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

export class TrelloProvider implements TaskProvider {
  async list(config: TrelloConfig): Promise<ListResult> {
    // Try DB first
    const db = getTasksDb();
    if (db) {
      try {
        return this.listFromDb(db, config);
      } catch (err) {
        console.error("DB read failed, falling back to Trello:", err);
      }
    }
    return this.listFromApi(config);
  }

  async cardDetail(config: TrelloConfig, cardId: string): Promise<CardDetailResult> {
    const db = getTasksDb();
    if (db) {
      try {
        const result = this.cardDetailFromDb(db, cardId);
        if (result) return result;
      } catch (err) {
        console.error("DB cardDetail failed, falling back to Trello:", err);
      }
    }
    return this.cardDetailFromApi(config, cardId);
  }

  async moveCard(config: TrelloConfig, cardId: string, listId: string): Promise<MutationResult> {
    await putTrello(`/cards/${cardId}`, config.apiKey, config.apiToken, { idList: listId });
    const wdb = getTasksDbWritable();
    if (wdb) {
      wdb.prepare("UPDATE cards SET list_id=? WHERE id=?").run(listId, cardId);
      wdb.close();
      refreshTasksDb();
    }
    return { ok: true };
  }

  async approveCard(config: TrelloConfig, cardId: string): Promise<MutationResult> {
    if (config.approvedLabelId) {
      await postTrello(`/cards/${cardId}/idLabels`, config.apiKey, config.apiToken, {
        value: config.approvedLabelId,
      }).catch(() => {});
    }
    if (config.newLabelId) {
      await deleteTrello(
        `/cards/${cardId}/idLabels/${config.newLabelId}`,
        config.apiKey,
        config.apiToken,
      ).catch(() => {});
    }
    // Move to Approved list
    const db = getTasksDb();
    const approvedList = db
      ? (
          db
            .prepare("SELECT id FROM lists WHERE board_id=? AND name='Approved'")
            .all(config.boardId) as Array<{ id: string }>
        )[0]
      : null;
    const approvedListId = approvedList?.id;
    if (approvedListId) {
      await putTrello(`/cards/${cardId}`, config.apiKey, config.apiToken, {
        idList: approvedListId,
      });
      const wdb = getTasksDbWritable();
      if (wdb) {
        wdb.prepare("UPDATE cards SET list_id=? WHERE id=?").run(approvedListId, cardId);
        wdb.close();
        refreshTasksDb();
      }
    }
    return { ok: true };
  }

  async addComment(config: TrelloConfig, cardId: string, text: string): Promise<MutationResult> {
    const result = await postTrello(
      `/cards/${cardId}/actions/comments`,
      config.apiKey,
      config.apiToken,
      { text },
    );
    const wdb = getTasksDbWritable();
    if (wdb && result && typeof result === "object" && "id" in result) {
      wdb
        .prepare(
          "INSERT OR IGNORE INTO comments (id, card_id, text, author, created_at, synced_at) VALUES (?,?,?,?,datetime('now'),datetime('now'))",
        )
        .run((result as { id: string }).id, cardId, text, "Jeeves");
      wdb.close();
      refreshTasksDb();
    }
    return { ok: true };
  }

  async toggleCheckItem(
    config: TrelloConfig,
    cardId: string,
    checkItemId: string,
    complete: boolean,
  ): Promise<MutationResult> {
    const state = complete ? "complete" : "incomplete";
    await putTrello(`/cards/${cardId}/checkItem/${checkItemId}`, config.apiKey, config.apiToken, {
      state,
    });
    const wdb = getTasksDbWritable();
    if (wdb) {
      wdb
        .prepare("UPDATE checklist_items SET state=? WHERE id=? AND card_id=?")
        .run(state, checkItemId, cardId);
      wdb.close();
      refreshTasksDb();
    }
    return { ok: true };
  }

  async markSeen(config: TrelloConfig, cardId: string): Promise<MutationResult> {
    if (config.newLabelId) {
      await deleteTrello(
        `/cards/${cardId}/idLabels/${config.newLabelId}`,
        config.apiKey,
        config.apiToken,
      ).catch(() => {});
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
    return { ok: true };
  }

  cardMetrics(cardId: string): CardMetricsResult {
    const tasksDb = getTasksDb();
    const windows: Array<{ start: string; end: string | null }> = [];

    if (tasksDb) {
      const entries = tasksDb
        .prepare(
          "SELECT ts, category, card_id FROM activity WHERE category IN ('task', 'done') ORDER BY ts ASC",
        )
        .all() as Array<{ ts: string; category: string; card_id: string | null }>;

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

    const emptyResult: CardMetricsResult = {
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
    };

    if (windows.length === 0) return emptyResult;

    const costDb = getCostDb();
    if (!costDb) {
      return { ...emptyResult, windows, noDb: true };
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

      const summary = costDb
        .prepare(
          `SELECT COUNT(*) as events, ROUND(COALESCE(SUM(cost_total), 0), 4) as cost,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(cache_read), 0) as cache_tokens,
          MIN(ts) as first_event, MAX(ts) as last_event
         FROM usage_events WHERE ${where}`,
        )
        .all();

      const byModel = costDb
        .prepare(
          `SELECT model, COUNT(*) as events, ROUND(SUM(cost_total), 4) as cost,
          SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
         FROM usage_events WHERE (${where})
         AND model NOT IN ('unknown', 'delivery-mirror')
         GROUP BY model ORDER BY cost DESC`,
        )
        .all();

      costDb.close();

      const s = (summary[0] ?? {}) as Record<string, unknown>;
      let totalDurationMs = 0;
      for (const w of windows) {
        const start = new Date(w.start).getTime();
        const end = w.end ? new Date(w.end).getTime() : Date.now();
        totalDurationMs += end - start;
      }

      return {
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
        firstEvent: (s.first_event as string) ?? null,
        lastEvent: (s.last_event as string) ?? null,
        byModel,
        fetchedAt: Date.now(),
      };
    } catch (err) {
      try {
        costDb.close();
      } catch {}
      throw err;
    }
  }

  // ── Private: DB read paths ─────────────────────────────────

  private listFromDb(db: SqliteDatabase, config: TrelloConfig): ListResult {
    const lists = getLists(db, config.boardId);
    const cards = getCardsByBoard(db, config.boardId);
    const listMap = new Map(lists.map((l) => [l.id, l.name]));

    const cardData: CardSummary[] = cards.map((c) => {
      const progress = getChecklistProgress(db, c.id);
      let labels: Array<{ id: string; name: string; color?: string }> = [];
      try {
        labels = JSON.parse(c.labels || "[]");
      } catch {}
      const commentCount = db
        .prepare("SELECT COUNT(*) as cnt FROM comments WHERE card_id=?")
        .all(c.id);

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

    // Check staleness
    const syncedTimes = cards
      .map((c) => c.synced_at)
      .filter(Boolean)
      .sort();
    const lastSynced = syncedTimes.length > 0 ? syncedTimes[syncedTimes.length - 1] : null;
    const staleMs = lastSynced ? Date.now() - new Date(lastSynced!).getTime() : Infinity;
    const isStale = staleMs > 5 * 60 * 1000; // >5 minutes

    return {
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
    };
  }

  private async listFromApi(config: TrelloConfig): Promise<ListResult> {
    const [lists, cards] = (await Promise.all([
      fetch(
        trelloUrl(
          `/boards/${config.boardId}/lists?fields=name,closed`,
          config.apiKey,
          config.apiToken,
        ),
      ).then((r) => r.json()),
      fetch(
        trelloUrl(
          `/boards/${config.boardId}/cards?fields=name,desc,idList,url,labels,idChecklists,dateLastActivity,badges`,
          config.apiKey,
          config.apiToken,
        ),
      ).then((r) => r.json()),
    ])) as [
      Array<{ id: string; name: string; closed: boolean }>,
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
      }>,
    ];

    const listMap = new Map(lists.map((l) => [l.id, l.name]));
    return {
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
      source: "trello",
      fetchedAt: Date.now(),
    };
  }

  private cardDetailFromDb(db: SqliteDatabase, cardId: string): CardDetailResult | null {
    const card = getCard(db, cardId);
    if (!card) return null;

    const checklists = getChecklists(db, cardId);
    const comments = getComments(db, cardId, 20);

    let labels: Array<{ id: string; name: string; color?: string }> = [];
    try {
      labels = JSON.parse(card.labels || "[]");
    } catch {}

    return {
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
    };
  }

  private async cardDetailFromApi(
    config: TrelloConfig,
    cardId: string,
  ): Promise<CardDetailResult> {
    const [card, actions, checklists] = await Promise.all([
      fetch(
        trelloUrl(
          `/cards/${cardId}?fields=name,desc,idList,url,labels,dateLastActivity`,
          config.apiKey,
          config.apiToken,
        ),
      ).then((r) => r.json()),
      fetch(
        trelloUrl(
          `/cards/${cardId}/actions?filter=commentCard&limit=20`,
          config.apiKey,
          config.apiToken,
        ),
      ).then((r) => r.json()),
      fetch(trelloUrl(`/cards/${cardId}/checklists`, config.apiKey, config.apiToken)).then((r) =>
        r.json(),
      ),
    ]);

    return {
      card,
      comments: (
        actions as Array<{
          id: string;
          date: string;
          data: { text: string };
          memberCreator: { fullName: string };
        }>
      ).map((a) => ({
        id: a.id,
        date: a.date,
        text: a.data.text,
        author: a.memberCreator.fullName,
      })),
      checklists: (
        checklists as Array<{
          id: string;
          name: string;
          checkItems: Array<{ id: string; name: string; state: string }>;
        }>
      ).map((cl) => ({
        id: cl.id,
        name: cl.name,
        items: cl.checkItems.map((ci) => ({
          id: ci.id,
          name: ci.name,
          complete: ci.state === "complete",
        })),
      })),
      source: "trello",
    };
  }
}
