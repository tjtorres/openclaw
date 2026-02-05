# Observability RPC Audit

**Date:** 2026-02-05
**Branch:** feature/task-queue-ui
**DB:** ~/.openclaw/workspace/tasks.sqlite

## Data Summary

| Table           | Rows | Notes                                                           |
| --------------- | ---- | --------------------------------------------------------------- |
| agent_instances | 15   | Backfilled — 5 agents (ada, crash, ghost, jeeves, worker)       |
| audit_log       | 25   | Backfilled — all have instance_id, 11 have session_key          |
| events          | 295  | Mostly tool_call type. Only 4 have agent_id, 0 have instance_id |
| sessions        | 6    | Backfilled — NOT used by sessions RPCs (they use JSON store)    |
| agents          | 3    | Backfilled agent profiles                                       |
| worker_budgets  | 2    | Test data                                                       |

---

## RPC Handler Audit

### 1. `audit.instances`

- **File:** `src/gateway/server-methods/audit.ts:161`
- **SQL:**
  ```sql
  SELECT instance_id, agent_id, instance_num, status, assigned_task, task_summary,
         model, cost, spawned_at, last_active_at, torn_down_at, session_key, job_id
  FROM agent_instances [WHERE ...] ORDER BY spawned_at DESC LIMIT ? OFFSET ?
  ```
- **Response shape:** `{ instances: AuditInstance[], total: number, fetchedAt: number }`
- **UI type match:** AuditInstance matches the response fields.
- **Issues:**
  - **MISSING COLUMNS:** DB has `card_id`, `exit_code`, `tokens_used`, `error_message` (added by migration). These are not SELECTed or returned. The UI can't show task card links or error details.
  - **STATUS VALUES:** DB contains `completed`, `done`, `failed`, `running`. The `done` vs `completed` inconsistency is a data issue, not an RPC bug.
- **Verdict:** Works but missing useful columns. **FIX APPLIED.**

### 2. `audit.list`

- **File:** `src/gateway/server-methods/audit.ts:244`
- **SQL:**
  ```sql
  SELECT id, ts, agent_id, instance_id, action, target, target_type, status, cost,
         duration_ms, detail, session_key
  FROM audit_log [WHERE ...] ORDER BY id DESC LIMIT ? OFFSET ?
  ```
- **Response shape:** `{ entries: AuditEntry[], total: number, fetchedAt: number }`
- **UI type match:** AuditEntry matches exactly.
- **Issues:** None. All columns in DB match the SELECT. instance_id column exists.
- **Verdict:** WORKS CORRECTLY.

### 3. `audit.logs`

- **File:** `src/gateway/server-methods/audit.ts:321`
- **SQL:** None — reads log files from `/tmp/swarm/` and `/tmp/openclaw/`.
- **Response shape:** `{ instanceId: string|null, logs: string, fetchedAt: number }`
- **Issues:** Depends on log files existing on disk. No DB issues.
- **Verdict:** WORKS CORRECTLY (data availability depends on filesystem).

### 4. `audit.summary`

- **File:** `src/gateway/server-methods/audit.ts:343`
- **SQL:**
  ```sql
  -- Instance lookup
  SELECT ... FROM agent_instances WHERE instance_id = ?
  -- Action breakdown
  SELECT action, COUNT(*), SUM(cost), MIN(ts), MAX(ts)
  FROM audit_log WHERE instance_id = ? GROUP BY action
  -- Timeline
  SELECT ts, action, target, status, cost, detail
  FROM audit_log WHERE instance_id = ? ORDER BY id DESC LIMIT 20
  ```
- **Response shape:** `AuditSummary` with `actionBreakdown[]` and `timeline[]`.
- **UI type match:** AuditSummary matches exactly.
- **Issues:** None found. All queries use correct column names.
- **Verdict:** WORKS CORRECTLY.

### 5. `events.list`

- **File:** `src/gateway/server-methods/audit.ts:437`
- **SQL:**
  ```sql
  SELECT id, ts, event_type, event_name, agent_id, instance_id, session_key,
         duration_ms, status, cost, metadata
  FROM events [WHERE ...] ORDER BY id DESC LIMIT ? OFFSET ?
  ```
- **Response shape:** `{ events: EventRow[], total: number, fetchedAt: number }`
- **Issues:**
  - **MISSING COLUMNS:** DB has `card_id` and `parent_event_id` (added by migration). Not SELECTed.
  - **DATA QUALITY:** 295 events, but only 4 have `agent_id` populated, 0 have `instance_id`. Filtering by agent or instance returns near-empty results. This is a data-generation issue in `event-logger.ts` — the caller must pass these values.
- **Verdict:** Query works but misses migration columns. **FIX APPLIED.**

### 6. `swarm.list`

- **File:** `src/gateway/server-methods/swarm.ts:330`
- **SQL:** None — reads from `/tmp/swarm/*/status.json` files.
- **Response shape:** `SwarmSnapshot { swarms: SwarmGroup[], fetchedAt, hasActiveSwarm, totalWorkers, activeWorkers }`
- **UI type match:** SwarmSnapshot/SwarmGroup/SwarmWorker types match.
- **Issues:** None. Pure filesystem read.
- **Verdict:** WORKS CORRECTLY.

### 7. `swarm.hierarchy`

- **File:** `src/gateway/server-methods/swarm.ts:338`
- **SQL (indirect via `loadInstances`):**
  ```sql
  SELECT instance_id, status, assigned_task, model, cost, spawned_at, torn_down_at, last_active_at
  FROM agent_instances WHERE agent_id = ? ORDER BY spawned_at DESC LIMIT 10
  ```
- **Response shape:** `SwarmHierarchy { root: SwarmAgentNode, fetchedAt }`
- **Issues:**
  - Uses `getTasksDb()` (node:sqlite) correctly via `loadInstances()`.
  - Reads agent profiles from filesystem + cron jobs.
  - `loadInstances` correctly checks for table existence before querying.
- **Verdict:** WORKS CORRECTLY.

### 8. `swarm.agentDetail`

- **File:** `src/gateway/server-methods/swarm.ts:347`
- **SQL:**
  ```sql
  -- Via better-sqlite3 (BUG)
  SELECT name, status, created_at FROM swarm_tasks WHERE name LIKE ? ORDER BY created_at DESC LIMIT 10
  SELECT ts, action, target, status, cost FROM audit_log WHERE agent_id = ? OR instance_id LIKE ?
  ```
- **Response shape:** `AgentDetail { id, name, role, level, trustScore, recentHistory[], ... }`
- **Issues:**
  - **BUG: Uses `better-sqlite3` which is NOT installed.** Line 394 does `import("better-sqlite3")` — this will throw, and the entire DB section is silently caught. The handler returns an AgentDetail with empty `recentHistory`, `totalCost: 0`, etc.
  - Should use `getTasksDb()` (node:sqlite) like every other handler.
- **Verdict:** DB queries silently fail. **FIX APPLIED.**

### 9. `worker.health`

- **File:** `src/gateway/server-methods/worker-health.ts:302`
- **SQL (via `detectHangs` and `getWorkerBudgets`):**

  ```sql
  SELECT session_key, agent_id, MAX(ts) as last_tool_call_at
  FROM events WHERE event_type = 'tool_call' AND session_key IS NOT NULL GROUP BY session_key

  SELECT session_key, agent_id, budget, spent FROM worker_budgets
  ```

- **Response shape:** `WorkerHealthStatus[]`
- **Issues:**
  - Uses `getTasksDbWritable()` which is `node:sqlite` writable — correct.
  - Queries are valid against actual schema.
  - Only 4 events have session_key, so hang detection has limited coverage.
- **Verdict:** WORKS CORRECTLY (limited by event data quality).

### 10. `sessions.list` / `sessions.patch` / `sessions.delete`

- **File:** `src/gateway/server-methods/sessions.ts:42-471`
- **SQL:** None — reads/writes JSON session store files, NOT the `sessions` DB table.
- **Response shape:** `SessionsListResult { ts, path, count, defaults, sessions: GatewaySessionRow[] }`
- **Issues:**
  - The DB `sessions` table (6 rows, created by backfill migration) is **completely separate** from the sessions RPCs. The RPCs use JSON session stores on disk.
  - This is by design — the `sessions` DB table is for observability correlation, not for session management.
  - The sessions tab in the UI works correctly via the JSON store.
- **Verdict:** WORKS CORRECTLY. DB `sessions` table is an observability artifact, not an RPC data source.

---

## Issues Fixed

### Fix 1: `swarm.agentDetail` — replace better-sqlite3 with getTasksDb()

- **Problem:** Dynamic import of `better-sqlite3` fails (not installed), causing all DB queries to silently fail.
- **Fix:** Rewrite DB section to use `getTasksDb()` (node:sqlite) consistent with all other handlers.
- **File:** `src/gateway/server-methods/swarm.ts`

### Fix 2: `audit.instances` — add missing columns

- **Problem:** `card_id`, `exit_code`, `tokens_used`, `error_message` columns not SELECTed.
- **Fix:** Add these columns to SELECT and response mapping.
- **File:** `src/gateway/server-methods/audit.ts`

### Fix 3: `events.list` — add missing columns

- **Problem:** `card_id` and `parent_event_id` columns not SELECTed.
- **Fix:** Add these columns to SELECT and response mapping.
- **File:** `src/gateway/server-methods/audit.ts`

---

## Known Data Quality Issues (not code bugs)

1. **events.agent_id mostly NULL** — 291/295 events have no agent_id. The `logEvent()` function accepts `agentId` but callers rarely pass it. Fix: instrument callers to pass agent context.
2. **events.instance_id always NULL** — 0/295 events have instance_id. Same issue as above.
3. **agent_instances status inconsistency** — mix of `done` and `completed` for the same semantic meaning. Should normalize to one value.
4. **sessions DB table unused by RPCs** — The 6 rows in `sessions` are for observability only. The actual session management uses JSON files.

---

## Files Modified

1. `src/gateway/server-methods/swarm.ts` — Fix `swarm.agentDetail` DB access
2. `src/gateway/server-methods/audit.ts` — Add missing columns to `audit.instances` and `events.list`
