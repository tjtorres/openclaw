import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function workspacePath(): string {
  return (
    process.env.OPENCLAW_WORKSPACE ??
    join(process.env.HOME ?? "/home/teej", ".openclaw", "workspace")
  );
}

export const activityHandlers: GatewayRequestHandlers = {
  "activity.feed": ({ params, respond }) => {
    const workspace = workspacePath();
    const limit = (params as { limit?: number }).limit ?? 30;

    // Read current task
    let currentTask: Record<string, unknown> | null = null;
    const taskPath = join(workspace, "current_task.json");
    if (existsSync(taskPath)) {
      try {
        const raw = JSON.parse(readFileSync(taskPath, "utf-8"));
        if (raw.cardId) currentTask = raw;
      } catch {}
    }

    // Read activity log (last N entries)
    const logPath = join(workspace, "activity.jsonl");
    let entries: unknown[] = [];
    if (existsSync(logPath)) {
      try {
        const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
        const parsed = lines
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        entries = parsed.slice(-limit).reverse(); // newest first
      } catch {}
    }

    // Calculate progress from current task
    let progress: { total: number; done: number; pct: number } | null = null;
    if (currentTask) {
      const mapping = (currentTask.checklistMapping ?? {}) as Record<string, string>;
      const remaining = Object.keys(mapping).length;
      // We need total — remaining is what's left. Get total from task start.
      // Approximate: count from activity log how many checks happened for this card
      const cardId = currentTask.cardId as string;
      const checks = (entries as Array<{ category?: string; cardId?: string }>).filter(
        (e) => e.category === "check" && e.cardId === cardId,
      ).length;
      const total = remaining + checks;
      progress = { total, done: checks, pct: total > 0 ? Math.round((checks / total) * 100) : 0 };
    }

    respond(true, {
      currentTask,
      progress,
      entries,
      fetchedAt: Date.now(),
    });
  },
};
