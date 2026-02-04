/**
 * Sprint RPC handlers — reads from tasks.sqlite, writes to DB + syncs.
 */
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  getTasksDb,
  getTasksDbWritable,
  refreshTasksDb,
  getActiveSprint,
  getAllSprints,
  getSprintCards,
  type DbSprint,
  type DbSprintCard,
} from "./tasks-db.js";

// ── Burndown calculation ─────────────────────────────────────

type BurndownPoint = { date: string; remaining: number; completed: number; total: number };

function computeBurndown(sprint: DbSprint, cards: DbSprintCard[]): BurndownPoint[] {
  const start = new Date(sprint.start_date);
  const end = new Date(sprint.end_date);
  const total = cards.length;
  const points: BurndownPoint[] = [];

  const current = new Date(start);
  while (current <= end && current <= new Date()) {
    const dateStr = current.toISOString().split("T")[0]!;
    const completedByDate = cards.filter(
      (c) => c.completed_at && c.completed_at.split("T")[0]! <= dateStr,
    ).length;
    points.push({ date: dateStr, remaining: total - completedByDate, completed: completedByDate, total });
    current.setDate(current.getDate() + 1);
  }

  return points;
}

function computeVelocity(db: ReturnType<typeof getTasksDb>): Array<{
  sprintId: string; name: string; completed: number; total: number; days: number;
}> {
  if (!db) return [];
  const completed = db.prepare("SELECT * FROM sprints WHERE status='completed' ORDER BY created_at DESC LIMIT 5")
    .all() as DbSprint[];

  return completed.map((s) => {
    const cards = getSprintCards(db, s.id);
    const days = Math.max(1, Math.ceil((new Date(s.end_date).getTime() - new Date(s.start_date).getTime()) / 86400000));
    return {
      sprintId: s.id,
      name: s.name,
      completed: cards.filter((c) => c.completed_at).length,
      total: cards.length,
      days,
    };
  });
}

/** Format sprint + cards into the shape the frontend expects. */
function formatSprint(sprint: DbSprint, cards: DbSprintCard[], includeBurndown = false) {
  const base = {
    id: sprint.id,
    name: sprint.name,
    goal: sprint.goal,
    status: sprint.status,
    startDate: sprint.start_date,
    endDate: sprint.end_date,
    cards: cards.map((c) => ({
      cardId: c.card_id,
      cardName: c.card_name,
      addedAt: c.added_at,
      completedAt: c.completed_at,
    })),
    createdAt: sprint.created_at,
    updatedAt: sprint.updated_at,
    completedAt: null,
    cardCount: cards.length,
    completedCount: cards.filter((c) => c.completed_at).length,
  };
  if (includeBurndown) {
    return { ...base, burndown: computeBurndown(sprint, cards) };
  }
  return base;
}

export const sprintHandlers: GatewayRequestHandlers = {
  "sprints.list": ({ respond }) => {
    const db = getTasksDb();
    if (!db) {
      respond(true, { sprints: [], active: null, velocity: [], fetchedAt: Date.now() });
      return;
    }

    const allSprints = getAllSprints(db);
    const active = getActiveSprint(db);
    const velocity = computeVelocity(db);

    respond(true, {
      sprints: allSprints.map((s) => formatSprint(s, getSprintCards(db, s.id))),
      active: active ? formatSprint(active, getSprintCards(db, active.id), true) : null,
      velocity,
      fetchedAt: Date.now(),
    });
  },

  "sprints.create": ({ params, respond }) => {
    const { name, goal, startDate, endDate, cardIds } = params as {
      name?: string; goal?: string; startDate?: string; endDate?: string;
      cardIds?: Array<{ id: string; name: string }>;
    };

    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "name required"));
      return;
    }

    const db = getTasksDbWritable();
    if (!db) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "DB not available"));
      return;
    }

    // Check for existing active sprint
    const existing = db.prepare("SELECT id FROM sprints WHERE status='active'").all();
    if (existing.length > 0) {
      db.close();
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "An active sprint already exists."));
      return;
    }

    // Generate next ID
    const maxId = db.prepare("SELECT id FROM sprints ORDER BY id DESC LIMIT 1").all();
    let nextNum = 1;
    if (maxId.length > 0) {
      const match = ((maxId[0] as { id: string }).id).match(/SPR-(\d+)/);
      if (match) nextNum = parseInt(match[1]!, 10) + 1;
    }
    const sprintId = `SPR-${String(nextNum).padStart(3, "0")}`;

    const now = new Date().toISOString();
    const sd = startDate ?? now.split("T")[0]!;
    const ed = endDate ?? new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0]!;

    db.prepare(`
      INSERT INTO sprints (id, name, goal, status, start_date, end_date, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(sprintId, name, goal ?? "", sd, ed, now, now);

    // Add cards
    for (const c of cardIds ?? []) {
      db.prepare(`
        INSERT OR IGNORE INTO sprint_cards (sprint_id, card_id, card_name, added_at)
        VALUES (?, ?, ?, ?)
      `).run(sprintId, c.id, c.name, now);
    }

    db.close();
    refreshTasksDb();
    respond(true, { sprint: { id: sprintId, name, status: "active" } });
  },

  "sprints.update": ({ params, respond }) => {
    const { sprintId, name, goal, endDate, status } = params as {
      sprintId?: string; name?: string; goal?: string; endDate?: string; status?: string;
    };
    if (!sprintId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sprintId required"));
      return;
    }

    const db = getTasksDbWritable();
    if (!db) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "DB not available"));
      return;
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    if (name) { updates.push("name=?"); values.push(name); }
    if (goal !== undefined) { updates.push("goal=?"); values.push(goal); }
    if (endDate) { updates.push("end_date=?"); values.push(endDate); }
    if (status) { updates.push("status=?"); values.push(status); }
    updates.push("updated_at=?");
    values.push(new Date().toISOString());
    values.push(sprintId);

    db.prepare(`UPDATE sprints SET ${updates.join(", ")} WHERE id=?`).run(...values);
    db.close();
    refreshTasksDb();
    respond(true, { ok: true });
  },

  "sprints.addCard": ({ params, respond }) => {
    const { sprintId, cardId, cardName } = params as {
      sprintId?: string; cardId?: string; cardName?: string;
    };
    if (!sprintId || !cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sprintId and cardId required"));
      return;
    }

    const db = getTasksDbWritable();
    if (!db) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "DB not available"));
      return;
    }

    db.prepare(`
      INSERT OR IGNORE INTO sprint_cards (sprint_id, card_id, card_name, added_at)
      VALUES (?, ?, ?, ?)
    `).run(sprintId, cardId, cardName ?? cardId, new Date().toISOString());
    db.prepare("UPDATE sprints SET updated_at=? WHERE id=?").run(new Date().toISOString(), sprintId);
    db.close();
    refreshTasksDb();
    respond(true, { ok: true });
  },

  "sprints.completeCard": ({ params, respond }) => {
    const { sprintId, cardId } = params as { sprintId?: string; cardId?: string };
    if (!sprintId || !cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sprintId and cardId required"));
      return;
    }

    const db = getTasksDbWritable();
    if (!db) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "DB not available"));
      return;
    }

    db.prepare("UPDATE sprint_cards SET completed_at=? WHERE sprint_id=? AND card_id=? AND completed_at IS NULL")
      .run(new Date().toISOString(), sprintId, cardId);
    db.prepare("UPDATE sprints SET updated_at=? WHERE id=?").run(new Date().toISOString(), sprintId);
    db.close();
    refreshTasksDb();
    respond(true, { ok: true });
  },

  "sprints.removeCard": ({ params, respond }) => {
    const { sprintId, cardId } = params as { sprintId?: string; cardId?: string };
    if (!sprintId || !cardId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sprintId and cardId required"));
      return;
    }

    const db = getTasksDbWritable();
    if (!db) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "DB not available"));
      return;
    }

    db.prepare("DELETE FROM sprint_cards WHERE sprint_id=? AND card_id=?").run(sprintId, cardId);
    db.prepare("UPDATE sprints SET updated_at=? WHERE id=?").run(new Date().toISOString(), sprintId);
    db.close();
    refreshTasksDb();
    respond(true, { ok: true });
  },
};
