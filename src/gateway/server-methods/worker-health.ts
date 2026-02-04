/**
 * Worker Health Monitoring System
 *
 * Tier 1 (always on, free): Hang detection — no tool calls in 5 min = flagged
 * Tier 2 (always on, free): Per-worker cost cap — set at spawn based on task size
 * Tier 3 (reactive, pennies): Haiku health check — if hang detected, cheap model judges stuck vs thinking (TODO)
 * Tier 4 (Jeeves oversight): Heartbeat-based monitoring of active workers
 */
import { getTasksDbWritable, refreshTasksDb } from "./tasks-db.js";
import type { GatewayRequestHandlers } from "./types.js";

type SqliteDatabase = import("node:sqlite").DatabaseSync;

let budgetSchemaInitialized = false;

/**
 * Ensure the worker_budgets table exists.
 */
function ensureBudgetSchema(db: SqliteDatabase) {
  if (budgetSchemaInitialized) return;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS worker_budgets (
        session_key TEXT PRIMARY KEY,
        agent_id TEXT,
        budget REAL NOT NULL,
        spent REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_worker_budgets_agent ON worker_budgets(agent_id);
    `);
    budgetSchemaInitialized = true;
  } catch (err) {
    console.warn("[worker-health] Budget schema initialization failed:", err);
  }
}

export interface WorkerHealthStatus {
  sessionKey: string;
  agentId: string | null;
  status: "healthy" | "hung" | "over_budget" | "uncertain";
  lastToolCallAt: string | null;
  costSpent: number;
  costBudget: number;
  healthAssessment: string | null;
}

/**
 * Tier 1: Hang detection — query events table for sessions with no tool_call in last 5 minutes
 */
function detectHangs(db: SqliteDatabase): Map<string, { agentId: string | null; lastToolCallAt: string | null }> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // Get all sessions with tool calls
  const rows = db.prepare(`
    SELECT 
      session_key,
      agent_id,
      MAX(ts) as last_tool_call_at
    FROM events
    WHERE event_type = 'tool_call'
      AND session_key IS NOT NULL
    GROUP BY session_key
  `).all() as Array<{ session_key: string; agent_id: string | null; last_tool_call_at: string }>;

  const hangs = new Map<string, { agentId: string | null; lastToolCallAt: string | null }>();

  for (const row of rows) {
    // Only flag as hung if last tool call was >5 min ago
    if (row.last_tool_call_at < fiveMinutesAgo) {
      hangs.set(row.session_key, {
        agentId: row.agent_id,
        lastToolCallAt: row.last_tool_call_at,
      });
    }
  }

  return hangs;
}

/**
 * Tier 2: Get worker budgets from database
 */
function getWorkerBudgets(db: SqliteDatabase): Map<string, { agentId: string; budget: number; spent: number }> {
  ensureBudgetSchema(db);

  const rows = db.prepare(`
    SELECT session_key, agent_id, budget, spent
    FROM worker_budgets
  `).all() as Array<{ session_key: string; agent_id: string; budget: number; spent: number }>;

  const budgets = new Map<string, { agentId: string; budget: number; spent: number }>();

  for (const row of rows) {
    budgets.set(row.session_key, {
      agentId: row.agent_id,
      budget: row.budget,
      spent: row.spent,
    });
  }

  return budgets;
}

/**
 * Tier 3: Haiku health check — use cheap model to judge if worker is stuck
 */
async function runHaikuHealthCheck(
  db: SqliteDatabase,
  sessionKey: string,
  agentId: string | null,
): Promise<{ status: "healthy" | "stuck" | "uncertain"; assessment: string }> {
  try {
    // Get last 5 tool calls for this session
    const toolCalls = db.prepare(`
      SELECT event_name, ts, status, metadata
      FROM events
      WHERE session_key = ? AND event_type = 'tool_call'
      ORDER BY ts DESC
      LIMIT 5
    `).all(sessionKey) as Array<{
      event_name: string;
      ts: string;
      status: string;
      metadata: string;
    }>;

    if (toolCalls.length === 0) {
      return { status: "uncertain", assessment: "No tool calls found" };
    }

    // Build context for the health check
    const toolSummary = toolCalls
      .reverse()
      .map((t, i) => {
        const meta = JSON.parse(t.metadata || "{}");
        return `${i + 1}. ${t.event_name} (${t.status}) at ${t.ts}${
          meta.command ? ` - ${meta.command}` : ""
        }${meta.file_path ? ` - ${meta.file_path}` : ""}`;
      })
      .join("\n");

    const prompt = `You are monitoring an AI worker agent. Review the last 5 tool calls and assess if the worker appears stuck in a loop or making progress.

Last 5 tool calls:
${toolSummary}

Agent: ${agentId || "unknown"}
Session: ${sessionKey}

Respond with ONE of:
- HEALTHY: Making normal progress
- STUCK: Appears to be in a loop or repeatedly failing the same operation
- UNCERTAIN: Not enough information to determine

Then explain briefly (1 sentence).`;

    // Make a cheap Haiku call to assess
    const response = await fetch("http://localhost:18789/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN || ""}`,
      },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-3",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      return { status: "uncertain", assessment: "Haiku call failed: " + response.statusText };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content || "";

    // Parse response
    const statusMatch = content.match(/^(HEALTHY|STUCK|UNCERTAIN)/i);
    if (!statusMatch) {
      return { status: "uncertain", assessment: content.slice(0, 100) };
    }

    const detectedStatus = statusMatch[1].toLowerCase() as "healthy" | "stuck" | "uncertain";
    return { status: detectedStatus, assessment: content };
  } catch (err) {
    return { status: "uncertain", assessment: "Haiku check error: " + String(err) };
  }
}

/**
 * RPC: worker.health
 * Returns health status for all active worker sessions
 */
export async function workerHealth(): Promise<WorkerHealthStatus[]> {
  const db = getTasksDbWritable();
  if (!db) {
    return [];
  }

  try {
    const hangs = detectHangs(db);
    const budgets = getWorkerBudgets(db);

    // Get all unique sessions from both maps
    const allSessions = new Set([...hangs.keys(), ...budgets.keys()]);

    const statuses: WorkerHealthStatus[] = [];

    for (const sessionKey of allSessions) {
      const hang = hangs.get(sessionKey);
      const budget = budgets.get(sessionKey);

      const isHung = hang !== undefined;
      const isOverBudget = budget && budget.spent >= budget.budget;

      let status: WorkerHealthStatus["status"] = "healthy";
      let healthAssessment: string | null = null;

      // Tier 2: Check budget first (cheaper than Haiku call)
      if (isOverBudget) {
        status = "over_budget";
        healthAssessment = `Budget exceeded: $${budget!.spent.toFixed(3)} / $${budget!.budget.toFixed(3)}`;
      } 
      // Tier 1: Check for hang
      else if (isHung) {
        // Tier 3: Run Haiku health check for hung workers
        const haikuResult = await runHaikuHealthCheck(db, sessionKey, hang!.agentId);
        status = haikuResult.status;
        healthAssessment = haikuResult.assessment;
      }

      statuses.push({
        sessionKey,
        agentId: budget?.agentId ?? hang?.agentId ?? null,
        status,
        lastToolCallAt: hang?.lastToolCallAt ?? null,
        costSpent: budget?.spent ?? 0,
        costBudget: budget?.budget ?? 0,
        healthAssessment,
      });
    }

    return statuses;
  } finally {
    db.close();
    refreshTasksDb();
  }
}

/**
 * Set budget for a worker session
 */
export function setWorkerBudget(sessionKey: string, agentId: string, budget: number): void {
  const db = getTasksDbWritable();
  if (!db) return;

  try {
    ensureBudgetSchema(db);

    db.prepare(`
      INSERT INTO worker_budgets (session_key, agent_id, budget, spent)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(session_key) DO UPDATE SET
        budget = excluded.budget,
        agent_id = excluded.agent_id
    `).run(sessionKey, agentId, budget);
  } finally {
    db.close();
    refreshTasksDb();
  }
}

/**
 * Update spent amount for a worker session
 */
export function updateWorkerSpent(sessionKey: string, additionalCost: number): void {
  const db = getTasksDbWritable();
  if (!db) return;

  try {
    ensureBudgetSchema(db);

    db.prepare(`
      UPDATE worker_budgets
      SET spent = spent + ?
      WHERE session_key = ?
    `).run(additionalCost, sessionKey);
  } finally {
    db.close();
    refreshTasksDb();
  }
}

/**
 * Gateway RPC handlers
 */
export const workerHealthHandlers: GatewayRequestHandlers = {
  "worker.health": async ({ respond }) => {
    try {
      const statuses = await workerHealth();
      respond(true, statuses);
    } catch (err) {
      respond(false, undefined, { code: "INTERNAL_ERROR", message: String(err) });
    }
  },
};
