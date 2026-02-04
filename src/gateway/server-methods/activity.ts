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

  /**
   * Work status — focused view for the overview panel.
   * Returns: current task, checklist progress, recent status messages,
   * and a generated summary of current work.
   */
  "activity.workStatus": ({ respond }) => {
    const db = getTasksDb();
    if (!db) {
      respond(true, {
        currentTask: null,
        progress: null,
        recentStatus: [],
        summary: "No task database available.",
        isIdle: true,
        fetchedAt: Date.now(),
      });
      return;
    }

    // Current task
    const task = getActiveTask(db);
    let currentTask: Record<string, unknown> | null = null;
    let progress: { total: number; done: number; pct: number; items: Array<{ name: string; done: boolean }> } | null = null;

    if (task?.card_id) {
      currentTask = {
        cardId: task.card_id,
        cardName: task.card_name,
        startedAt: task.started_at,
      };

      // Detailed checklist progress
      const p = getChecklistProgress(db, task.card_id);
      const checklistItems = db.prepare(
        `SELECT ci.name, ci.state FROM checklist_items ci
         JOIN checklists cl ON ci.checklist_id = cl.id
         WHERE cl.card_id = ? ORDER BY ci.position`
      ).all(task.card_id) as Array<{ name: string; state: string }>;

      progress = {
        total: p.total,
        done: p.done,
        pct: p.total > 0 ? Math.round((p.done / p.total) * 100) : 0,
        items: checklistItems.map(i => ({ name: i.name, done: i.state === "complete" })),
      };
    }

    // Recent status messages (last 10, status category only for the live feed)
    const recentStatus = db.prepare(
      `SELECT ts, icon, message, category, card_id, card_name
       FROM activity
       WHERE category IN ('status', 'task', 'done', 'check', 'commit')
       ORDER BY ts DESC LIMIT 10`
    ).all() as Array<{ ts: string; icon: string; message: string; category: string; card_id: string | null; card_name: string | null }>;

    // Build summary from current state
    let summary: string;
    const isIdle = !currentTask;

    if (isIdle) {
      // Check what was last completed
      const lastDone = db.prepare(
        `SELECT message, ts FROM activity WHERE category='done' ORDER BY ts DESC LIMIT 1`
      ).all() as Array<{ message: string; ts: string }>;

      if (lastDone.length > 0) {
        const ago = Math.round((Date.now() - new Date(lastDone[0].ts).getTime()) / 60000);
        summary = `Idle. Last completed: ${lastDone[0].message} (${ago}m ago). Scanning for new tasks.`;
      } else {
        summary = "Idle — no active task. Waiting for work or generating proposals.";
      }
    } else {
      const taskName = (currentTask!.cardName as string) || "Unknown task";
      const pctStr = progress ? `${progress.pct}%` : "?%";
      const latestMsg = recentStatus.length > 0 ? recentStatus[0].message : "";

      if (progress && progress.done === progress.total && progress.total > 0) {
        summary = `Finishing up: ${taskName} (${progress.done}/${progress.total} items complete)`;
      } else if (latestMsg) {
        summary = `${taskName} [${pctStr}] — ${latestMsg}`;
      } else {
        summary = `Working on: ${taskName} [${pctStr}]`;
      }
    }

    respond(true, {
      currentTask,
      progress,
      recentStatus: recentStatus.map(s => ({
        ts: s.ts,
        icon: s.icon,
        message: s.message,
        category: s.category,
        cardId: s.card_id,
      })),
      summary,
      isIdle,
      fetchedAt: Date.now(),
    });
  },
};
