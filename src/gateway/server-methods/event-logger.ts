/**
 * Gateway Event Logger — Zero-Cost Observability
 *
 * Instruments the gateway request pipeline to capture every agent action as structured events.
 * No model calls needed — pure infrastructure logging.
 */
import { getTasksDbWritable, refreshTasksDb } from "./tasks-db.js";

type SqliteDatabase = import("node:sqlite").DatabaseSync;

let schemaInitialized = false;

/**
 * Ensure the events table exists.
 * Called lazily on first event write.
 */
function ensureEventsSchema(db: SqliteDatabase) {
  if (schemaInitialized) return;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT DEFAULT (datetime('now')),
        event_type TEXT NOT NULL,        -- tool_call, session, rpc, message
        event_name TEXT NOT NULL,        -- exec, read, write, connect, etc.
        agent_id TEXT,                   -- which agent (jeeves, ada, etc.)
        instance_id TEXT,                -- which instance (ada_1, ghost_7)
        session_key TEXT,                -- OpenClaw session key
        duration_ms INTEGER,
        status TEXT DEFAULT 'ok',        -- ok, error, timeout
        cost REAL,                       -- token cost if available
        metadata TEXT DEFAULT '{}'       -- JSON: command, file path, etc.
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_key);
    `);
    schemaInitialized = true;
  } catch (err) {
    console.warn("[event-logger] Schema initialization failed:", err);
  }
}

export interface EventLogEntry {
  eventType: "tool_call" | "session" | "rpc" | "message";
  eventName: string;
  agentId?: string;
  instanceId?: string;
  sessionKey?: string;
  durationMs?: number;
  status?: "ok" | "error" | "timeout";
  cost?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Write an event to the events table.
 * Non-blocking, best-effort — failures log warnings but don't throw.
 */
export function logEvent(entry: EventLogEntry): void {
  const db = getTasksDbWritable();
  if (!db) {
    // No database available — skip silently (gateway can run without DB)
    return;
  }

  try {
    ensureEventsSchema(db);

    const metadata = entry.metadata ? JSON.stringify(entry.metadata) : "{}";

    db.prepare(`
      INSERT INTO events (event_type, event_name, agent_id, instance_id, session_key, duration_ms, status, cost, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.eventType,
      entry.eventName,
      entry.agentId ?? null,
      entry.instanceId ?? null,
      entry.sessionKey ?? null,
      entry.durationMs ?? null,
      entry.status ?? "ok",
      entry.cost ?? null,
      metadata,
    );

    db.close();
    refreshTasksDb();
  } catch (err) {
    console.warn("[event-logger] Failed to write event:", err);
  }
}

/**
 * Log a tool call event.
 */
export function logToolCall(params: {
  toolName: string;
  agentId?: string;
  instanceId?: string;
  sessionKey?: string;
  durationMs?: number;
  status?: "ok" | "error" | "timeout";
  cost?: number;
  metadata?: Record<string, unknown>;
}): void {
  logEvent({
    eventType: "tool_call",
    eventName: params.toolName,
    agentId: params.agentId,
    instanceId: params.instanceId,
    sessionKey: params.sessionKey,
    durationMs: params.durationMs,
    status: params.status,
    cost: params.cost,
    metadata: params.metadata,
  });
}

/**
 * Log a session lifecycle event (connect, disconnect, spawn, teardown).
 */
export function logSessionEvent(params: {
  eventName: "connect" | "disconnect" | "spawn" | "teardown";
  agentId?: string;
  instanceId?: string;
  sessionKey?: string;
  metadata?: Record<string, unknown>;
}): void {
  logEvent({
    eventType: "session",
    eventName: params.eventName,
    agentId: params.agentId,
    instanceId: params.instanceId,
    sessionKey: params.sessionKey,
    metadata: params.metadata,
  });
}

/**
 * Log an RPC call.
 */
export function logRPC(params: {
  method: string;
  durationMs?: number;
  status?: "ok" | "error";
  cost?: number;
  metadata?: Record<string, unknown>;
}): void {
  logEvent({
    eventType: "rpc",
    eventName: params.method,
    durationMs: params.durationMs,
    status: params.status,
    cost: params.cost,
    metadata: params.metadata,
  });
}

/**
 * Log a message event (sent/received metadata only — not content for privacy).
 */
export function logMessage(params: {
  eventName: "sent" | "received" | "delivered";
  agentId?: string;
  sessionKey?: string;
  metadata?: Record<string, unknown>;
}): void {
  logEvent({
    eventType: "message",
    eventName: params.eventName,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    metadata: params.metadata,
  });
}
