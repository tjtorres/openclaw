/**
 * Activity feed RPC handler — reads from tasks.sqlite.
 */
import type { GatewayRequestHandlers } from "./types.js";
import { getTasksDb, getActiveTask, getRecentActivity, getChecklistProgress } from "./tasks-db.js";

export const activityHandlers: GatewayRequestHandlers = {
  "activity.feed": ({ params, respond }) => {
    const limit = (params as { limit?: number }).limit ?? 30;

    const db = getTasksDb();
    if (!db) {
      respond(true, { currentTask: null, progress: null, entries: [], fetchedAt: Date.now() });
      return;
    }

    // Read active task from DB
    const task = getActiveTask(db);
    let currentTask: Record<string, unknown> | null = null;
    if (task?.card_id) {
      currentTask = {
        cardId: task.card_id,
        cardName: task.card_name,
        boardId: task.board_id,
        startedAt: task.started_at,
        checklistMapping: JSON.parse(task.checklist_mapping || "{}"),
      };
    }

    // Read activity from DB
    const entries = getRecentActivity(db, limit).map((e) => ({
      ts: e.ts,
      icon: e.icon,
      message: e.message,
      category: e.category,
      cardId: e.card_id,
      cardName: e.card_name,
    }));

    // Calculate progress from DB
    let progress: { total: number; done: number; pct: number } | null = null;
    if (currentTask?.cardId) {
      const p = getChecklistProgress(db, currentTask.cardId as string);
      progress = {
        total: p.total,
        done: p.done,
        pct: p.total > 0 ? Math.round((p.done / p.total) * 100) : 0,
      };
    }

    respond(true, {
      currentTask,
      progress,
      entries,
      fetchedAt: Date.now(),
    });
  },
};
