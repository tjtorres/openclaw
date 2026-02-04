/**
 * Swarm status RPC — live view of parallel agent workers.
 */
import type { GatewayRequestHandlers } from "./types.js";
import { getTasksDb } from "./tasks-db.js";

export type SwarmWorker = {
  id: string;
  swarmId: string;
  name: string;
  status: "running" | "done" | "failed";
  worktreePath: string;
  startedAt: string | null;
  elapsedMs: number;
};

export type SwarmStatusResult = {
  activeSwarms: Array<{
    swarmId: string;
    workers: SwarmWorker[];
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    runningTasks: number;
  }>;
  hasActive: boolean;
  fetchedAt: number;
};

export const swarmStatusHandlers: GatewayRequestHandlers = {
  "swarm.status": ({ respond }) => {
    const db = getTasksDb();
    if (!db) {
      respond(true, { activeSwarms: [], hasActive: false, fetchedAt: Date.now() });
      return;
    }

    // Check if swarm_tasks table exists
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='swarm_tasks'"
    ).all();
    if (tableExists.length === 0) {
      respond(true, { activeSwarms: [], hasActive: false, fetchedAt: Date.now() });
      return;
    }

    // Get all tasks from swarms that have at least one running task
    const activeSwarmIds = db.prepare(
      "SELECT DISTINCT swarm_id FROM swarm_tasks WHERE status='running'"
    ).all() as Array<{ swarm_id: string }>;

    const activeSwarms = activeSwarmIds.map(({ swarm_id }) => {
      const tasks = db.prepare(
        "SELECT id, swarm_id, name, status, worktree_path, created_at FROM swarm_tasks WHERE swarm_id=?"
      ).all(swarm_id) as Array<{
        id: string; swarm_id: string; name: string; status: string;
        worktree_path: string; created_at: string;
      }>;

      const now = Date.now();
      const workers: SwarmWorker[] = tasks.map((t) => ({
        id: t.id,
        swarmId: t.swarm_id,
        name: t.name,
        status: t.status as "running" | "done" | "failed",
        worktreePath: t.worktree_path,
        startedAt: t.created_at,
        elapsedMs: t.created_at ? now - new Date(t.created_at).getTime() : 0,
      }));

      return {
        swarmId: swarm_id,
        workers,
        totalTasks: tasks.length,
        completedTasks: tasks.filter((t) => t.status === "done").length,
        failedTasks: tasks.filter((t) => t.status === "failed").length,
        runningTasks: tasks.filter((t) => t.status === "running").length,
      };
    });

    respond(true, {
      activeSwarms,
      hasActive: activeSwarms.length > 0,
      fetchedAt: Date.now(),
    });
  },
};
