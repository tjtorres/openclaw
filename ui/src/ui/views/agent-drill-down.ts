import { html, nothing } from "lit";
import { formatAgo } from "../format.ts";

export type AgentDrillDownData = {
  agentId: string;
  instances: Array<{
    instanceId: string;
    instanceNum: number;
    status: string;
    task: string | null;
    summary: string | null;
    model: string | null;
    cost: number;
    spawnedAt: string;
    lastActiveAt: string | null;
    tornDownAt: string | null;
  }>;
  auditLog: Array<{
    ts: string;
    action: string;
    target: string | null;
    targetType: string | null;
    status: string;
    cost: number | null;
    durationMs: number | null;
    detail: string | null;
    instanceId: string | null;
  }>;
  costs: {
    total: number;
    instanceCount: number;
    avgPerInstance: number;
  };
  activity: Array<{
    ts: string;
    icon: string;
    message: string;
    category: string;
  }>;
  currentWork: {
    task: string | null;
    summary: string | null;
    spawnedAt: string;
    lastActiveAt: string | null;
  } | null;
  taskHistory: Array<{
    name: string;
    completedAt: string;
    cost: number;
  }>;
  performance: {
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    actionCount: number;
  };
  fetchedAt: number;
};

export type AgentDrillDownProps = {
  agentId: string;
  data: AgentDrillDownData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

function formatDuration(ms: number | null): string {
  if (!ms || ms === 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "running":
      return "badge--success";
    case "completed":
    case "done":
      return "badge--info";
    case "failed":
    case "error":
      return "badge--danger";
    default:
      return "badge--default";
  }
}

export function renderAgentDrillDown(props: AgentDrillDownProps) {
  if (props.loading) {
    return html`
      <section class="card">
        <div class="card-title">Agent Activity</div>
        <div class="muted">Loading agent data...</div>
      </section>
    `;
  }

  if (props.error) {
    return html`
      <section class="card">
        <div class="card-title">Agent Activity</div>
        <div class="callout danger">${props.error}</div>
      </section>
    `;
  }

  if (!props.data) {
    return html`
      <section class="card">
        <div class="card-title">Agent Activity</div>
        <div class="muted">No data available.</div>
        <button class="btn btn--sm" @click=${props.onRefresh}>Load Data</button>
      </section>
    `;
  }

  const { data } = props;

  return html`
    <div class="drill-down-container">
      <!-- Overview Cards -->
      <div class="drill-down-overview">
        <div class="card drill-down-stat-card">
          <div class="stat-label">Total Cost</div>
          <div class="stat-value">${formatCost(data.costs.total)}</div>
          <div class="stat-sub">${data.costs.instanceCount} instances spawned</div>
        </div>
        
        <div class="card drill-down-stat-card">
          <div class="stat-label">Avg Cost/Instance</div>
          <div class="stat-value">${formatCost(data.costs.avgPerInstance)}</div>
        </div>

        <div class="card drill-down-stat-card">
          <div class="stat-label">Avg Duration</div>
          <div class="stat-value">${formatDuration(data.performance.avgDuration)}</div>
          <div class="stat-sub">${data.performance.actionCount} actions</div>
        </div>

        <div class="card drill-down-stat-card">
          <div class="stat-label">Tasks Completed</div>
          <div class="stat-value">${data.taskHistory.length}</div>
        </div>
      </div>

      <!-- Current Work -->
      ${
        data.currentWork
          ? html`
              <section class="card">
                <div class="row" style="justify-content: space-between;">
                  <div class="card-title">Current Work</div>
                  <span class="badge badge--success">Active</span>
                </div>
                <div class="drill-down-current-work">
                  <div class="work-item">
                    <div class="label">Task</div>
                    <div class="mono">${data.currentWork.task || "(unnamed)"}</div>
                  </div>
                  ${
                    data.currentWork.summary
                      ? html`
                          <div class="work-item">
                            <div class="label">Summary</div>
                            <div>${data.currentWork.summary}</div>
                          </div>
                        `
                      : nothing
                  }
                  <div class="work-item">
                    <div class="label">Started</div>
                    <div>${formatAgo(data.currentWork.spawnedAt)}</div>
                  </div>
                  ${
                    data.currentWork.lastActiveAt
                      ? html`
                          <div class="work-item">
                            <div class="label">Last Active</div>
                            <div>${formatAgo(data.currentWork.lastActiveAt)}</div>
                          </div>
                        `
                      : nothing
                  }
                </div>
              </section>
            `
          : html`
              <section class="card">
                <div class="card-title">Current Work</div>
                <div class="muted">No active work at the moment.</div>
              </section>
            `
      }

      <!-- Task History -->
      <section class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Task History</div>
            <div class="card-sub">${data.taskHistory.length} completed tasks</div>
          </div>
          <button class="btn btn--sm" @click=${props.onRefresh}>Refresh</button>
        </div>
        ${
          data.taskHistory.length === 0
            ? html`
                <div class="muted" style="margin-top: 12px">No completed tasks yet.</div>
              `
            : html`
                <div class="drill-down-task-list" style="margin-top: 12px;">
                  ${data.taskHistory.map(
                    (task) => html`
                      <div class="drill-down-task-row">
                        <div class="task-info">
                          <div class="task-name">${task.name}</div>
                          <div class="task-sub">${formatAgo(task.completedAt)}</div>
                        </div>
                        <div class="task-cost mono">${formatCost(task.cost)}</div>
                      </div>
                    `,
                  )}
                </div>
              `
        }
      </section>

      <!-- Agent Instances -->
      <section class="card">
        <div class="card-title">Agent Instances</div>
        <div class="card-sub">${data.instances.length} total instances</div>
        ${
          data.instances.length === 0
            ? html`
                <div class="muted" style="margin-top: 12px">No instances spawned yet.</div>
              `
            : html`
                <div class="drill-down-instances-table" style="margin-top: 12px;">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Instance</th>
                        <th>Status</th>
                        <th>Task</th>
                        <th>Model</th>
                        <th>Cost</th>
                        <th>Spawned</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${data.instances.map(
                        (inst) => html`
                          <tr>
                            <td class="mono">${inst.instanceId}</td>
                            <td>
                              <span class="badge ${statusBadgeClass(inst.status)}">
                                ${inst.status}
                              </span>
                            </td>
                            <td>${inst.task || "-"}</td>
                            <td class="mono">${inst.model || "-"}</td>
                            <td class="mono">${formatCost(inst.cost)}</td>
                            <td>${formatAgo(inst.spawnedAt)}</td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `
        }
      </section>

      <!-- Audit Log -->
      <section class="card">
        <div class="card-title">Recent Activity</div>
        <div class="card-sub">${data.auditLog.length} recent actions</div>
        ${
          data.auditLog.length === 0
            ? html`
                <div class="muted" style="margin-top: 12px">No audit entries yet.</div>
              `
            : html`
                <div class="drill-down-audit-log" style="margin-top: 12px;">
                  ${data.auditLog.slice(0, 20).map(
                    (entry) => html`
                      <div class="audit-entry">
                        <div class="audit-ts mono">${formatAgo(entry.ts)}</div>
                        <div class="audit-content">
                          <div class="audit-action">
                            <span class="badge ${statusBadgeClass(entry.status)}">
                              ${entry.action}
                            </span>
                            ${entry.target ? html` → <span class="mono">${entry.target}</span>` : nothing}
                          </div>
                          ${
                            entry.detail
                              ? html`<div class="audit-detail muted">${entry.detail}</div>`
                              : nothing
                          }
                          <div class="audit-meta">
                            ${
                              entry.cost
                                ? html`<span class="mono">${formatCost(entry.cost)}</span>`
                                : nothing
                            }
                            ${
                              entry.durationMs
                                ? html`<span>${formatDuration(entry.durationMs)}</span>`
                                : nothing
                            }
                            ${
                              entry.instanceId
                                ? html`<span class="mono">${entry.instanceId}</span>`
                                : nothing
                            }
                          </div>
                        </div>
                      </div>
                    `,
                  )}
                </div>
              `
        }
      </section>
    </div>
  `;
}
