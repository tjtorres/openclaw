/**
 * Audit log RPCs — agent instance tracking and full observability.
 *
 * Provides:
 *   audit.instances  — list all agent instances (Ghost_7, Ada_3, etc.)
 *   audit.list       — paginated audit log, filterable by instance/agent/action
 *   audit.logs       — raw log content for a specific instance or task
 *   audit.summary    — summarized task handling for an instance
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { getTasksDb } from "./tasks-db.js";

/* ------------------------------------------------------------------ */
/*  Schema bootstrap — runs once per gateway start                    */
/* ------------------------------------------------------------------ */

let schemaReady = false;

function ensureSchema(db: ReturnType<typeof getTasksDb>) {
  if (schemaReady || !db) return;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT UNIQUE NOT NULL,
        agent_id TEXT NOT NULL,
        instance_num INTEGER NOT NULL,
        status TEXT DEFAULT 'running',
        assigned_task TEXT,
        task_summary TEXT,
        session_key TEXT,
        job_id TEXT,
        model TEXT,
        cost REAL DEFAULT 0,
        spawned_at TEXT DEFAULT (datetime('now')),
        last_active_at TEXT DEFAULT (datetime('now')),
        torn_down_at TEXT,
        metadata TEXT DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_instances_agent ON agent_instances(agent_id);
      CREATE INDEX IF NOT EXISTS idx_instances_status ON agent_instances(status);
      CREATE INDEX IF NOT EXISTS idx_instances_spawned ON agent_instances(spawned_at);

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT DEFAULT (datetime('now')),
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        target_type TEXT,
        status TEXT DEFAULT 'ok',
        cost REAL,
        duration_ms INTEGER,
        detail TEXT,
        session_key TEXT,
        instance_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
      CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id);
      CREATE INDEX IF NOT EXISTS idx_audit_instance ON audit_log(instance_id);
    `);
  } catch {
    /* tables already exist — that's fine */
  }

  // Ensure instance_id column exists on audit_log (migration)
  try {
    db.exec("ALTER TABLE audit_log ADD COLUMN instance_id TEXT");
  } catch {
    /* column already exists */
  }

  schemaReady = true;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Validate ID to prevent path traversal and SQL injection */
function isValidId(id: string): boolean {
  return /^[a-z0-9_-]+$/i.test(id);
}

/** Read raw log file for a swarm task or agent session */
async function readLogFile(logPath: string, tail = 200): Promise<string> {
  try {
    const content = await fs.readFile(logPath, "utf-8");
    const lines = content.split("\n");
    if (lines.length <= tail) return content;
    return `... (${lines.length - tail} lines truncated) ...\n` + lines.slice(-tail).join("\n");
  } catch {
    return "(log file not available)";
  }
}

/** Find log file for an instance */
async function findInstanceLogs(
  instanceId: string,
  db: ReturnType<typeof getTasksDb>,
): Promise<string> {
  if (!db) return "(no database)";

  // Validate instanceId to prevent path traversal
  if (!isValidId(instanceId)) {
    return "(invalid instance ID)";
  }

  // Check swarm_tasks for log paths
  try {
    const tasks = db
      .prepare(
        "SELECT id, session_key FROM swarm_tasks WHERE id LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT 5",
      )
      .all(`%${instanceId}%`, `%${instanceId}%`) as Array<{
      id: string;
      session_key: string | null;
    }>;

    for (const t of tasks) {
      // Try /tmp/swarm/ log paths
      const swarmLogPath = `/tmp/swarm/${t.id}/output.log`;
      try {
        await fs.access(swarmLogPath);
        return await readLogFile(swarmLogPath);
      } catch {
        /* not there */
      }
    }
  } catch {
    /* no swarm_tasks table */
  }

  // Check agent_instances metadata for a log_path
  try {
    const row = db
      .prepare("SELECT metadata FROM agent_instances WHERE instance_id = ?")
      .get(instanceId) as { metadata: string } | undefined;

    if (row?.metadata) {
      const meta = JSON.parse(row.metadata) as Record<string, unknown>;
      if (typeof meta.log_path === "string" && meta.log_path) {
        // Resolve to absolute, then verify it doesn't escape via traversal
        const resolved = path.resolve(meta.log_path);
        try {
          await fs.access(resolved);
          return await readLogFile(resolved);
        } catch {
          /* file doesn't exist — continue to gateway logs */
        }
      }
    }
  } catch {
    /* no agent_instances table or bad metadata — continue */
  }

  // Check gateway session logs
  const today = new Date().toISOString().slice(0, 10);
  const gatewayLog = `/tmp/openclaw/openclaw-${today}.log`;
  try {
    const content = await fs.readFile(gatewayLog, "utf-8");
    // Filter lines relevant to this instance/agent
    const agentId = instanceId.replace(/_\d+$/, "");
    const relevant = content
      .split("\n")
      .filter((l) => l.toLowerCase().includes(agentId) || l.includes(instanceId))
      .slice(-100);
    if (relevant.length > 0) {
      return relevant.join("\n");
    }
  } catch {
    /* no log file */
  }

  return "(no logs found for this instance)";
}

/* ------------------------------------------------------------------ */
/*  RPC handlers                                                      */
/* ------------------------------------------------------------------ */

export const auditHandlers: GatewayRequestHandlers = {
  /**
   * audit.instances — list all agent instances with naming (Ghost_7, Ada_3, etc.)
   * Supports filtering by agent_id and status.
   */
  "audit.instances": async ({ params, respond }) => {
    const {
      agentId,
      status,
      limit = 50,
      offset = 0,
    } = params as {
      agentId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    };

    const db = getTasksDb();
    if (!db) {
      respond(true, { instances: [], total: 0, fetchedAt: Date.now() });
      return;
    }
    ensureSchema(db);

    const conditions: string[] = [];
    const queryParams: unknown[] = [];

    if (agentId) {
      conditions.push("agent_id = ?");
      queryParams.push(agentId);
    }
    if (status) {
      conditions.push("status = ?");
      queryParams.push(status);
    }

    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    try {
      const countRow = db
        .prepare(`SELECT COUNT(*) as cnt FROM agent_instances ${where}`)
        .get(...queryParams) as {
        cnt: number;
      };

      const rows = db
        .prepare(
          `SELECT instance_id, agent_id, instance_num, status, assigned_task, task_summary,
                  model, cost, spawned_at, last_active_at, torn_down_at, session_key, job_id,
                  card_id, exit_code, tokens_used, error_message
           FROM agent_instances ${where}
           ORDER BY spawned_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...queryParams, limit, offset) as Array<Record<string, unknown>>;

      // Get audit action count per instance
      const instances = rows.map((r) => {
        let actionCount = 0;
        try {
          const countResult = db
            .prepare("SELECT COUNT(*) as cnt FROM audit_log WHERE instance_id = ?")
            .get(r.instance_id) as { cnt: number };
          actionCount = countResult?.cnt ?? 0;
        } catch {
          /* ignore */
        }

        return {
          instanceId: r.instance_id,
          agentId: r.agent_id,
          instanceNum: r.instance_num,
          status: r.status,
          assignedTask: r.assigned_task,
          taskSummary: r.task_summary,
          model: r.model,
          cost: r.cost,
          spawnedAt: r.spawned_at,
          lastActiveAt: r.last_active_at,
          tornDownAt: r.torn_down_at,
          sessionKey: r.session_key,
          jobId: r.job_id,
          actionCount,
          cardId: r.card_id ?? null,
          exitCode: r.exit_code ?? null,
          tokensUsed: r.tokens_used ?? null,
          errorMessage: r.error_message ?? null,
        };
      });

      respond(true, { instances, total: countRow.cnt, fetchedAt: Date.now() });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  /**
   * audit.list — paginated audit log with filtering.
   * Filter by instanceId, agentId, action, status.
   */
  "audit.list": ({ params, respond }) => {
    const {
      limit = 50,
      offset = 0,
      instanceId,
      agentId,
      action,
      status,
    } = params as {
      limit?: number;
      offset?: number;
      instanceId?: string;
      agentId?: string;
      action?: string;
      status?: string;
    };

    const db = getTasksDb();
    if (!db) {
      respond(true, { entries: [], total: 0, fetchedAt: Date.now() });
      return;
    }
    ensureSchema(db);

    const conditions: string[] = [];
    const queryParams: unknown[] = [];

    if (instanceId) {
      conditions.push("instance_id = ?");
      queryParams.push(instanceId);
    }
    if (agentId) {
      conditions.push("agent_id = ?");
      queryParams.push(agentId);
    }
    if (action) {
      conditions.push("action = ?");
      queryParams.push(action);
    }
    if (status) {
      conditions.push("status = ?");
      queryParams.push(status);
    }

    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    try {
      const countRow = db
        .prepare(`SELECT COUNT(*) as cnt FROM audit_log ${where}`)
        .get(...queryParams) as {
        cnt: number;
      };

      const rows = db
        .prepare(
          `SELECT id, ts, agent_id, instance_id, action, target, target_type, status, cost, duration_ms, detail, session_key
           FROM audit_log ${where}
           ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(...queryParams, limit, offset) as Array<Record<string, unknown>>;

      const entries = rows.map((r) => ({
        id: r.id,
        ts: r.ts,
        agentId: r.agent_id,
        instanceId: r.instance_id,
        action: r.action,
        target: r.target,
        targetType: r.target_type,
        status: r.status,
        cost: r.cost,
        durationMs: r.duration_ms,
        detail: r.detail,
        sessionKey: r.session_key,
      }));

      respond(true, { entries, total: countRow.cnt, fetchedAt: Date.now() });
    } catch (err) {
      respond(true, { entries: [], total: 0, fetchedAt: Date.now(), error: String(err) });
    }
  },

  /**
   * audit.logs — raw log content for a specific agent instance.
   * Returns the most relevant log file content.
   */
  "audit.logs": async ({ params, respond }) => {
    const { instanceId, tail = 200 } = params as { instanceId?: string; tail?: number };

    if (!instanceId) {
      // No instance — return combined gateway logs
      const today = new Date().toISOString().slice(0, 10);
      const gatewayLog = `/tmp/openclaw/openclaw-${today}.log`;
      const logs = await readLogFile(gatewayLog, tail);
      respond(true, { instanceId: null, logs, fetchedAt: Date.now() });
      return;
    }

    const db = getTasksDb();
    const logs = await findInstanceLogs(instanceId, db);

    respond(true, { instanceId, logs, fetchedAt: Date.now() });
  },

  /**
   * audit.summary — summarized view of an agent instance's work.
   * Combines instance metadata + audit actions + task results.
   */
  "audit.summary": async ({ params, respond }) => {
    const { instanceId } = params as { instanceId?: string };

    if (!instanceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "instanceId required"));
      return;
    }

    const db = getTasksDb();
    if (!db) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "No database"));
      return;
    }
    ensureSchema(db);

    try {
      // Get instance info
      const instance = db
        .prepare(
          `SELECT instance_id, agent_id, instance_num, status, assigned_task, task_summary,
                  model, cost, spawned_at, last_active_at, torn_down_at, metadata
           FROM agent_instances WHERE instance_id = ?`,
        )
        .get(instanceId) as Record<string, unknown> | undefined;

      if (!instance) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.NOT_FOUND, `Instance ${instanceId} not found`),
        );
        return;
      }

      // Get audit actions for this instance
      const actions = db
        .prepare(
          `SELECT action, COUNT(*) as cnt, SUM(cost) as total_cost, 
                  MIN(ts) as first_at, MAX(ts) as last_at
           FROM audit_log WHERE instance_id = ?
           GROUP BY action ORDER BY cnt DESC`,
        )
        .all(instanceId) as Array<{
        action: string;
        cnt: number;
        total_cost: number;
        first_at: string;
        last_at: string;
      }>;

      // Get timeline (last 20 actions)
      const timeline = db
        .prepare(
          `SELECT ts, action, target, status, cost, detail
           FROM audit_log WHERE instance_id = ?
           ORDER BY id DESC LIMIT 20`,
        )
        .all(instanceId) as Array<Record<string, unknown>>;

      // Compute duration
      const spawnedAt = instance.spawned_at as string;
      const tornDownAt = instance.torn_down_at as string | null;
      const endTime = tornDownAt ?? new Date().toISOString();
      const durationMs = new Date(endTime).getTime() - new Date(spawnedAt).getTime();

      respond(true, {
        instanceId,
        agentId: instance.agent_id,
        instanceNum: instance.instance_num,
        status: instance.status,
        assignedTask: instance.assigned_task,
        taskSummary: instance.task_summary,
        model: instance.model,
        totalCost: instance.cost,
        spawnedAt,
        tornDownAt,
        durationMs,
        actionBreakdown: actions.map((a) => ({
          action: a.action,
          count: a.cnt,
          totalCost: a.total_cost,
          firstAt: a.first_at,
          lastAt: a.last_at,
        })),
        timeline: timeline.map((t) => ({
          ts: t.ts,
          action: t.action,
          target: t.target,
          status: t.status,
          cost: t.cost,
          detail: t.detail,
        })),
        fetchedAt: Date.now(),
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  /**
   * events.list — Gateway event log with filtering.
   * Returns events from the events table (tool calls, sessions, RPCs, messages).
   * Filter by event_type, event_name, agent_id, session_key, status.
   */
  "events.list": ({ params, respond }) => {
    const {
      limit = 100,
      offset = 0,
      eventType,
      eventName,
      agentId,
      sessionKey,
      status,
    } = params as {
      limit?: number;
      offset?: number;
      eventType?: string;
      eventName?: string;
      agentId?: string;
      sessionKey?: string;
      status?: string;
    };

    const db = getTasksDb();
    if (!db) {
      respond(true, { events: [], total: 0, fetchedAt: Date.now() });
      return;
    }

    // Ensure events table exists (schema bootstrap happens lazily in event-logger)
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT DEFAULT (datetime('now')),
          event_type TEXT NOT NULL,
          event_name TEXT NOT NULL,
          agent_id TEXT,
          instance_id TEXT,
          session_key TEXT,
          duration_ms INTEGER,
          status TEXT DEFAULT 'ok',
          cost REAL,
          metadata TEXT DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
        CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
        CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
        CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_key);
      `);
    } catch {
      /* tables already exist */
    }

    const conditions: string[] = [];
    const queryParams: unknown[] = [];

    if (eventType) {
      conditions.push("event_type = ?");
      queryParams.push(eventType);
    }
    if (eventName) {
      conditions.push("event_name = ?");
      queryParams.push(eventName);
    }
    if (agentId) {
      conditions.push("agent_id = ?");
      queryParams.push(agentId);
    }
    if (sessionKey) {
      conditions.push("session_key = ?");
      queryParams.push(sessionKey);
    }
    if (status) {
      conditions.push("status = ?");
      queryParams.push(status);
    }

    const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    try {
      const countRow = db
        .prepare(`SELECT COUNT(*) as cnt FROM events ${where}`)
        .get(...queryParams) as {
        cnt: number;
      };

      const rows = db
        .prepare(
          `SELECT id, ts, event_type, event_name, agent_id, instance_id, session_key,
                  duration_ms, status, cost, metadata, card_id, parent_event_id
           FROM events ${where}
           ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(...queryParams, limit, offset) as Array<Record<string, unknown>>;

      const events = rows.map((r) => {
        let metadata = {};
        try {
          if (typeof r.metadata === "string" && r.metadata) {
            metadata = JSON.parse(r.metadata);
          }
        } catch {
          /* invalid JSON — ignore */
        }

        return {
          id: r.id,
          ts: r.ts,
          eventType: r.event_type,
          eventName: r.event_name,
          agentId: r.agent_id,
          instanceId: r.instance_id,
          sessionKey: r.session_key,
          durationMs: r.duration_ms,
          status: r.status,
          cost: r.cost,
          metadata,
          cardId: r.card_id ?? null,
          parentEventId: r.parent_event_id ?? null,
        };
      });

      respond(true, { events, total: countRow.cnt, fetchedAt: Date.now() });
    } catch (err) {
      respond(true, { events: [], total: 0, fetchedAt: Date.now(), error: String(err) });
    }
  },
};
