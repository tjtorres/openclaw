/**
 * Agency Swarm View for OpenClaw
 *
 * Drop-in replacement for OpenClaw's swarm view that fetches data from Agency.
 * Copy to: ~/Projects/openclaw/ui/src/ui/views/agency-swarm.ts
 *
 * Uses Agency's API at AGENCY_API_URL (default: http://localhost:8765)
 */

import { html, nothing } from "lit";

// ============================================================================
// Types
// ============================================================================

export type AgentInstance = {
  instance_id: string;
  status: string;
  assigned_task: string | null;
  model: string | null;
  cost: number;
  spawned_at: string;
  torn_down_at: string | null;
};

export type SwarmAgentNode = {
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
  recentTasks?: Array<{ task: string; status: string; cost?: number; completedAt?: string }>;
  instances?: AgentInstance[];
  activeCount?: number;
};

export type SwarmHierarchy = {
  root: SwarmAgentNode | null;
  fetchedAt: number;
};

export type SwarmSnapshot = {
  swarms: SwarmGroup[];
  fetchedAt: number;
  hasActiveSwarm: boolean;
  totalWorkers: number;
  activeWorkers: number;
};

export type SwarmGroup = {
  id: string;
  repo: string;
  baseBranch: string;
  createdAt: string;
  status: "active" | "completed" | "failed" | "cancelled";
  workers: SwarmWorker[];
};

export type SwarmWorker = {
  id: string;
  name: string;
  status: string;
  branch?: string | null;
  startedAt?: string | null;
  taskSpec?: string | null;
  swarmId: string;
};

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

export type AgencySwarmProps = {
  loading: boolean;
  error: string | null;
  hierarchy: SwarmHierarchy | null;
  snapshot: SwarmSnapshot | null;
  selectedAgent: AgentDetail | null;
  selectedAgentLoading: boolean;
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
  onCloseAgent: () => void;
};

// ============================================================================
// Configuration
// ============================================================================

const AGENCY_API_URL = (window as any).AGENCY_API_URL || "http://localhost:8765";

// ============================================================================
// Helpers
// ============================================================================

function formatAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type HealthTier = "healthy" | "warning" | "degraded" | "critical" | "archived";

function getHealthTier(status: string): { tier: HealthTier; color: string; label: string } {
  const healthMap: Record<string, { tier: HealthTier; color: string; label: string }> = {
    active: { tier: "healthy", color: "#10b981", label: "Healthy" },
    working: { tier: "healthy", color: "#10b981", label: "Working" },
    running: { tier: "healthy", color: "#10b981", label: "Running" },
    done: { tier: "healthy", color: "#10b981", label: "Done" },
    completed: { tier: "healthy", color: "#10b981", label: "Done" },
    idle: { tier: "warning", color: "#f59e0b", label: "Idle" },
    pending: { tier: "warning", color: "#94a3b8", label: "Pending" },
    failed: { tier: "critical", color: "#ef4444", label: "Failed" },
    archived: { tier: "archived", color: "#6b7280", label: "Archived" },
  };
  return healthMap[status] ?? { tier: "warning", color: "#94a3b8", label: "Unknown" };
}

function statusDot(status: string) {
  const health = getHealthTier(status);
  const pulse = ["active", "working", "running"].includes(status);
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
    <div style="
      height: 6px;
      background: var(--bg-hover, #242442);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 4px;
      width: 100px;
    ">
      <div style="
        height: 100%;
        width: ${pct}%;
        background: ${color};
        border-radius: 3px;
      "></div>
    </div>
  `;
}

// ============================================================================
// Components
// ============================================================================

function renderAgentNode(node: SwarmAgentNode, depth = 0, onSelect?: (id: string) => void) {
  const indent = depth * 24;
  const instances = Array.isArray(node.instances) ? node.instances : [];
  const recentTasks = Array.isArray(node.recentTasks) ? node.recentTasks : [];
  const activeCount = node.activeCount ?? instances.filter((i) => i.status === "running").length;
  const health = getHealthTier(node.status);

  const hasRunning = activeCount > 0;
  const borderColor = hasRunning ? "#10b981" : health.color;
  const borderWidth = hasRunning ? "3px" : "2px";
  const boxShadow = hasRunning
    ? "0 0 12px #10b98140, inset 0 0 0 1px #10b98120"
    : health.tier === "critical"
      ? `0 0 12px ${health.color}40`
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
        "
        @click=${(e: Event) => {
          e.stopPropagation();
          onSelect?.(node.id);
        }}
      >
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--bg-hover, #242442);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.3rem;
            flex-shrink: 0;
          ">
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
                ? html`
              <div style="font-size: 0.8rem; margin-top: 4px; color: var(--text, #e2e8f0);">
                <span style="color: var(--text-muted, #94a3b8);">Working on:</span>
                ${node.currentTask}
              </div>
            `
                : node.specialty
                  ? html`
              <div class="muted" style="font-size: 0.8rem; margin-top: 4px;">
                ${node.specialty}
              </div>
            `
                  : nothing
            }

            <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px;">
              <span style="font-size: 0.75rem; color: var(--text-muted, #94a3b8);">
                Trust: ${(node.trustScore * 100).toFixed(0)}%
              </span>
              ${trustBar(node.trustScore)}
            </div>
          </div>
        </div>

        ${
          instances.length > 0
            ? renderInstanceList(instances)
            : recentTasks.length > 0
              ? renderRecentTasks(recentTasks)
              : nothing
        }
      </div>
      ${node.children.map((child) => renderAgentNode(child, depth + 1, onSelect))}
    </div>
  `;
}

function renderInstanceList(instances: AgentInstance[]) {
  const shown = instances.slice(0, 3);
  return html`
    <div style="
      border-top: 1px solid var(--border, #2d2d4a);
      padding-top: 8px;
      margin-top: 2px;
    ">
      <div style="font-size: 0.7rem; color: var(--text-muted, #94a3b8); margin-bottom: 4px; text-transform: uppercase;">
        Active Instances
      </div>
      ${shown.map(
        (inst) => html`
        <div style="
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 3px 0;
          font-size: 0.78rem;
        ">
          ${statusDot(inst.status)}
          <code style="font-size: 0.72rem; color: var(--text-muted);">${inst.instance_id.slice(0, 8)}</code>
          <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${inst.assigned_task ? inst.assigned_task.slice(0, 40) : "—"}
          </span>
          ${
            inst.cost > 0
              ? html`
            <span style="font-size: 0.7rem; color: #f59e0b;">$${inst.cost.toFixed(3)}</span>
          `
              : nothing
          }
        </div>
      `,
      )}
      ${
        instances.length > 3
          ? html`
        <div style="font-size: 0.7rem; color: var(--text-muted); padding-top: 2px;">
          +${instances.length - 3} more
        </div>
      `
          : nothing
      }
    </div>
  `;
}

function renderRecentTasks(tasks: Array<{ task: string; status: string; completedAt?: string }>) {
  return html`
    <div style="
      border-top: 1px solid var(--border, #2d2d4a);
      padding-top: 8px;
      margin-top: 2px;
    ">
      <div style="font-size: 0.7rem; color: var(--text-muted, #94a3b8); margin-bottom: 4px; text-transform: uppercase;">
        Recent Tasks
      </div>
      ${tasks.slice(0, 3).map(
        (task) => html`
        <div style="
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 3px 0;
          font-size: 0.78rem;
        ">
          ${statusDot(task.status)}
          <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${task.task.slice(0, 50)}
          </span>
        </div>
      `,
      )}
    </div>
  `;
}

function renderAgentDetail(agent: AgentDetail, onClose: () => void) {
  const trustPct = Math.round(agent.trustScore * 100);
  const trustColor = trustPct >= 80 ? "#10b981" : trustPct >= 60 ? "#f59e0b" : "#ef4444";
  const total = agent.tasksCompleted + agent.tasksFailed;
  const successRate = total > 0 ? Math.round((agent.tasksCompleted / total) * 100) : 0;

  return html`
    <div class="card agent-detail-panel" style="margin-top: 16px; position: relative; border: 2px solid var(--border-strong, #3d3d5a);">
      <button
        style="
          position: absolute; top: 12px; right: 12px;
          background: var(--bg-hover, #242442);
          border: 1px solid var(--border, #2d2d4a);
          color: var(--text, #e2e8f0);
          cursor: pointer; font-size: 1.2rem;
          padding: 4px 10px; border-radius: 6px;
        "
        @click=${onClose}
      >✕</button>

      <!-- Header -->
      <div style="display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px; padding-right: 40px;">
        <div style="
          width: 56px; height: 56px;
          border-radius: 50%;
          background: var(--bg-hover, #242442);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.8rem;
        ">🤖</div>
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            ${statusDot(agent.status)}
            <h3 style="margin: 0; font-size: 1.2rem;">${agent.name}</h3>
          </div>
          <div class="muted" style="font-size: 0.9rem;">${agent.level} ${agent.role}</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 2rem; font-weight: 700; color: ${trustColor};">${trustPct}%</div>
          <div class="muted" style="font-size: 0.75rem;">TRUST</div>
        </div>
      </div>

      <!-- Stats Grid -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px;">
        <div style="padding: 12px; background: var(--bg-hover); border-radius: 8px; text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700; color: #10b981;">${agent.tasksCompleted}</div>
          <div class="muted" style="font-size: 0.75rem;">COMPLETED</div>
        </div>
        <div style="padding: 12px; background: var(--bg-hover); border-radius: 8px; text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700; color: #ef4444;">${agent.tasksFailed}</div>
          <div class="muted" style="font-size: 0.75rem;">FAILED</div>
        </div>
        <div style="padding: 12px; background: var(--bg-hover); border-radius: 8px; text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700;">${successRate}%</div>
          <div class="muted" style="font-size: 0.75rem;">SUCCESS</div>
        </div>
        <div style="padding: 12px; background: var(--bg-hover); border-radius: 8px; text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700; color: #f59e0b;">$${agent.totalCost.toFixed(2)}</div>
          <div class="muted" style="font-size: 0.75rem;">COST</div>
        </div>
      </div>

      <!-- Current Work -->
      ${
        agent.currentTask
          ? html`
        <div style="margin-bottom: 20px;">
          <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase;">
            🔨 Current Work
          </div>
          <div style="
            padding: 12px;
            background: var(--bg-hover);
            border-left: 4px solid #10b981;
            border-radius: 6px;
          ">${agent.currentTask}</div>
        </div>
      `
          : nothing
      }

      <!-- Recent History -->
      ${
        agent.recentHistory.length > 0
          ? html`
        <div>
          <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase;">
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
                background: var(--bg-hover);
                font-size: 0.85rem;
              ">
                ${statusDot(item.status)}
                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis;">${item.task}</span>
                ${
                  item.cost != null
                    ? html`
                  <span style="font-size: 0.75rem; color: var(--text-muted);">$${item.cost.toFixed(2)}</span>
                `
                    : nothing
                }
              </div>
            `,
            )}
          </div>
        </div>
      `
          : nothing
      }
    </div>
  `;
}

function renderSwarmGroup(group: SwarmGroup) {
  const running = group.workers.filter((w) => w.status === "running").length;
  const done = group.workers.filter((w) => ["done", "completed"].includes(w.status)).length;
  const total = group.workers.length;

  return html`
    <div class="card" style="margin-bottom: 12px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div>
          <strong>🐝 Swarm: ${group.id.slice(0, 8)}</strong>
          <span class="muted" style="margin-left: 8px; font-size: 0.85rem;">
            ${group.repo} @ ${group.baseBranch}
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="pill" style="font-size: 0.7rem; background: #238636; color: #fff;">
            ${group.status}
          </span>
          <span class="muted" style="font-size: 0.8rem;">
            ${done}/${total} done ${running > 0 ? `· ${running} running` : ""}
          </span>
        </div>
      </div>

      <div style="margin-top: 12px; display: grid; gap: 6px;">
        ${group.workers.map(
          (worker) => html`
          <div style="
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: var(--bg-hover, #1a1a2e);
            border-radius: 6px;
          ">
            ${statusDot(worker.status)}
            <span style="flex: 1; font-size: 0.9rem;">${worker.name}</span>
            ${worker.branch ? html`<code style="font-size: 0.75rem;">${worker.branch}</code>` : nothing}
            <span class="pill" style="font-size: 0.7rem;">${worker.status}</span>
          </div>
        `,
        )}
      </div>
    </div>
  `;
}

// ============================================================================
// Main Render
// ============================================================================

export function renderAgencySwarm(props: AgencySwarmProps) {
  const { hierarchy, snapshot, error, loading, selectedAgent, selectedAgentLoading } = props;
  const lastUpdated = hierarchy?.fetchedAt ? formatAgo(hierarchy.fetchedAt) : "n/a";

  return html`
    <style>
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }

      .agent-card {
        position: relative;
      }

      .agent-card:hover {
        border-color: var(--border-strong, #3d3d5a);
        background: var(--bg-hover, #242442);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
    </style>

    <div class="card">
      <div class="card-title">🏢 Agency Swarm</div>
      <div class="card-sub">
        Live view of the agent hierarchy. Powered by Agency.
      </div>
      <div style="margin-top: 12px; display: flex; align-items: center; gap: 12px;">
        <span class="muted">Updated ${lastUpdated}</span>
        <button class="btn" ?disabled=${loading} @click=${props.onRefresh}>Refresh</button>
      </div>
      ${error ? html`<div class="pill danger" style="margin-top: 12px">${error}</div>` : nothing}
    </div>

    ${
      hierarchy?.root
        ? html`<div style="margin-top: 16px;">${renderAgentNode(hierarchy.root, 0, props.onSelectAgent)}</div>`
        : html`
            <div class="card" style="margin-top: 16px; text-align: center; padding: 32px 20px">
              <div style="font-size: 3rem; margin-bottom: 12px">🏗️</div>
              <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 8px">No Agents Yet</div>
              <div class="muted" style="max-width: 500px; margin: 0 auto">
                Run some agents using <code>agency run</code> to see them here.
              </div>
            </div>
          `
    }

    ${
      selectedAgentLoading
        ? html`
            <div class="card" style="margin-top: 16px"><div class="muted">Loading agent details...</div></div>
          `
        : selectedAgent
          ? renderAgentDetail(selectedAgent, props.onCloseAgent)
          : nothing
    }

    ${
      snapshot && snapshot.swarms.length > 0
        ? html`
      <div style="margin-top: 24px;">
        <div class="card">
          <div class="card-title">🐝 Active Swarms</div>
          <div class="card-sub">
            ${snapshot.totalWorkers} total workers · ${snapshot.activeWorkers} running
          </div>
        </div>
        <div style="margin-top: 12px;">
          ${snapshot.swarms.map((group) => renderSwarmGroup(group))}
        </div>
      </div>
    `
        : nothing
    }
  `;
}

// ============================================================================
// Data Fetching (Controller)
// ============================================================================

export async function fetchSwarmHierarchy(): Promise<SwarmHierarchy | null> {
  try {
    const res = await fetch(`${AGENCY_API_URL}/api/swarm/hierarchy`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn("[Agency] Failed to fetch hierarchy:", e);
  }
  return null;
}

export async function fetchSwarmSnapshot(): Promise<SwarmSnapshot | null> {
  try {
    const res = await fetch(`${AGENCY_API_URL}/api/swarm/snapshot`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn("[Agency] Failed to fetch snapshot:", e);
  }
  return null;
}

export async function fetchAgentDetail(agentId: string): Promise<AgentDetail | null> {
  try {
    const res = await fetch(`${AGENCY_API_URL}/api/swarm/agent/${agentId}`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn("[Agency] Failed to fetch agent detail:", e);
  }
  return null;
}
