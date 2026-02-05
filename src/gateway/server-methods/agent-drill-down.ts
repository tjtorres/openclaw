/**
 * Agent drill-down RPC handler — detailed agent activity view.
 *
 * Provides comprehensive drill-down data for a specific agent:
 *   - Recent work history (completed tasks)
 *   - Current active work
 *   - Cost breakdown
 *   - Activity timeline
 *   - Health/performance metrics
 */
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { getTasksDb, getRecentActivity } from "./tasks-db.js";

export const agentDrillDownHandlers: GatewayRequestHandlers = {
  "agent.drillDown": ({ params, respond }) => {
    const { agentId } = params as { agentId?: string };

    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId required"));
      return;
    }

    const db = getTasksDb();
    if (!db) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Database not available"));
      return;
    }

    try {
      // Get agent instances (spawned workers)
      const instances = db
        .prepare(`
        SELECT instance_id, agent_id, instance_num, status, assigned_task, 
               task_summary, model, cost, spawned_at, last_active_at, torn_down_at
        FROM agent_instances
        WHERE agent_id = ?
        ORDER BY spawned_at DESC
        LIMIT 50
      `)
        .all(agentId) as Array<{
        instance_id: string;
        agent_id: string;
        instance_num: number;
        status: string;
        assigned_task: string | null;
        task_summary: string | null;
        model: string | null;
        cost: number;
        spawned_at: string;
        last_active_at: string | null;
        torn_down_at: string | null;
      }>;

      // Get recent audit log entries for this agent
      const auditLog = db
        .prepare(`
        SELECT ts, action, target, target_type, status, cost, duration_ms, detail, instance_id
        FROM audit_log
        WHERE agent_id = ?
        ORDER BY ts DESC
        LIMIT 100
      `)
        .all(agentId) as Array<{
        ts: string;
        action: string;
        target: string | null;
        target_type: string | null;
        status: string;
        cost: number | null;
        duration_ms: number | null;
        detail: string | null;
        instance_id: string | null;
      }>;

      // Get cost totals for this agent
      const costRow = db
        .prepare(`
        SELECT 
          SUM(cost) as total_cost,
          COUNT(DISTINCT instance_id) as instance_count,
          AVG(cost) as avg_cost_per_instance
        FROM agent_instances
        WHERE agent_id = ?
      `)
        .get(agentId) as
        | {
            total_cost: number | null;
            instance_count: number | null;
            avg_cost_per_instance: number | null;
          }
        | undefined;

      const costs = {
        total: costRow?.total_cost || 0,
        instanceCount: costRow?.instance_count || 0,
        avgPerInstance: costRow?.avg_cost_per_instance || 0,
      };

      // Get recent activity related to this agent
      const activity = getRecentActivity(db, 50).filter((e) =>
        e.message?.toLowerCase().includes(agentId.toLowerCase()),
      );

      // Get current active task
      const activeTask = db
        .prepare(`
        SELECT assigned_task, task_summary, spawned_at, last_active_at
        FROM agent_instances
        WHERE agent_id = ? AND status = 'running'
        ORDER BY spawned_at DESC
        LIMIT 1
      `)
        .get(agentId) as
        | {
            assigned_task: string | null;
            task_summary: string | null;
            spawned_at: string;
            last_active_at: string | null;
          }
        | undefined;

      // Get task history from activity log
      const taskHistory = db
        .prepare(`
        SELECT DISTINCT target as task_name, 
               MAX(ts) as completed_at,
               SUM(cost) as task_cost
        FROM audit_log
        WHERE agent_id = ? 
          AND action IN ('task_complete', 'task_done')
          AND target IS NOT NULL
        GROUP BY target
        ORDER BY completed_at DESC
        LIMIT 20
      `)
        .all(agentId) as Array<{
        task_name: string;
        completed_at: string;
        task_cost: number | null;
      }>;

      // Get performance metrics
      const perfMetrics = db
        .prepare(`
        SELECT 
          AVG(duration_ms) as avg_duration,
          MIN(duration_ms) as min_duration,
          MAX(duration_ms) as max_duration,
          COUNT(*) as action_count
        FROM audit_log
        WHERE agent_id = ? AND duration_ms IS NOT NULL
      `)
        .get(agentId) as
        | {
            avg_duration: number | null;
            min_duration: number | null;
            max_duration: number | null;
            action_count: number;
          }
        | undefined;

      respond(true, {
        agentId,
        instances: instances.map((i) => ({
          instanceId: i.instance_id,
          instanceNum: i.instance_num,
          status: i.status,
          task: i.assigned_task,
          summary: i.task_summary,
          model: i.model,
          cost: i.cost,
          spawnedAt: i.spawned_at,
          lastActiveAt: i.last_active_at,
          tornDownAt: i.torn_down_at,
        })),
        auditLog: auditLog.map((a) => ({
          ts: a.ts,
          action: a.action,
          target: a.target,
          targetType: a.target_type,
          status: a.status,
          cost: a.cost,
          durationMs: a.duration_ms,
          detail: a.detail,
          instanceId: a.instance_id,
        })),
        costs,
        activity: activity.map((e) => ({
          ts: e.ts,
          icon: e.icon,
          message: e.message,
          category: e.category,
        })),
        currentWork: activeTask
          ? {
              task: activeTask.assigned_task,
              summary: activeTask.task_summary,
              spawnedAt: activeTask.spawned_at,
              lastActiveAt: activeTask.last_active_at,
            }
          : null,
        taskHistory: taskHistory.map((t) => ({
          name: t.task_name,
          completedAt: t.completed_at,
          cost: t.task_cost || 0,
        })),
        performance: {
          avgDuration: perfMetrics?.avg_duration || 0,
          minDuration: perfMetrics?.min_duration || 0,
          maxDuration: perfMetrics?.max_duration || 0,
          actionCount: perfMetrics?.action_count || 0,
        },
        fetchedAt: Date.now(),
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  },
};
