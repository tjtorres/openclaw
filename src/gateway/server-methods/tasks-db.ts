/**
 * TypeScript wrapper for tasks.sqlite — the central DB for task/sprint/activity data.
 *
 * Used by UI RPCs to read data locally instead of hitting Trello API on every request.
 * Write operations still go through Trello API; the sync engine keeps DB fresh.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

type SqliteDatabase = import("node:sqlite").DatabaseSync;

function workspacePath(): string {
  return (
    process.env.OPENCLAW_WORKSPACE ??
    join(process.env.HOME ?? "/home/teej", ".openclaw", "workspace")
  );
}

let _dbInstance: SqliteDatabase | null = null;

/** Get a shared read-only connection to tasks.sqlite. */
export function getTasksDb(): SqliteDatabase | null {
  if (_dbInstance) return _dbInstance;
  try {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dbPath = join(workspacePath(), "tasks.sqlite");
    if (!existsSync(dbPath)) return null;
    _dbInstance = new DatabaseSync(dbPath, { readOnly: true });
    return _dbInstance;
  } catch {
    return null;
  }
}

/** Get a writable connection (for mutations). Opens a new connection each time. */
export function getTasksDbWritable(): SqliteDatabase | null {
  try {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const dbPath = join(workspacePath(), "tasks.sqlite");
    if (!existsSync(dbPath)) return null;
    return new DatabaseSync(dbPath);
  } catch {
    return null;
  }
}

/** Refresh the read-only connection (call after writes to see fresh data). */
export function refreshTasksDb(): void {
  if (_dbInstance) {
    try { _dbInstance.close(); } catch {}
    _dbInstance = null;
  }
}

// ── Query helpers ────────────────────────────────────────────

export type DbCard = {
  id: string;
  name: string;
  description: string;
  list_id: string;
  board_id: string;
  position: number;
  due_date: string | null;
  labels: string; // JSON
  url: string;
  closed: number;
  created_at: string | null;
  updated_at: string | null;
  synced_at: string | null;
};

export type DbList = {
  id: string;
  name: string;
  board_id: string;
  position: number;
};

export type DbChecklist = {
  id: string;
  card_id: string;
  name: string;
  position: number;
};

export type DbChecklistItem = {
  id: string;
  checklist_id: string;
  card_id: string;
  name: string;
  state: string;
  position: number;
};

export type DbComment = {
  id: string;
  card_id: string;
  text: string;
  author: string;
  created_at: string | null;
};

export type DbSprint = {
  id: string;
  name: string;
  goal: string;
  status: string;
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
};

export type DbSprintCard = {
  sprint_id: string;
  card_id: string;
  card_name: string;
  added_at: string;
  completed_at: string | null;
};

export type DbActivity = {
  id: number;
  ts: string;
  icon: string;
  message: string;
  category: string;
  card_id: string | null;
  card_name: string | null;
  metadata: string;
};

export type DbActiveTask = {
  card_id: string | null;
  card_name: string | null;
  board_id: string | null;
  started_at: string | null;
  checklist_mapping: string;
};

// ── Board queries ────────────────────────────────────────────

export function getLists(db: SqliteDatabase, boardId: string): DbList[] {
  return db.prepare("SELECT * FROM lists WHERE board_id=? ORDER BY position").all(boardId) as DbList[];
}

export function getCardsByBoard(db: SqliteDatabase, boardId: string): DbCard[] {
  return db.prepare("SELECT * FROM cards WHERE board_id=? AND closed=0 ORDER BY position").all(boardId) as DbCard[];
}

export function getCardsByList(db: SqliteDatabase, listId: string): DbCard[] {
  return db.prepare("SELECT * FROM cards WHERE list_id=? AND closed=0 ORDER BY position").all(listId) as DbCard[];
}

export function getCard(db: SqliteDatabase, cardId: string): DbCard | null {
  const row = db.prepare("SELECT * FROM cards WHERE id=?").all(cardId);
  return (row[0] as DbCard) ?? null;
}

// ── Checklist queries ────────────────────────────────────────

export function getChecklists(db: SqliteDatabase, cardId: string) {
  const checklists = db.prepare("SELECT * FROM checklists WHERE card_id=? ORDER BY position").all(cardId) as DbChecklist[];
  return checklists.map((cl) => ({
    ...cl,
    checkItems: db.prepare("SELECT * FROM checklist_items WHERE checklist_id=? ORDER BY position").all(cl.id) as DbChecklistItem[],
  }));
}

export function getChecklistProgress(db: SqliteDatabase, cardId: string): { done: number; total: number } {
  const row = db.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN state='complete' THEN 1 ELSE 0 END) as done
    FROM checklist_items WHERE card_id=?
  `).all(cardId);
  const r = row[0] as { total: number; done: number } | undefined;
  return { done: Number(r?.done ?? 0), total: Number(r?.total ?? 0) };
}

// ── Comment queries ──────────────────────────────────────────

export function getComments(db: SqliteDatabase, cardId: string, limit = 20): DbComment[] {
  return db.prepare("SELECT * FROM comments WHERE card_id=? ORDER BY created_at DESC LIMIT ?").all(cardId, limit) as DbComment[];
}

// ── Sprint queries ───────────────────────────────────────────

export function getActiveSprint(db: SqliteDatabase): DbSprint | null {
  const rows = db.prepare("SELECT * FROM sprints WHERE status='active' LIMIT 1").all();
  return (rows[0] as DbSprint) ?? null;
}

export function getAllSprints(db: SqliteDatabase): DbSprint[] {
  return db.prepare("SELECT * FROM sprints ORDER BY created_at DESC").all() as DbSprint[];
}

export function getSprintCards(db: SqliteDatabase, sprintId: string): DbSprintCard[] {
  return db.prepare("SELECT * FROM sprint_cards WHERE sprint_id=? ORDER BY added_at").all(sprintId) as DbSprintCard[];
}

// ── Activity queries ─────────────────────────────────────────

export function getRecentActivity(db: SqliteDatabase, limit = 30): DbActivity[] {
  return db.prepare("SELECT * FROM activity ORDER BY ts DESC LIMIT ?").all(limit) as DbActivity[];
}

export function getActivityByCard(db: SqliteDatabase, cardId: string, limit = 50): DbActivity[] {
  return db.prepare("SELECT * FROM activity WHERE card_id=? ORDER BY ts DESC LIMIT ?").all(cardId, limit) as DbActivity[];
}

// ── Active task queries ──────────────────────────────────────

export function getActiveTask(db: SqliteDatabase): DbActiveTask | null {
  const rows = db.prepare("SELECT * FROM active_task WHERE id=1").all();
  return (rows[0] as DbActiveTask) ?? null;
}

export { workspacePath };
