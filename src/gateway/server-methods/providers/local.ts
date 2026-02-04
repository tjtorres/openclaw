/**
 * LocalProvider — zero-dependency task management backed by SQLite only.
 *
 * No external service (no Trello, no GitHub). Cards, lists, checklists,
 * and comments are all managed locally in tasks.sqlite.
 *
 * This is the baseline provider: works on any machine with no config.
 * Great for solo developers or airgapped environments.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  TaskProvider,
  ListResult,
  CardDetail,
  MutationResult,
  CardMetricsResult,
  CardSummary,
} from "../task-provider.js";
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

// Default board ID for local-only mode
const LOCAL_BOARD_ID = "local";
const LOCAL_BOARD_NAME = "Task Queue";

const DEFAULT_LISTS = [
  { id: "local-proposed", name: "Proposed", position: 0 },
  { id: "local-approved", name: "Approved", position: 1 },
  { id: "local-in-progress", name: "In Progress", position: 2 },
  { id: "local-blocked", name: "Blocked", position: 3 },
  { id: "local-done", name: "Done", position: 4 },
];

function ensureLocalBoard(): void {
  const wdb = getTasksDbWritable();
  if (!wdb) return;

  try {
    // Check if local board exists
    const existing = wdb
      .prepare("SELECT id FROM lists WHERE board_id=? LIMIT 1")
      .all(LOCAL_BOARD_ID);

    if (existing.length === 0) {
      // Create default lists
      const stmt = wdb.prepare(
        "INSERT OR IGNORE INTO lists (id, board_id, name, position, synced_at) VALUES (?,?,?,?,datetime('now'))",
      );
      for (const list of DEFAULT_LISTS) {
        stmt.run(list.id, LOCAL_BOARD_ID, list.name, list.position);
      }
    }
  } finally {
    wdb.close();
    refreshTasksDb();
  }
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

function computeCardMetrics(cardId: string): CardMetricsResult {
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
  if (!costDb) return { ...emptyResult, windows, noDb: true };

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
          ((w.end ? new Date(w.end).getTime() : Date.now()) - new Date(w.start).getTime()) / 60000,
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

export class LocalProvider implements TaskProvider {
  readonly name = "local";

  constructor() {
    ensureLocalBoard();
  }

  isConfigured(): boolean {
    return getTasksDb() !== null;
  }

  async list(): Promise<ListResult> {
    const db = getTasksDb();
    if (!db) throw new Error("tasks.sqlite not available");

    const lists = getLists(db, LOCAL_BOARD_ID);
    const cards = getCardsByBoard(db, LOCAL_BOARD_ID);
    const listMap = new Map(lists.map((l) => [l.id, l.name]));

    const cardData: CardSummary[] = cards.map((c) => {
      const progress = getChecklistProgress(db, c.id);
      let labels: Array<{ id: string; name: string; color?: string }> = [];
      try {
        labels = JSON.parse(c.labels || "[]");
      } catch {}
      const commentCount = db.prepare("SELECT COUNT(*) as cnt FROM comments WHERE card_id=?").all(c.id);

      return {
        id: c.id,
        name: c.name,
        desc: c.description ?? "",
        url: `#card/${c.id}`,
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

    return {
      board: { id: LOCAL_BOARD_ID, name: LOCAL_BOARD_NAME, url: "#" },
      lists: lists.map((l) => ({ id: l.id, name: l.name, closed: false })),
      cards: cardData,
      source: "db",
      fetchedAt: Date.now(),
    };
  }

  async cardDetail(cardId: string): Promise<CardDetail | null> {
    const db = getTasksDb();
    if (!db) return null;

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
        url: `#card/${card.id}`,
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

  async moveCard(cardId: string, listId: string): Promise<MutationResult> {
    const wdb = getTasksDbWritable();
    if (!wdb) throw new Error("DB not writable");
    wdb.prepare("UPDATE cards SET list_id=?, updated_at=datetime('now') WHERE id=?").run(listId, cardId);
    wdb.close();
    refreshTasksDb();
    return { ok: true };
  }

  async approveCard(cardId: string): Promise<MutationResult> {
    const wdb = getTasksDbWritable();
    if (!wdb) throw new Error("DB not writable");

    // Find the Approved list
    const approved = wdb
      .prepare("SELECT id FROM lists WHERE board_id=? AND name='Approved' LIMIT 1")
      .all(LOCAL_BOARD_ID) as Array<{ id: string }>;
    const approvedId = approved[0]?.id;

    if (approvedId) {
      wdb.prepare("UPDATE cards SET list_id=?, updated_at=datetime('now') WHERE id=?").run(approvedId, cardId);
    }

    // Update labels: add "approved", remove "new"
    const row = wdb.prepare("SELECT labels FROM cards WHERE id=?").all(cardId) as Array<{ labels: string }>;
    if (row.length > 0) {
      let labels = [];
      try { labels = JSON.parse(row[0].labels || "[]"); } catch {}
      labels = labels.filter((l: { name: string }) => l.name !== "new");
      if (!labels.some((l: { name: string }) => l.name === "approved")) {
        labels.push({ id: `local-label-approved`, name: "approved", color: "green" });
      }
      wdb.prepare("UPDATE cards SET labels=? WHERE id=?").run(JSON.stringify(labels), cardId);
    }

    wdb.close();
    refreshTasksDb();
    return { ok: true };
  }

  async addComment(cardId: string, text: string): Promise<MutationResult> {
    const wdb = getTasksDbWritable();
    if (!wdb) throw new Error("DB not writable");
    const id = randomUUID();
    wdb.prepare(
      "INSERT INTO comments (id, card_id, text, author, created_at, synced_at) VALUES (?,?,?,?,datetime('now'),datetime('now'))",
    ).run(id, cardId, text, "Agent");
    wdb.close();
    refreshTasksDb();
    return { ok: true };
  }

  async toggleCheckItem(cardId: string, checkItemId: string, complete: boolean): Promise<MutationResult> {
    const wdb = getTasksDbWritable();
    if (!wdb) throw new Error("DB not writable");
    const state = complete ? "complete" : "incomplete";
    wdb.prepare("UPDATE checklist_items SET state=? WHERE id=? AND card_id=?").run(state, checkItemId, cardId);
    wdb.close();
    refreshTasksDb();
    return { ok: true };
  }

  async markSeen(cardId: string): Promise<MutationResult> {
    const wdb = getTasksDbWritable();
    if (!wdb) throw new Error("DB not writable");
    const row = wdb.prepare("SELECT labels FROM cards WHERE id=?").all(cardId) as Array<{ labels: string }>;
    if (row.length > 0) {
      let labels = [];
      try { labels = JSON.parse(row[0].labels || "[]"); } catch {}
      labels = labels.filter((l: { name: string }) => l.name !== "new");
      wdb.prepare("UPDATE cards SET labels=? WHERE id=?").run(JSON.stringify(labels), cardId);
    }
    wdb.close();
    refreshTasksDb();
    return { ok: true };
  }

  cardMetrics(cardId: string): CardMetricsResult {
    return computeCardMetrics(cardId);
  }

  async sync(): Promise<void> {
    // No-op for local provider — nothing to sync
  }
}

// Export the shared metrics computation for use by other providers
export { computeCardMetrics };
