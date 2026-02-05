# Full Agent Audit Trail Implementation

**Status:** ✅ **COMPLETE** (Trello card [#69838e39024e387cf0331125](https://trello.com/c/h0jcf3uI))

## Overview

The full agent audit trail provides comprehensive observability into all agent activities, including:

- **Who** did what (agent instance tracking with unique IDs like `Ghost_7`, `Ada_3`)
- **Cost** per action and total per instance
- **Time** spent (duration tracking)
- **Thinking level** and model used
- **Actions taken** (detailed audit log)
- **Raw logs** for debugging
- **Task summaries** with timelines

## Architecture

### Database Schema

**`agent_instances` table** — tracks each spawned agent instance:

```sql
CREATE TABLE agent_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT UNIQUE NOT NULL,        -- e.g., "Ghost_7", "Ada_3"
  agent_id TEXT NOT NULL,                  -- e.g., "ghost", "ada"
  instance_num INTEGER NOT NULL,           -- Sequential number per agent
  status TEXT DEFAULT 'running',           -- running|idle|completed|failed|torn_down
  assigned_task TEXT,                      -- Task description
  task_summary TEXT,                       -- Outcome/result
  session_key TEXT,
  job_id TEXT,
  model TEXT,                              -- Model used
  cost REAL DEFAULT 0,                     -- Total cost
  spawned_at TEXT DEFAULT (datetime('now')),
  last_active_at TEXT DEFAULT (datetime('now')),
  torn_down_at TEXT,
  metadata TEXT DEFAULT '{}'
);
```

**`audit_log` table** — detailed action log:

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT DEFAULT (datetime('now')),
  agent_id TEXT NOT NULL,
  instance_id TEXT,                        -- Links to agent_instances
  action TEXT NOT NULL,                    -- e.g., "tool.read", "rpc.call"
  target TEXT,                             -- Target of action
  target_type TEXT,                        -- Type of target
  status TEXT DEFAULT 'ok',                -- ok|error|failed
  cost REAL,                               -- Cost of this action
  duration_ms INTEGER,                     -- How long it took
  detail TEXT,                             -- Additional details
  session_key TEXT
);
```

**`events` table** — gateway event log:

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,                -- e.g., "tool", "rpc", "message"
  event_name TEXT NOT NULL,                -- e.g., "read", "call", "sent"
  agent_id TEXT,
  instance_id TEXT,
  session_key TEXT,
  duration_ms INTEGER,
  status TEXT DEFAULT 'ok',
  cost REAL,
  metadata TEXT DEFAULT '{}'
);
```

### RPC API

All audit endpoints are available via the gateway RPC interface:

#### `audit.instances`

List all agent instances with optional filtering.

**Request:**

```json
{
  "method": "audit.instances",
  "params": {
    "agentId": "ghost", // Optional: filter by agent
    "status": "running", // Optional: filter by status
    "limit": 50,
    "offset": 0
  }
}
```

**Response:**

```json
{
  "instances": [
    {
      "instanceId": "Ghost_7",
      "agentId": "ghost",
      "instanceNum": 7,
      "status": "completed",
      "assignedTask": "Implement audit trail UI",
      "taskSummary": "Successfully wired audit.list RPC to dashboard",
      "model": "anthropic/claude-sonnet-4-5",
      "cost": 0.0234,
      "spawnedAt": "2026-02-05T04:00:00Z",
      "lastActiveAt": "2026-02-05T04:15:00Z",
      "tornDownAt": "2026-02-05T04:15:30Z",
      "sessionKey": "cron:abc123",
      "jobId": "job_xyz",
      "actionCount": 47
    }
  ],
  "total": 142,
  "fetchedAt": 1707109500000
}
```

#### `audit.list`

Paginated audit log with filtering.

**Request:**

```json
{
  "method": "audit.list",
  "params": {
    "instanceId": "Ghost_7", // Optional
    "agentId": "ghost", // Optional
    "action": "tool.read", // Optional
    "status": "ok", // Optional
    "limit": 100,
    "offset": 0
  }
}
```

**Response:**

```json
{
  "entries": [
    {
      "id": 12345,
      "ts": "2026-02-05T04:10:23Z",
      "agentId": "ghost",
      "instanceId": "Ghost_7",
      "action": "tool.read",
      "target": "/home/teej/Projects/openclaw/ui/src/ui/views/audit.ts",
      "targetType": "file",
      "status": "ok",
      "cost": 0.0001,
      "durationMs": 23,
      "detail": "Read 500 lines",
      "sessionKey": "cron:abc123"
    }
  ],
  "total": 47,
  "fetchedAt": 1707109500000
}
```

#### `audit.logs`

Raw log content for a specific agent instance.

**Request:**

```json
{
  "method": "audit.logs",
  "params": {
    "instanceId": "Ghost_7", // Optional: null for combined gateway logs
    "tail": 200 // Number of lines to return
  }
}
```

**Response:**

```json
{
  "instanceId": "Ghost_7",
  "logs": "[2026-02-05T04:10:00Z] Ghost_7 spawned...\n[2026-02-05T04:10:01Z] Reading audit.ts...\n...",
  "fetchedAt": 1707109500000
}
```

#### `audit.summary`

Summarized view of an agent instance's work.

**Request:**

```json
{
  "method": "audit.summary",
  "params": {
    "instanceId": "Ghost_7"
  }
}
```

**Response:**

```json
{
  "instanceId": "Ghost_7",
  "agentId": "ghost",
  "instanceNum": 7,
  "status": "completed",
  "assignedTask": "Implement audit trail UI",
  "taskSummary": "Successfully wired audit.list RPC to dashboard",
  "model": "anthropic/claude-sonnet-4-5",
  "totalCost": 0.0234,
  "spawnedAt": "2026-02-05T04:00:00Z",
  "tornDownAt": "2026-02-05T04:15:30Z",
  "durationMs": 930000,
  "actionBreakdown": [
    {
      "action": "tool.read",
      "count": 23,
      "totalCost": 0.0123,
      "firstAt": "2026-02-05T04:00:10Z",
      "lastAt": "2026-02-05T04:14:50Z"
    },
    {
      "action": "tool.exec",
      "count": 12,
      "totalCost": 0.0089,
      "firstAt": "2026-02-05T04:01:00Z",
      "lastAt": "2026-02-05T04:13:00Z"
    }
  ],
  "timeline": [
    {
      "ts": "2026-02-05T04:15:20Z",
      "action": "task.complete",
      "target": null,
      "status": "ok",
      "cost": 0.0001,
      "detail": "Committed implementation"
    },
    {
      "ts": "2026-02-05T04:14:50Z",
      "action": "tool.write",
      "target": "docs/audit-trail.md",
      "status": "ok",
      "cost": 0.0002,
      "detail": "Created documentation"
    }
  ],
  "fetchedAt": 1707109500000
}
```

#### `events.list`

Gateway event log with filtering.

**Request:**

```json
{
  "method": "events.list",
  "params": {
    "eventType": "tool", // Optional: tool|rpc|message|session
    "eventName": "read", // Optional
    "agentId": "ghost", // Optional
    "sessionKey": "main", // Optional
    "status": "ok", // Optional
    "limit": 100,
    "offset": 0
  }
}
```

## UI Dashboard

Access the audit trail at: **http://localhost:18791/audit** (or your gateway URL + `/audit`)

### Three View Modes

1. **⚡ Actions View** — Detailed audit log in table format
   - Columns: Time, Instance, Action, Detail, Status, Cost
   - Filter by agent or instance
   - Shows all actions taken by agents

2. **📄 Raw Logs View** — Raw log file content
   - Combined gateway logs or per-instance logs
   - Useful for debugging
   - Tail of last 200 lines by default

3. **📊 Summary View** — High-level overview
   - Instance cards with status badges
   - Action breakdown (bar chart showing most common actions)
   - Timeline of key events
   - Cost, duration, and stats

### Features

- **Agent Filter** — Filter by specific agent (Jeeves, Ghost, Ada, etc.)
- **Instance Chips** — Click any instance to drill down
- **Status Badges** — Visual status indicators (running, completed, failed, etc.)
- **Cost Tracking** — Real-time cost per action and total
- **Timeline** — Chronological event log with visual markers
- **Action Breakdown** — See what actions agents are spending time on

## Usage Examples

### CLI Access via Gateway Client

```bash
# List all instances
openclaw gateway call audit.instances

# Get audit log for a specific instance
openclaw gateway call audit.list '{"instanceId": "Ghost_7"}'

# Get summary with action breakdown
openclaw gateway call audit.summary '{"instanceId": "Ghost_7"}'

# Get raw logs
openclaw gateway call audit.logs '{"instanceId": "Ghost_7"}'
```

### Dashboard Access

1. Navigate to **http://localhost:18791/audit**
2. Use the agent filter to narrow down (e.g., "Ghost")
3. Click an instance chip to select it
4. Switch between Actions/Logs/Summary views
5. Click "Refresh" to update data

## Implementation Files

### Backend (RPC)

- `src/gateway/server-methods/audit.ts` — RPC handlers
- `src/gateway/server-methods/event-logger.ts` — Event logging service
- Database: `tasks.sqlite` → tables: `agent_instances`, `audit_log`, `events`

### Frontend (UI)

- `ui/src/ui/views/audit.ts` — View rendering (740 lines)
- `ui/src/ui/controllers/audit.ts` — Data loading controller
- `ui/src/ui/app.ts` — State management integration
- `ui/src/ui/app-render.ts` — Render integration
- `ui/src/ui/navigation.ts` — Tab registration

## Security Considerations

- **Path Traversal Protection** — `instanceId` is validated with regex `^[a-z0-9_-]+$`
- **SQL Injection Protection** — All queries use parameterized statements
- **Log File Access** — Absolute path resolution with validation
- **Gateway Auth** — Audit endpoints require valid gateway token

## Performance

- **Indexed Queries** — All tables have appropriate indexes
- **Pagination** — Default limit of 50-100 entries
- **Lazy Loading** — Logs and summaries load on-demand
- **Efficient Aggregation** — Action breakdown uses SQL GROUP BY

## Future Enhancements

Potential improvements (not in current scope):

- [ ] Export audit log to CSV/JSON
- [ ] Real-time streaming updates (WebSocket)
- [ ] Advanced filtering (date ranges, cost thresholds)
- [ ] Audit log retention policy
- [ ] Cost budget alerts
- [ ] Agent performance rankings
- [ ] Trend analysis and charts

## Testing

The audit trail has been tested with:

- ✅ Swarm worker spawning
- ✅ Cron job execution
- ✅ Manual gateway chat sessions
- ✅ Multi-agent coordination
- ✅ Long-running tasks
- ✅ Failed/error scenarios

## Commit History

- `fa1fbf1d5` — Initial audit log tab, RPC fixes, observability data surface
- `3209181df` — Wire agentId/sessionKey into event logger
- `48fd0e257` — Wire agent drill-down panel in swarm tab
- `1b4eb57ec` — Make Swarm tab primary dashboard

## Documentation

- Main docs: `docs/audit-trail-implementation.md` (this file)
- API reference: See RPC method JSDoc in `src/gateway/server-methods/audit.ts`
- UI reference: See component docs in `ui/src/ui/views/audit.ts`

---

**Implementation completed:** 2026-02-05 04:15 UTC  
**Card:** [#69838e39024e387cf0331125](https://trello.com/c/h0jcf3uI)  
**Implemented by:** Ghost (cron worker)
