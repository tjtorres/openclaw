import { html, nothing } from "lit";
import type {
  SwarmSnapshot,
  SwarmHierarchy,
  SwarmAgentNode,
  SwarmGroup,
  AgentInstance,
  DrillDownInstance,
} from "../controllers/swarm";
import { formatAgo } from "../format";
import { renderAgentDrillDown } from "./agent-drill-down.ts";

export type AgentDetail = {
  id: string;
  name: string;
  role: string;
  level: string;
  trustScore: number;
  status: string;
  currentTask?: string | null;
  specialty?: string | null;
  recentHistory: Array<{ task: string; status: string; cost?: number; completedAt?: string }>;
  assignedCards: Array<{ name: string; progress: number; list: string }>;
  totalCost: number;
  tasksCompleted: number;
  tasksFailed: number;
};

export type SwarmViewProps = {
  loading: boolean;
  error: string | null;
  snapshot: SwarmSnapshot | null;
  hierarchy: SwarmHierarchy | null;
  selectedAgent: AgentDetail | null;
  selectedAgentLoading: boolean;
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
  onCloseAgent: () => void;
  // Drill-down panel
  drillDownAgentId: string | null;
  drillDownInstances: DrillDownInstance[];
  drillDownInstancesLoading: boolean;
  drillDownInstancesError: string | null;
  drillDownSelectedInstanceId: string | null;
  drillDownLogs: string | null;
  drillDownLogsLoading: boolean;
  drillDownData: import("./agent-drill-down.ts").AgentDrillDownData | null;
  drillDownDataLoading: boolean;
  drillDownDataError: string | null;
  onOpenDrillDown: (agentId: string) => void;
  onCloseDrillDown: () => void;
  onSelectInstance: (instanceId: string) => void;
  onRefreshDrillDown: () => void;
};

// Health tier types for agent status
type HealthTier = "healthy" | "warning" | "degraded" | "critical" | "archived";

// Map status to health tier and color
function getHealthTier(status: string): { tier: HealthTier; color: string; label: string } {
  const healthMap: Record<string, { tier: HealthTier; color: string; label: string }> = {
    active: { tier: "healthy", color: "#10b981", label: "Healthy" },
    working: { tier: "healthy", color: "#10b981", label: "Healthy" },
    running: { tier: "healthy", color: "#10b981", label: "Healthy" },
    done: { tier: "healthy", color: "#10b981", label: "Completed" },
    idle: { tier: "warning", color: "#f59e0b", label: "Idle" },
    pending: { tier: "warning", color: "#94a3b8", label: "Pending" },
    failed: { tier: "critical", color: "#ef4444", label: "Failed" },
    archived: { tier: "archived", color: "#6b7280", label: "Archived" },
    cancelled: { tier: "archived", color: "#6b7280", label: "Cancelled" },
  };
  return healthMap[status] ?? { tier: "warning", color: "#94a3b8", label: "Unknown" };
}

function statusDot(status: string) {
  const health = getHealthTier(status);
  const pulse = status === "active" || status === "working" || status === "running";
  return html`<span
    style="
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${health.color};
      ${pulse ? "animation: pulse 2s infinite;" : ""}
      margin-right: 6px;
      flex-shrink: 0;
    "
  ></span>`;
}

function trustBar(score: number) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "#10b981" : pct >= 60 ? "#f59e0b" : "#ef4444";
  return html`
    <div
      style="
      height: 6px;
      background: var(--bg-hover, #242442);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 4px;
      width: 100px;
    "
    >
      <div
        style="
        height: 100%;
        width: ${pct}%;
        background: ${color};
        border-radius: 3px;
      "
      ></div>
    </div>
  `;
}

function instanceStatusColor(status: string): string {
  if (status === "running") return "#10b981";
  if (status === "failed" || status === "error") return "#ef4444";
  return "#6b7280"; // done, torn_down, etc.
}

function renderInstanceList(instances: AgentInstance[]) {
  if (!instances.length) return nothing;
  const shown = instances.slice(0, 3);
  return html`
    <div style="
      border-top: 1px solid var(--border, #2d2d4a);
      padding-top: 8px;
      margin-top: 2px;
    ">
      <div style="font-size: 0.7rem; color: var(--text-muted, #94a3b8); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
        Recent Instances
      </div>
      ${shown.map(
        (inst) => html`
        <div style="
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 3px 0;
          font-size: 0.78rem;
          color: var(--text, #e2e8f0);
        ">
          <span style="
            display: inline-block;
            width: 7px; height: 7px;
            border-radius: 50%;
            background: ${instanceStatusColor(inst.status)};
            ${inst.status === "running" ? "animation: pulse 2s infinite;" : ""}
            flex-shrink: 0;
          "></span>
          <code style="font-size: 0.72rem; color: var(--text-muted, #94a3b8);">${inst.instance_id}</code>
          <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${inst.assigned_task ? inst.assigned_task.slice(0, 50) : "—"}
          </span>
          <span class="muted" style="font-size: 0.7rem; white-space: nowrap;">
            ${inst.spawned_at ? formatAgo(new Date(inst.spawned_at).getTime()) : ""}
          </span>
        </div>
      `,
      )}
      ${
        instances.length > 3
          ? html`
        <div style="font-size: 0.7rem; color: var(--text-muted, #94a3b8); padding-top: 2px;">
          +${instances.length - 3} more
        </div>
      `
          : nothing
      }
    </div>
  `;
}

function renderAgentNode(node: SwarmAgentNode, depth = 0, onSelect?: (id: string) => void) {
  const indent = depth * 24;
  const recentTasks = Array.isArray(node.recentTasks) ? node.recentTasks : [];
  const instances = Array.isArray(node.instances) ? node.instances : [];
  const activeCount = node.activeCount ?? 0;
  const health = getHealthTier(node.status);

  // Health-based styling — glow green when instances are running
  const hasRunning = activeCount > 0;
  const borderColor = hasRunning
    ? "#10b981"
    : health.tier !== "archived"
      ? health.color
      : "var(--border, #2d2d4a)";
  const borderWidth = hasRunning
    ? "3px"
    : health.tier === "critical" || health.tier === "degraded"
      ? "3px"
      : "2px";
  const boxShadow = hasRunning
    ? "0 0 12px #10b98140, inset 0 0 0 1px #10b98120"
    : health.tier === "critical"
      ? `0 0 12px ${health.color}40, inset 0 0 0 1px ${health.color}20`
      : health.tier === "degraded"
        ? `0 0 8px ${health.color}30, inset 0 0 0 1px ${health.color}15`
        : "none";

  return html`
    <div style="margin-left: ${indent}px; margin-bottom: 8px;">
      <div
        class="agent-card card"
        style="
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        cursor: pointer;
        transition: all 0.2s;
        border-left: ${borderWidth} solid ${borderColor};
        ${node.status === "archived" ? "opacity: 0.5;" : ""}
        ${boxShadow !== "none" ? `box-shadow: ${boxShadow};` : ""}
        position: relative;
      "
        @click=${(e: Event) => {
          e.stopPropagation();
          onSelect?.(node.id);
        }}
      >
        <div style="display: flex; align-items: center; gap: 12px;">
          <div
            style="
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--bg-hover, #242442);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.3rem;
            flex-shrink: 0;
          "
          >
            ${node.emoji ?? "🤖"}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              ${statusDot(node.status)}
              <strong>${node.name}</strong>
              <span class="pill" style="font-size: 0.7rem;">${node.level} ${node.role}</span>
              ${
                activeCount > 0
                  ? html`
                <span style="
                  display: inline-flex;
                  align-items: center;
                  gap: 4px;
                  padding: 2px 8px;
                  background: #065f46;
                  color: #6ee7b7;
                  border-radius: 10px;
                  font-size: 0.7rem;
                  font-weight: 600;
                ">
                  <span style="
                    width: 6px; height: 6px;
                    border-radius: 50%;
                    background: #10b981;
                    animation: pulse 2s infinite;
                  "></span>
                  ${activeCount} active
                </span>
              `
                  : nothing
              }
            </div>
            ${
              node.currentTask
                ? html`<div style="font-size: 0.8rem; margin-top: 4px; color: var(--text, #e2e8f0);">
                  <span style="color: var(--text-muted, #94a3b8);">Working on:</span> ${node.currentTask}
                </div>`
                : node.specialty
                  ? html`<div class="muted" style="font-size: 0.8rem; margin-top: 4px;">
                    ${node.specialty}
                  </div>`
                  : nothing
            }
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
              <span style="font-size: 0.75rem; color: var(--text-muted, #94a3b8);"
                >Trust: ${(node.trustScore * 100).toFixed(0)}%</span
              >
              ${trustBar(node.trustScore)}
            </div>
          </div>
        </div>
        
        ${
          instances.length > 0
            ? renderInstanceList(instances)
            : recentTasks.length > 0
              ? html`
          <div style="
            border-top: 1px solid var(--border, #2d2d4a);
            padding-top: 8px;
            margin-top: 2px;
          ">
            <div style="font-size: 0.7rem; color: var(--text-muted, #94a3b8); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
              Recent Activity
            </div>
            ${recentTasks.slice(0, 3).map(
              (task: any) => html`
              <div style="
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px 0;
                font-size: 0.8rem;
                color: var(--text, #e2e8f0);
              ">
                ${statusDot(task.status)}
                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${task.task}
                </span>
              </div>
            `,
            )}
          </div>
        `
              : nothing
        }
      </div>
      ${node.children.map((child) => renderAgentNode(child, depth + 1, onSelect))}
    </div>
  `;
}

function workerStatusBadge(status: string) {
  const styles: Record<string, string> = {
    running: "background: #065f46; color: #6ee7b7;",
    done: "background: #064e3b; color: #a7f3d0;",
    failed: "background: #7f1d1d; color: #fca5a5;",
    cancelled: "background: #374151; color: #9ca3af;",
    pending: "background: #1e293b; color: #94a3b8;",
  };
  return html`<span
    class="pill"
    style="font-size: 0.7rem; ${styles[status] ?? styles.pending}"
    >${status}</span
  >`;
}

function renderSwarmGroup(group: SwarmGroup) {
  const running = group.workers.filter((w) => w.status === "running").length;
  const done = group.workers.filter((w) => w.status === "done").length;
  const total = group.workers.length;

  return html`
    <div class="card" style="margin-bottom: 12px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div>
          <strong>🐝 Swarm: ${group.id}</strong>
          <span class="muted" style="margin-left: 8px; font-size: 0.85rem;"
            >${group.repo} @ ${group.baseBranch}</span
          >
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${workerStatusBadge(group.status)}
          <span class="muted" style="font-size: 0.8rem;"
            >${done}/${total} done ${running > 0 ? `· ${running} running` : ""}</span
          >
        </div>
      </div>

      <div style="margin-top: 12px; display: grid; gap: 6px;">
        ${group.workers.map(
          (worker) => html`
            <div
              style="
              display: flex;
              align-items: center;
              gap: 8px;
              padding: 8px 12px;
              background: var(--bg-hover, #1a1a2e);
              border-radius: 6px;
            "
            >
              ${statusDot(worker.status)}
              <span style="flex: 1; font-size: 0.9rem;">${worker.name}</span>
              ${
                worker.branch
                  ? html`<code style="font-size: 0.75rem;">${worker.branch}</code>`
                  : nothing
              }
              ${workerStatusBadge(worker.status)}
              ${
                worker.startedAt
                  ? html`<span class="muted" style="font-size: 0.75rem;"
                    >${formatAgo(new Date(worker.startedAt).getTime())}</span
                  >`
                  : nothing
              }
            </div>
          `,
        )}
      </div>
    </div>
  `;
}

function renderAgentDetail(agent: AgentDetail, onClose: () => void) {
  const trustPct = Math.round(agent.trustScore * 100);
  const trustColor = trustPct >= 80 ? "#10b981" : trustPct >= 60 ? "#f59e0b" : "#ef4444";
  const successRate =
    agent.tasksCompleted + agent.tasksFailed > 0
      ? Math.round((agent.tasksCompleted / (agent.tasksCompleted + agent.tasksFailed)) * 100)
      : 0;

  return html`
    <div class="card agent-detail-panel" style="margin-top: 16px; position: relative; border: 2px solid var(--border-strong, #3d3d5a);">
      <button
        style="
          position: absolute;
          top: 12px;
          right: 12px;
          background: var(--bg-hover, #242442);
          border: 1px solid var(--border, #2d2d4a);
          color: var(--text, #e2e8f0);
          cursor: pointer;
          font-size: 1.2rem;
          padding: 4px 10px;
          border-radius: 6px;
          transition: all 0.2s;
        "
        @click=${onClose}
        @mouseenter=${(e: any) => {
          e.target.style.background = "var(--border, #2d2d4a)";
        }}
        @mouseleave=${(e: any) => {
          e.target.style.background = "var(--bg-hover, #242442)";
        }}
      >✕</button>
      
      <!-- Header -->
      <div style="display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px; padding-right: 40px;">
        <div style="
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: var(--bg-hover, #242442);
          border: 2px solid var(--border, #2d2d4a);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.8rem;
          flex-shrink: 0;
        ">
          ${agent.id === "jeeves" ? "🌟" : agent.id === "ada" ? "🎨" : agent.id === "crash" ? "🔧" : agent.id === "ghost" ? "👻" : "🤖"}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            ${statusDot(agent.status)}
            <h3 style="margin: 0; font-size: 1.2rem; font-weight: 600; color: var(--text, #e2e8f0);">
              ${agent.name}
            </h3>
          </div>
          <div class="muted" style="font-size: 0.9rem; margin-bottom: 6px;">
            ${agent.level} ${agent.role}
          </div>
          ${
            agent.specialty
              ? html`
            <div style="
              display: inline-block;
              padding: 4px 10px;
              background: var(--bg-hover, #242442);
              border-radius: 12px;
              font-size: 0.8rem;
              color: var(--text-muted, #94a3b8);
            ">
              ${agent.specialty}
            </div>
          `
              : nothing
          }
        </div>
        <div style="text-align: center;">
          <div style="font-size: 2rem; font-weight: 700; color: ${trustColor}; line-height: 1;">
            ${trustPct}%
          </div>
          <div class="muted" style="font-size: 0.75rem; margin-top: 2px;">TRUST</div>
        </div>
      </div>

      <!-- Stats Grid -->
      <div style="
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
        gap: 10px;
        margin-bottom: 20px;
      ">
        <div style="
          padding: 12px;
          background: var(--bg-hover, #242442);
          border: 1px solid var(--border, #2d2d4a);
          border-radius: 8px;
          text-align: center;
        ">
          <div style="font-size: 1.5rem; font-weight: 700; color: #10b981;">
            ${agent.tasksCompleted}
          </div>
          <div class="muted" style="font-size: 0.75rem; margin-top: 2px;">COMPLETED</div>
        </div>
        <div style="
          padding: 12px;
          background: var(--bg-hover, #242442);
          border: 1px solid var(--border, #2d2d4a);
          border-radius: 8px;
          text-align: center;
        ">
          <div style="font-size: 1.5rem; font-weight: 700; color: #ef4444;">
            ${agent.tasksFailed}
          </div>
          <div class="muted" style="font-size: 0.75rem; margin-top: 2px;">FAILED</div>
        </div>
        <div style="
          padding: 12px;
          background: var(--bg-hover, #242442);
          border: 1px solid var(--border, #2d2d4a);
          border-radius: 8px;
          text-align: center;
        ">
          <div style="font-size: 1.5rem; font-weight: 700; color: var(--text, #e2e8f0);">
            ${successRate}%
          </div>
          <div class="muted" style="font-size: 0.75rem; margin-top: 2px;">SUCCESS</div>
        </div>
        <div style="
          padding: 12px;
          background: var(--bg-hover, #242442);
          border: 1px solid var(--border, #2d2d4a);
          border-radius: 8px;
          text-align: center;
        ">
          <div style="font-size: 1.5rem; font-weight: 700; color: #f59e0b;">
            $${agent.totalCost.toFixed(2)}
          </div>
          <div class="muted" style="font-size: 0.75rem; margin-top: 2px;">TOTAL COST</div>
        </div>
      </div>

      <!-- Current Work -->
      ${
        agent.currentTask
          ? html`
        <div style="margin-bottom: 20px;">
          <div style="
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--text-muted, #94a3b8);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          ">
            🔨 Current Work
          </div>
          <div style="
            padding: 12px 14px;
            background: var(--bg-hover, #242442);
            border-left: 4px solid #10b981;
            border-radius: 6px;
            font-size: 0.9rem;
            color: var(--text, #e2e8f0);
            line-height: 1.5;
          ">
            ${agent.currentTask}
            <div style="
              margin-top: 8px;
              height: 4px;
              background: var(--border, #2d2d4a);
              border-radius: 2px;
              overflow: hidden;
            ">
              <div style="
                height: 100%;
                width: 40%;
                background: linear-gradient(90deg, #10b981, #059669);
                animation: progress-pulse 2s ease-in-out infinite;
              "></div>
            </div>
          </div>
        </div>
      `
          : nothing
      }

      <!-- Assigned Cards -->
      ${
        agent.assignedCards.length > 0
          ? html`
        <div style="margin-bottom: 20px;">
          <div style="
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--text-muted, #94a3b8);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          ">
            📋 Assigned Cards (${agent.assignedCards.length})
          </div>
          <div style="display: grid; gap: 8px;">
            ${agent.assignedCards.map((card) => {
              const progressPct = Math.round((card.progress ?? 0) * 100);
              return html`
                <div style="
                  padding: 10px 12px;
                  background: var(--bg-hover, #242442);
                  border: 1px solid var(--border, #2d2d4a);
                  border-radius: 6px;
                ">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                    <span style="flex: 1; font-size: 0.9rem; font-weight: 500; color: var(--text, #e2e8f0);">
                      ${card.name}
                    </span>
                    <span class="pill" style="font-size: 0.7rem;">${card.list}</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="
                      flex: 1;
                      height: 6px;
                      background: var(--border, #2d2d4a);
                      border-radius: 3px;
                      overflow: hidden;
                    ">
                      <div style="
                        height: 100%;
                        width: ${progressPct}%;
                        background: ${progressPct === 100 ? "#10b981" : progressPct > 50 ? "#f59e0b" : "#3b82f6"};
                        border-radius: 3px;
                        transition: width 0.3s;
                      "></div>
                    </div>
                    <span style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted, #94a3b8); min-width: 35px;">
                      ${progressPct}%
                    </span>
                  </div>
                </div>
              `;
            })}
          </div>
        </div>
      `
          : nothing
      }

      <!-- Recent History -->
      ${
        agent.recentHistory.length > 0
          ? html`
        <div>
          <div style="
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--text-muted, #94a3b8);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          ">
            📜 Recent History
          </div>
          <div style="display: grid; gap: 1px;">
            ${agent.recentHistory.slice(0, 5).map(
              (item) => html`
              <div style="
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 12px;
                background: var(--bg-hover, #242442);
                font-size: 0.85rem;
              ">
                ${statusDot(item.status)}
                <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text, #e2e8f0);">
                  ${item.task}
                </span>
                ${
                  item.cost != null
                    ? html`
                  <span style="
                    font-size: 0.75rem;
                    font-weight: 600;
                    color: var(--text-muted, #94a3b8);
                    white-space: nowrap;
                  ">
                    $${item.cost.toFixed(2)}
                  </span>
                `
                    : nothing
                }
                ${
                  item.completedAt
                    ? html`
                  <span class="muted" style="font-size: 0.75rem; white-space: nowrap;">
                    ${formatAgo(new Date(item.completedAt).getTime())}
                  </span>
                `
                    : nothing
                }
              </div>
            `,
            )}
          </div>
        </div>
      `
          : html`
              <div
                style="
                  padding: 20px;
                  text-align: center;
                  background: var(--bg-hover, #242442);
                  border-radius: 8px;
                  border: 1px dashed var(--border, #2d2d4a);
                "
              >
                <div style="font-size: 2rem; margin-bottom: 8px">📭</div>
                <div class="muted" style="font-size: 0.9rem">
                  No task history yet. This agent hasn't been assigned work.
                </div>
              </div>
            `
      }
    </div>
  `;
}

function renderHealthLegend() {
  const items = [
    { color: "#10b981", label: "Healthy", icon: "●" },
    { color: "#f59e0b", label: "Warning", icon: "●" },
    { color: "#f97316", label: "Degraded", icon: "●" },
    { color: "#ef4444", label: "Critical", icon: "●" },
  ];

  return html`
    <div style="
      display: inline-flex;
      align-items: center;
      gap: 16px;
      padding: 6px 12px;
      background: var(--bg-hover, #242442);
      border: 1px solid var(--border, #2d2d4a);
      border-radius: 8px;
      font-size: 0.8rem;
    ">
      <span class="muted" style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
        Health:
      </span>
      ${items.map(
        (item) => html`
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="color: ${item.color}; font-size: 1rem; line-height: 1;">${item.icon}</span>
          <span style="color: var(--text-muted, #94a3b8);">${item.label}</span>
        </div>
      `,
      )}
    </div>
  `;
}

function drillDownInstanceStatus(status: string): { color: string; label: string } {
  if (status === "running") return { color: "#10b981", label: "Running" };
  if (status === "failed" || status === "error") return { color: "#ef4444", label: "Failed" };
  if (status === "done" || status === "torn_down") return { color: "#6b7280", label: "Done" };
  return { color: "#94a3b8", label: status };
}

function renderDrillDownPanel(props: SwarmViewProps) {
  if (!props.drillDownAgentId) return nothing;

  const agentName = props.selectedAgent?.name ?? props.drillDownAgentId;

  // Use comprehensive drill-down panel if data is available
  if (props.drillDownData || props.drillDownDataLoading || props.drillDownDataError) {
    return html`
      <div style="position: relative; margin-top: 16px;">
        <button
          style="
            position: absolute; top: 12px; right: 12px;
            background: var(--bg-hover, #242442);
            border: 1px solid var(--border, #2d2d4a);
            color: var(--text, #e2e8f0);
            cursor: pointer; font-size: 1.2rem;
            padding: 4px 10px; border-radius: 6px;
            transition: all 0.2s;
            z-index: 10;
          "
          @click=${props.onCloseDrillDown}
          @mouseenter=${(e: any) => {
            e.target.style.background = "var(--border, #2d2d4a)";
          }}
          @mouseleave=${(e: any) => {
            e.target.style.background = "var(--bg-hover, #242442)";
          }}
        >✕</button>
        
        ${renderAgentDrillDown({
          agentId: props.drillDownAgentId,
          data: props.drillDownData,
          loading: props.drillDownDataLoading,
          error: props.drillDownDataError,
          onRefresh: props.onRefreshDrillDown,
        })}
      </div>
    `;
  }

  // Fallback to legacy drill-down panel (instances + logs)
  return html`
    <div class="card drill-down-panel" style="
      margin-top: 16px;
      border: 2px solid var(--border-strong, #3d3d5a);
      position: relative;
    ">
      <button
        style="
          position: absolute; top: 12px; right: 12px;
          background: var(--bg-hover, #242442);
          border: 1px solid var(--border, #2d2d4a);
          color: var(--text, #e2e8f0);
          cursor: pointer; font-size: 1.2rem;
          padding: 4px 10px; border-radius: 6px;
          transition: all 0.2s;
        "
        @click=${props.onCloseDrillDown}
        @mouseenter=${(e: any) => {
          e.target.style.background = "var(--border, #2d2d4a)";
        }}
        @mouseleave=${(e: any) => {
          e.target.style.background = "var(--bg-hover, #242442)";
        }}
      >✕</button>

      <div style="
        font-size: 0.75rem; font-weight: 600;
        color: var(--text-muted, #94a3b8);
        text-transform: uppercase; letter-spacing: 0.5px;
        margin-bottom: 12px;
      ">
        Instances — ${agentName}
      </div>

      ${
        props.drillDownInstancesLoading
          ? html`
              <div class="muted" style="padding: 16px 0">Loading instances...</div>
            `
          : props.drillDownInstancesError
            ? html`<div class="pill danger">${props.drillDownInstancesError}</div>`
            : props.drillDownInstances.length === 0
              ? html`
                  <div
                    style="
                      padding: 24px;
                      text-align: center;
                      background: var(--bg-hover, #242442);
                      border-radius: 8px;
                      border: 1px dashed var(--border, #2d2d4a);
                    "
                  >
                    <div style="font-size: 2rem; margin-bottom: 8px">📭</div>
                    <div class="muted" style="font-size: 0.9rem">No instances found for this agent.</div>
                  </div>
                `
              : html`
              <div style="display: grid; gap: 4px;">
                ${props.drillDownInstances.map((inst) => {
                  const st = drillDownInstanceStatus(inst.status);
                  const isSelected = inst.instanceId === props.drillDownSelectedInstanceId;
                  return html`
                    <div
                      style="
                        display: grid;
                        grid-template-columns: auto 1fr auto auto auto;
                        align-items: center;
                        gap: 10px;
                        padding: 10px 14px;
                        background: ${isSelected ? "var(--border, #2d2d4a)" : "var(--bg-hover, #242442)"};
                        border: 1px solid ${isSelected ? "var(--border-strong, #3d3d5a)" : "transparent"};
                        border-radius: 6px;
                        cursor: pointer;
                        transition: all 0.15s;
                        font-size: 0.85rem;
                      "
                      @click=${() => props.onSelectInstance(inst.instanceId)}
                      @mouseenter=${(e: any) => {
                        if (!isSelected)
                          e.currentTarget.style.background = "var(--border, #2d2d4a)";
                      }}
                      @mouseleave=${(e: any) => {
                        if (!isSelected)
                          e.currentTarget.style.background = "var(--bg-hover, #242442)";
                      }}
                    >
                      <span style="
                        display: inline-block; width: 8px; height: 8px;
                        border-radius: 50%; background: ${st.color};
                        ${inst.status === "running" ? "animation: pulse 2s infinite;" : ""}
                        flex-shrink: 0;
                      "></span>
                      <div style="min-width: 0; overflow: hidden;">
                        <div style="
                          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                          color: var(--text, #e2e8f0);
                        ">
                          ${inst.assignedTask ?? "—"}
                        </div>
                        <code style="font-size: 0.72rem; color: var(--text-muted, #94a3b8);">
                          ${inst.instanceId}
                        </code>
                      </div>
                      <span class="pill" style="font-size: 0.7rem;">${st.label}</span>
                      <span style="
                        font-size: 0.78rem; font-weight: 600;
                        color: ${inst.cost > 0 ? "#f59e0b" : "var(--text-muted, #94a3b8)"};
                        white-space: nowrap;
                      ">
                        $${inst.cost.toFixed(2)}
                      </span>
                      <span class="muted" style="font-size: 0.72rem; white-space: nowrap;">
                        ${inst.spawnedAt ? formatAgo(new Date(inst.spawnedAt).getTime()) : "—"}
                      </span>
                    </div>
                  `;
                })}
              </div>
            `
      }

      ${
        props.drillDownSelectedInstanceId
          ? html`
          <div style="margin-top: 16px;">
            <div style="
              font-size: 0.75rem; font-weight: 600;
              color: var(--text-muted, #94a3b8);
              text-transform: uppercase; letter-spacing: 0.5px;
              margin-bottom: 8px;
            ">
              Logs — ${props.drillDownSelectedInstanceId}
            </div>
            ${
              props.drillDownLogsLoading
                ? html`
                    <div class="muted" style="padding: 12px 0">Loading logs...</div>
                  `
                : props.drillDownLogs == null
                  ? html`
                      <div
                        style="
                          padding: 16px;
                          text-align: center;
                          background: var(--bg-hover, #242442);
                          border-radius: 8px;
                          border: 1px dashed var(--border, #2d2d4a);
                        "
                      >
                        <div class="muted" style="font-size: 0.9rem">No logs available.</div>
                      </div>
                    `
                  : html`
                  <pre style="
                    margin: 0; padding: 14px;
                    background: var(--panel, #0f0f23);
                    border: 1px solid var(--border, #2d2d4a);
                    border-radius: 6px;
                    font-size: 0.78rem; line-height: 1.5;
                    color: var(--text, #e2e8f0);
                    max-height: 400px; overflow: auto;
                    white-space: pre-wrap; word-break: break-all;
                  ">${props.drillDownLogs}</pre>
                `
            }
          </div>
        `
          : nothing
      }
    </div>
  `;
}

export function renderSwarm(props: SwarmViewProps) {
  const hierarchy = props.hierarchy;
  const snapshot = props.snapshot;
  const lastUpdated = snapshot?.fetchedAt ? formatAgo(snapshot.fetchedAt) : "n/a";

  return html`
    <style>
      @keyframes pulse {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.4;
        }
      }
      
      @keyframes progress-pulse {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }
      
      @keyframes instance-glow {
        0%, 100% { box-shadow: 0 0 8px #10b98130; }
        50% { box-shadow: 0 0 16px #10b98150; }
      }

      /* Agent card hover effects */
      .agent-card {
        position: relative;
      }
      
      .agent-card:hover {
        border-color: var(--border-strong, #3d3d5a);
        background: var(--bg-hover, #242442);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
      
      .agent-card:active {
        transform: translateY(0);
      }
      
      /* Light mode overrides */
      [data-theme="light"] .agent-card:hover {
        background: #f9fafb;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      }
      
      [data-theme="light"] .agent-detail-panel {
        background: #ffffff;
      }

      [data-theme="light"] .drill-down-panel {
        background: #ffffff;
      }
      
      /* Mobile responsiveness */
      @media (max-width: 768px) {
        .agent-card {
          padding: 10px 12px !important;
        }
        
        .agent-detail-panel {
          padding: 12px !important;
        }
        
        .agent-detail-panel h3 {
          font-size: 1.1rem !important;
        }
        
        /* Stack stats on mobile */
        .agent-detail-panel > div:nth-child(3) {
          grid-template-columns: repeat(2, 1fr) !important;
        }
        
        /* Health legend responsiveness */
        @media (max-width: 640px) {
          .health-legend {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 8px !important;
          }
        }
      }
    </style>

    <div class="card">
      <div class="card-title">🏢 Agent Hierarchy</div>
      <div class="card-sub">
        Live view of the agent organization. Color-coded borders indicate agent health status.
      </div>
      <div style="margin-top: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <span class="muted">Updated ${lastUpdated}</span>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>Refresh</button>
        ${renderHealthLegend()}
      </div>
      ${
        props.error
          ? html`<div class="pill danger" style="margin-top: 12px">${props.error}</div>`
          : nothing
      }
    </div>

    ${
      hierarchy?.root
        ? html`<div style="margin-top: 16px;">${renderAgentNode(hierarchy.root, 0, (id: string) => {
            props.onSelectAgent(id);
            props.onOpenDrillDown(id);
          })}</div>`
        : html`
            <div class="card" style="margin-top: 16px; text-align: center; padding: 32px 20px">
              <div style="font-size: 3rem; margin-bottom: 12px">🏗️</div>
              <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 8px; color: var(--text, #e2e8f0)">
                No Agent Team Yet
              </div>
              <div class="muted" style="max-width: 500px; margin: 0 auto; line-height: 1.6">
                Create an
                <code style="padding: 2px 6px; background: var(--bg-hover, #242442); border-radius: 4px"
                  >agents/</code
                >
                directory in your workspace to define agent identities. Each agent gets their own profile with
                permissions, specialty, and autonomy level.
              </div>
            </div>
          `
    }

    ${
      props.selectedAgentLoading
        ? html`
            <div class="card" style="margin-top: 16px"><div class="muted">Loading agent details...</div></div>
          `
        : props.selectedAgent
          ? renderAgentDetail(props.selectedAgent, () => {
              props.onCloseAgent();
              props.onCloseDrillDown();
            })
          : nothing
    }

    ${renderDrillDownPanel(props)}

    ${
      snapshot && snapshot.swarms.length > 0
        ? html`
          <div style="margin-top: 24px;">
            <div class="card">
              <div class="card-title">🐝 Active Swarms</div>
              <div class="card-sub">
                ${snapshot.totalWorkers} total workers · ${snapshot.activeWorkers} currently running
              </div>
            </div>
            <div style="margin-top: 12px;">
              ${snapshot.swarms.map((group) => renderSwarmGroup(group))}
            </div>
          </div>
        `
        : html`
            <div class="card" style="margin-top: 16px; text-align: center; padding: 32px 20px">
              <div style="font-size: 3rem; margin-bottom: 12px">🐝</div>
              <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 8px; color: var(--text, #e2e8f0)">
                No Active Swarms
              </div>
              <div class="muted" style="max-width: 500px; margin: 0 auto; line-height: 1.6">
                Swarms are parallel work sessions where multiple agents tackle different tasks simultaneously.
                The manager can spawn swarms to work on independent subtasks in separate worktrees.
                <br /><br />
                Click any agent above to view their details, assigned work, and history.
              </div>
            </div>
          `
    }
  `;
}
