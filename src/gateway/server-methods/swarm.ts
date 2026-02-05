import fs from "node:fs/promises";
import path from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { DEFAULT_AGENT_WORKSPACE_DIR } from "../../agents/workspace.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { getTasksDb } from "./tasks-db.js";

/**
 * Swarm RPC handlers — expose swarm state to the dashboard.
 *
 * Reads from the tasks.sqlite DB and /tmp/swarm/ directories
 * to provide a real-time view of worker agents.
 */

type SwarmWorker = {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  branch?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  taskSpec?: string | null;
  swarmId: string;
  backend?: string | null;
  logTail?: string | null;
};

type SwarmGroup = {
  id: string;
  repo: string;
  baseBranch: string;
  createdAt: string;
  status: "active" | "completed" | "failed" | "cancelled";
  workers: SwarmWorker[];
};

type SwarmSnapshot = {
  swarms: SwarmGroup[];
  fetchedAt: number;
  hasActiveSwarm: boolean;
  totalWorkers: number;
  activeWorkers: number;
};

type AgentInstance = {
  instance_id: string;
  status: string;
  assigned_task: string | null;
  model: string | null;
  cost: number;
  spawned_at: string;
  torn_down_at: string | null;
  last_active_at: string | null;
};

type SwarmAgentNode = {
  id: string;
  name: string;
  role: string;
  level: string;
  status: "active" | "idle" | "working" | "archived";
  trustScore: number;
  currentTask?: string | null;
  children: SwarmAgentNode[];
  specialty?: string | null;
  emoji?: string | null;
  instances?: AgentInstance[];
  activeCount?: number;
};

type SwarmHierarchy = {
  root: SwarmAgentNode;
  fetchedAt: number;
};

/** Query agent_instances for a given agent, returning recent instances + active count. */
function loadInstances(agentId: string): { instances: AgentInstance[]; activeCount: number } {
  try {
    const db = getTasksDb();
    if (!db) return { instances: [], activeCount: 0 };
    const hasTable =
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_instances'")
          .all() as unknown[]
      ).length > 0;
    if (!hasTable) return { instances: [], activeCount: 0 };
    const rows = db
      .prepare(
        "SELECT instance_id, status, assigned_task, model, cost, spawned_at, torn_down_at, last_active_at FROM agent_instances WHERE agent_id = ? ORDER BY spawned_at DESC LIMIT 10",
      )
      .all(agentId) as AgentInstance[];
    const activeCount = rows.filter((i) => i.status === "running").length;
    return { instances: rows, activeCount };
  } catch {
    return { instances: [], activeCount: 0 };
  }
}

// Read the agents directory structure for hierarchy
async function readAgentProfiles(): Promise<SwarmAgentNode> {
  const agentsDir = path.join(DEFAULT_AGENT_WORKSPACE_DIR, "agents");

  // Load Jeeves profile from performance.json if available
  let jeevesPerf: { trustScore?: number; level?: string; role?: string } = {};
  try {
    const perfRaw = await fs.readFile(path.join(agentsDir, "jeeves", "performance.json"), "utf-8");
    jeevesPerf = JSON.parse(perfRaw);
  } catch {
    // defaults below
  }

  // Check Jeeves's current task from session state
  let jeevesTask: string | null = null;
  try {
    const stateRaw = await fs.readFile(
      path.join(DEFAULT_AGENT_WORKSPACE_DIR, "memory", "session-state.json"),
      "utf-8",
    );
    const state = JSON.parse(stateRaw) as { lastTask?: string; status?: string };
    if (state.status === "working") {
      jeevesTask = state.lastTask ?? null;
    }
  } catch {
    /* no session state */
  }

  const jeevesInstances = loadInstances("jeeves");
  const root: SwarmAgentNode = {
    id: "jeeves",
    name: "Jeeves",
    role: jeevesPerf.role ?? "Manager",
    level: jeevesPerf.level ?? "L3",
    status: jeevesTask ? "working" : "active",
    trustScore: jeevesPerf.trustScore ?? 0.92,
    currentTask: jeevesTask,
    children: [],
    specialty: "Sprint planning · Orchestration · Code review",
    emoji: "🌟",
    instances: jeevesInstances.instances,
    activeCount: jeevesInstances.activeCount,
  };

  // Check for agent profile directories
  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      if (entry.name === "jeeves") continue; // skip root

      const profileDir = path.join(agentsDir, entry.name);
      let soul = "";
      try {
        soul = await fs.readFile(path.join(profileDir, "SOUL.md"), "utf-8");
      } catch {
        // no SOUL.md
      }

      let perf: { trustScore?: number; level?: string; role?: string } = {};
      try {
        const perfRaw = await fs.readFile(path.join(profileDir, "performance.json"), "utf-8");
        perf = JSON.parse(perfRaw);
      } catch {
        // no performance.json
      }

      // Extract name and emoji from SOUL.md
      const soulNameMatch = soul.match(/^#\s+(.+?)(?:\s*—|\s*$)/m);
      const displayName =
        soulNameMatch?.[1] ?? entry.name.charAt(0).toUpperCase() + entry.name.slice(1);
      const emojiMatch = soul.match(/\*\*Emoji:\*\*\s*(\S+)/);
      const emoji = emojiMatch?.[1] ?? null;
      const specialtyMatch = soul.match(/\*\*Specialty:\*\*\s*(.+)/);
      const specialty =
        specialtyMatch?.[1] ??
        soul
          .split("\n")
          .find((l) => l.startsWith("##"))
          ?.replace(/^#+\s*/, "") ??
        null;

      // Check for active cron jobs running as this agent
      let agentStatus: "idle" | "working" | "active" = "idle";
      let currentTask: string | null = null;
      try {
        const cronJobsPath = path.join(
          process.env.HOME ?? "/home/teej",
          ".openclaw",
          "cron",
          "jobs.json",
        );
        const cronRaw = await fs.readFile(cronJobsPath, "utf-8");
        const cronJobs = JSON.parse(cronRaw) as Array<{
          name?: string;
          state?: { lastRunAtMs?: number };
          message?: string;
        }>;
        const recentCutoff = Date.now() - 5 * 60 * 1000; // 5 min
        for (const job of cronJobs) {
          if (
            job.name?.toLowerCase().includes(entry.name) &&
            (job.state?.lastRunAtMs ?? 0) > recentCutoff
          ) {
            agentStatus = "working";
            currentTask = job.message?.slice(0, 100) ?? job.name ?? null;
            break;
          }
        }
      } catch {
        /* no cron data */
      }

      const agentInstances = loadInstances(entry.name);
      root.children.push({
        id: entry.name,
        name: displayName,
        role: perf.role ?? "IC",
        level: perf.level ?? "L1",
        status: agentInstances.activeCount > 0 ? "working" : agentStatus,
        trustScore: perf.trustScore ?? 0.5,
        currentTask,
        children: [],
        specialty,
        emoji,
        instances: agentInstances.instances,
        activeCount: agentInstances.activeCount,
      });
    }
  } catch {
    // No agents directory yet — that's fine
  }

  // Overlay active swarm workers
  try {
    const swarmDir = "/tmp/swarm";
    const swarmEntries = await fs.readdir(swarmDir, { withFileTypes: true });
    for (const entry of swarmEntries) {
      if (!entry.isDirectory()) continue;
      try {
        const statusFile = path.join(swarmDir, entry.name, "status.json");
        const raw = await fs.readFile(statusFile, "utf-8");
        const status = JSON.parse(raw) as {
          tasks?: Array<{ name?: string; status?: string; branch?: string }>;
        };
        for (const task of status.tasks ?? []) {
          if (task.status === "running") {
            const workerId = `swarm-${entry.name}-${task.branch ?? "unknown"}`;
            root.children.push({
              id: workerId,
              name: task.name ?? task.branch ?? "Worker",
              role: "Swarm Worker",
              level: "L1",
              status: "working",
              trustScore: 0.5,
              currentTask: task.name ?? null,
              children: [],
              specialty: "Parallel task execution",
              emoji: "⚡",
            });
          }
        }
      } catch {
        // skip bad swarm dirs
      }
    }
  } catch {
    // /tmp/swarm doesn't exist — no active swarms
  }

  return root;
}

// Read swarm data from /tmp/swarm and tasks.sqlite
async function readSwarmData(): Promise<SwarmSnapshot> {
  const swarms: SwarmGroup[] = [];
  let totalWorkers = 0;
  let activeWorkers = 0;

  // Check /tmp/swarm/ for active swarm directories
  const swarmBase = "/tmp/swarm";
  try {
    const entries = await fs.readdir(swarmBase, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const swarmDir = path.join(swarmBase, entry.name);

      try {
        const statusPath = path.join(swarmDir, "status.json");
        const raw = await fs.readFile(statusPath, "utf-8");
        const status = JSON.parse(raw) as {
          swarm_id?: string;
          repo?: string;
          base_branch?: string;
          created_at?: string;
          tasks?: Array<{
            task_id?: string;
            name?: string;
            status?: string;
            branch?: string;
            started_at?: string;
            completed_at?: string;
            spec?: string;
            backend?: string;
          }>;
        };

        const workers: SwarmWorker[] = (status.tasks ?? []).map((t) => {
          const w: SwarmWorker = {
            id: t.task_id ?? `${entry.name}-${t.branch ?? "unknown"}`,
            name: t.name ?? "Unnamed Task",
            status: (t.status as SwarmWorker["status"]) ?? "pending",
            branch: t.branch ?? null,
            startedAt: t.started_at ?? null,
            completedAt: t.completed_at ?? null,
            taskSpec: t.spec ?? null,
            swarmId: entry.name,
            backend: t.backend ?? null,
          };
          totalWorkers++;
          if (t.status === "running") activeWorkers++;
          return w;
        });

        const hasRunning = workers.some((w) => w.status === "running");
        const hasPending = workers.some((w) => w.status === "pending");
        const allDone = workers.every((w) => w.status === "done" || w.status === "cancelled");
        const hasFailed = workers.some((w) => w.status === "failed");

        swarms.push({
          id: status.swarm_id ?? entry.name,
          repo: status.repo ?? "unknown",
          baseBranch: status.base_branch ?? "main",
          createdAt: status.created_at ?? "",
          status: allDone
            ? "completed"
            : hasFailed
              ? "failed"
              : hasRunning || hasPending
                ? "active"
                : "completed",
          workers,
        });
      } catch {
        // Skip directories without valid status.json
      }
    }
  } catch {
    // /tmp/swarm doesn't exist — no swarms
  }

  return {
    swarms,
    fetchedAt: Date.now(),
    hasActiveSwarm: activeWorkers > 0,
    totalWorkers,
    activeWorkers,
  };
}

export const swarmHandlers: GatewayRequestHandlers = {
  "swarm.list": async ({ respond }) => {
    try {
      const snapshot = await readSwarmData();
      respond(true, snapshot, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "swarm.hierarchy": async ({ respond }) => {
    try {
      const root = await readAgentProfiles();
      respond(true, { root, fetchedAt: Date.now() } as SwarmHierarchy, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "swarm.agentDetail": async ({ params, respond }) => {
    const { agentId } = params as { agentId?: string };
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId required"));
      return;
    }
    // Validate agentId to prevent path traversal
    if (!/^[a-z0-9_-]+$/i.test(agentId)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Invalid agentId"));
      return;
    }
    try {
      const workspaceDir = DEFAULT_AGENT_WORKSPACE_DIR;
      const agentDir = path.join(workspaceDir, "agents", agentId);

      // Load performance.json
      let perf: Record<string, unknown> = {};
      try {
        perf = JSON.parse(await fs.readFile(path.join(agentDir, "performance.json"), "utf-8"));
      } catch {
        /* no performance data */
      }

      // Load permissions.json
      let perms: Record<string, unknown> = {};
      try {
        perms = JSON.parse(await fs.readFile(path.join(agentDir, "permissions.json"), "utf-8"));
      } catch {
        /* no permissions */
      }

      // Load SOUL.md for name extraction
      let soulContent = "";
      try {
        soulContent = await fs.readFile(path.join(agentDir, "SOUL.md"), "utf-8");
      } catch {
        /* no soul */
      }

      const nameMatch = soulContent.match(/^#\s+(.+?)(?:\s*—|\s*$)/m);
      const name = nameMatch?.[1] ?? agentId;
      const specialtyMatch = soulContent.match(/\*\*Specialty:\*\*\s*(.+)/);
      const specialty = specialtyMatch?.[1] ?? null;

      // Get task history from DB
      const recentHistory: Array<{
        task: string;
        status: string;
        cost?: number;
        completedAt?: string;
      }> = [];
      const assignedCards: Array<{ name: string; progress: number; list: string }> = [];
      let totalCost = 0;
      let tasksCompleted = 0;
      let tasksFailed = 0;

      try {
        const db = getTasksDb();
        if (db) {
          // Check if swarm_tasks table exists
          const hasTasks =
            (
              db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='swarm_tasks'")
                .all() as unknown[]
            ).length > 0;
          if (hasTasks) {
            const tasks = db
              .prepare(
                "SELECT name, status, created_at FROM swarm_tasks WHERE name LIKE ? ORDER BY created_at DESC LIMIT 10",
              )
              .all(`%${agentId}%`) as Array<{ name: string; status: string; created_at: string }>;
            for (const t of tasks) {
              recentHistory.push({ task: t.name, status: t.status, completedAt: t.created_at });
              if (t.status === "done") tasksCompleted++;
              if (t.status === "failed") tasksFailed++;
            }
          }

          // Also query audit_log table for more recent activity
          const hasAuditLog =
            (
              db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'")
                .all() as unknown[]
            ).length > 0;
          if (hasAuditLog) {
            const auditEntries = db
              .prepare(
                "SELECT ts, action, target, status, cost FROM audit_log WHERE agent_id = ? OR instance_id LIKE ? ORDER BY id DESC LIMIT 10",
              )
              .all(agentId, `%${agentId}%`) as Array<{
              ts: string;
              action: string;
              target: string | null;
              status: string;
              cost: number | null;
            }>;

            for (const entry of auditEntries) {
              // Add to history if not a duplicate
              const taskDesc = entry.target ? `${entry.action}: ${entry.target}` : entry.action;
              if (!recentHistory.some((h) => h.task === taskDesc)) {
                recentHistory.push({
                  task: taskDesc,
                  status: entry.status,
                  cost: entry.cost ?? undefined,
                  completedAt: entry.ts,
                });
                if (entry.cost) totalCost += entry.cost;
              }
            }

            // Sort by completedAt descending and limit to 10
            recentHistory.sort((a, b) => {
              const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
              const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
              return bTime - aTime;
            });
            if (recentHistory.length > 10) {
              recentHistory.length = 10;
            }
          }
        }
      } catch {
        /* DB not available */
      }

      // Use performance.json data as fallback/primary
      if ((perf as { totalTasks?: number }).totalTasks) {
        tasksCompleted = (perf as { totalTasks: number }).totalTasks;
      }

      const detail = {
        id: agentId,
        name,
        role: String(perms.role ?? "unknown"),
        level: `L${perms.autonomyLevel ?? "?"}`,
        trustScore: Number((perf as { trustScore?: number }).trustScore ?? 0.5),
        status:
          recentHistory.length > 0 && recentHistory[0].status === "running" ? "working" : "idle",
        currentTask: recentHistory.find((h) => h.status === "running")?.task ?? null,
        specialty,
        recentHistory,
        assignedCards,
        totalCost,
        tasksCompleted,
        tasksFailed,
      };

      respond(true, detail);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
