/**
 * Agency Agent Metrics View for OpenClaw
 *
 * Performance analytics per agent: success rates, costs, response times.
 * Identifies high-performing agents and opportunities for optimization.
 */

import { html, nothing } from "lit";

// ============================================================================
// Types
// ============================================================================

export type AgentStats = {
  agent_id: string;
  total_runs: number;
  total_cost: number;
  avg_cost: number;
  success_rate: number;
  completed: number;
  failed: number;
};

export type AgentMetricsProps = {
  agents: AgentStats[];
  loading: boolean;
  error: string | null;
  sortBy: "runs" | "cost" | "success";
  onChangeSort: (sort: "runs" | "cost" | "success") => void;
  onSelectAgent: (agentId: string) => void;
  onRefresh: () => void;
};

// ============================================================================
// Configuration
// ============================================================================

const AGENCY_API_URL = (window as any).AGENCY_API_URL || "http://localhost:8765";

// ============================================================================
// Helpers
// ============================================================================

function formatCurrency(amount: number): string {
  if (amount < 0.01) return "<$0.01";
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function getSuccessColor(rate: number): string {
  if (rate >= 0.9) return "#10b981"; // green
  if (rate >= 0.7) return "#f59e0b"; // yellow
  return "#ef4444"; // red
}

function getRank(index: number): string {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return `#${index + 1}`;
}

function sortAgents(agents: AgentStats[], by: string): AgentStats[] {
  return [...agents].sort((a, b) => {
    switch (by) {
      case "runs":
        return b.total_runs - a.total_runs;
      case "cost":
        return b.total_cost - a.total_cost;
      case "success":
        return b.success_rate - a.success_rate;
      default:
        return 0;
    }
  });
}

// ============================================================================
// Components
// ============================================================================

function renderSummaryCards(agents: AgentStats[]) {
  const totalRuns = agents.reduce((s, a) => s + a.total_runs, 0);
  const totalCost = agents.reduce((s, a) => s + a.total_cost, 0);
  const totalCompleted = agents.reduce((s, a) => s + a.completed, 0);
  const totalFailed = agents.reduce((s, a) => s + a.failed, 0);
  const overallSuccess = totalRuns > 0 ? totalCompleted / totalRuns : 0;
  const avgCostPerRun = totalRuns > 0 ? totalCost / totalRuns : 0;

  return html`
    <div class="metrics-summary">
      <div class="metrics-card">
        <div class="metrics-card-icon">🤖</div>
        <div class="metrics-card-value">${agents.length}</div>
        <div class="metrics-card-label">Active Agents</div>
      </div>
      <div class="metrics-card">
        <div class="metrics-card-icon">📊</div>
        <div class="metrics-card-value">${totalRuns}</div>
        <div class="metrics-card-label">Total Runs</div>
      </div>
      <div class="metrics-card">
        <div class="metrics-card-icon">✅</div>
        <div class="metrics-card-value" style="color: ${getSuccessColor(overallSuccess)}">
          ${formatPercent(overallSuccess)}
        </div>
        <div class="metrics-card-label">Success Rate</div>
      </div>
      <div class="metrics-card">
        <div class="metrics-card-icon">💰</div>
        <div class="metrics-card-value">${formatCurrency(totalCost)}</div>
        <div class="metrics-card-label">Total Cost</div>
      </div>
      <div class="metrics-card">
        <div class="metrics-card-icon">📈</div>
        <div class="metrics-card-value">${formatCurrency(avgCostPerRun)}</div>
        <div class="metrics-card-label">Avg Cost/Run</div>
      </div>
    </div>
  `;
}

function renderSuccessBar(completed: number, failed: number) {
  const total = completed + failed;
  if (total === 0)
    return html`
      <div class="metrics-bar-empty">No data</div>
    `;

  const successPct = (completed / total) * 100;
  const failPct = (failed / total) * 100;

  return html`
    <div class="metrics-bar">
      <div
        class="metrics-bar-success"
        style="width: ${successPct}%"
        title="${completed} completed"
      ></div>
      <div
        class="metrics-bar-fail"
        style="width: ${failPct}%"
        title="${failed} failed"
      ></div>
    </div>
  `;
}

function renderAgentRow(agent: AgentStats, index: number, onSelect: (id: string) => void) {
  return html`
    <div class="metrics-row" @click=${() => onSelect(agent.agent_id)}>
      <div class="metrics-row-rank">${getRank(index)}</div>
      <div class="metrics-row-agent">
        <span class="metrics-agent-name">${agent.agent_id}</span>
      </div>
      <div class="metrics-row-runs">${agent.total_runs}</div>
      <div class="metrics-row-success" style="color: ${getSuccessColor(agent.success_rate)}">
        ${formatPercent(agent.success_rate)}
      </div>
      <div class="metrics-row-bar">${renderSuccessBar(agent.completed, agent.failed)}</div>
      <div class="metrics-row-cost">${formatCurrency(agent.total_cost)}</div>
      <div class="metrics-row-avgcost">${formatCurrency(agent.avg_cost)}</div>
    </div>
  `;
}

function renderLeaderboard(
  agents: AgentStats[],
  sortBy: string,
  onChangeSort: (s: "runs" | "cost" | "success") => void,
  onSelect: (id: string) => void,
) {
  const sorted = sortAgents(agents, sortBy);

  return html`
    <div class="metrics-leaderboard">
      <div class="metrics-header-row">
        <div class="metrics-header-rank">#</div>
        <div class="metrics-header-agent">Agent</div>
        <div
          class="metrics-header-runs metrics-header-sortable ${sortBy === "runs" ? "active" : ""}"
          @click=${() => onChangeSort("runs")}
        >
          Runs ${sortBy === "runs" ? "▼" : ""}
        </div>
        <div
          class="metrics-header-success metrics-header-sortable ${sortBy === "success" ? "active" : ""}"
          @click=${() => onChangeSort("success")}
        >
          Success ${sortBy === "success" ? "▼" : ""}
        </div>
        <div class="metrics-header-bar">Results</div>
        <div
          class="metrics-header-cost metrics-header-sortable ${sortBy === "cost" ? "active" : ""}"
          @click=${() => onChangeSort("cost")}
        >
          Total ${sortBy === "cost" ? "▼" : ""}
        </div>
        <div class="metrics-header-avgcost">Avg/Run</div>
      </div>
      <div class="metrics-rows">
        ${sorted.map((agent, i) => renderAgentRow(agent, i, onSelect))}
      </div>
    </div>
  `;
}

function renderTopPerformers(agents: AgentStats[]) {
  // Get top 3 by different metrics
  const bySuccess = [...agents]
    .filter((a) => a.total_runs >= 5)
    .sort((a, b) => b.success_rate - a.success_rate)
    .slice(0, 3);

  const byCostEfficiency = [...agents]
    .filter((a) => a.total_runs >= 5 && a.success_rate >= 0.7)
    .sort((a, b) => a.avg_cost - b.avg_cost)
    .slice(0, 3);

  const byVolume = [...agents].sort((a, b) => b.total_runs - a.total_runs).slice(0, 3);

  return html`
    <div class="metrics-top-performers">
      <div class="metrics-top-section">
        <div class="metrics-top-title">🏆 Most Reliable</div>
        <div class="metrics-top-list">
          ${
            bySuccess.length === 0
              ? html`
                  <div class="muted">Need 5+ runs</div>
                `
              : bySuccess.map(
                  (a) => html`
                  <div class="metrics-top-item">
                    <span class="metrics-top-name">${a.agent_id}</span>
                    <span class="metrics-top-stat" style="color: ${getSuccessColor(a.success_rate)}">
                      ${formatPercent(a.success_rate)}
                    </span>
                  </div>
                `,
                )
          }
        </div>
      </div>

      <div class="metrics-top-section">
        <div class="metrics-top-title">💎 Most Efficient</div>
        <div class="metrics-top-list">
          ${
            byCostEfficiency.length === 0
              ? html`
                  <div class="muted">Need 5+ runs with 70%+ success</div>
                `
              : byCostEfficiency.map(
                  (a) => html`
                  <div class="metrics-top-item">
                    <span class="metrics-top-name">${a.agent_id}</span>
                    <span class="metrics-top-stat">${formatCurrency(a.avg_cost)}/run</span>
                  </div>
                `,
                )
          }
        </div>
      </div>

      <div class="metrics-top-section">
        <div class="metrics-top-title">⚡ Highest Volume</div>
        <div class="metrics-top-list">
          ${byVolume.map(
            (a) => html`
              <div class="metrics-top-item">
                <span class="metrics-top-name">${a.agent_id}</span>
                <span class="metrics-top-stat">${a.total_runs} runs</span>
              </div>
            `,
          )}
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// Main Render
// ============================================================================

export function renderAgencyMetrics(props: AgentMetricsProps) {
  const { agents, loading, error, sortBy, onChangeSort, onSelectAgent, onRefresh } = props;

  return html`
    <style>
      .metrics-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }

      .metrics-refresh-btn {
        padding: 6px 12px;
        background: var(--bg-hover, #242442);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 6px;
        color: var(--text, #e2e8f0);
        font-size: 0.8rem;
        cursor: pointer;
      }

      .metrics-refresh-btn:hover {
        background: var(--border, #2d2d4a);
      }

      .metrics-summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
        margin-bottom: 20px;
      }

      .metrics-card {
        background: var(--panel, #0f0f23);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 8px;
        padding: 16px;
        text-align: center;
      }

      .metrics-card-icon {
        font-size: 1.5rem;
        margin-bottom: 8px;
      }

      .metrics-card-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--text, #e2e8f0);
      }

      .metrics-card-label {
        font-size: 0.75rem;
        color: var(--text-muted, #94a3b8);
        margin-top: 4px;
      }

      .metrics-leaderboard {
        background: var(--panel, #0f0f23);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 8px;
        overflow: hidden;
        margin-bottom: 20px;
      }

      .metrics-header-row,
      .metrics-row {
        display: grid;
        grid-template-columns: 50px 1fr 80px 80px 120px 90px 90px;
        gap: 8px;
        padding: 12px 16px;
        align-items: center;
      }

      .metrics-header-row {
        background: var(--bg-muted, #1a1a2e);
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted, #94a3b8);
        border-bottom: 1px solid var(--border, #2d2d4a);
      }

      .metrics-header-sortable {
        cursor: pointer;
      }

      .metrics-header-sortable:hover {
        color: var(--text, #e2e8f0);
      }

      .metrics-header-sortable.active {
        color: var(--accent, #1f6feb);
      }

      .metrics-row {
        border-bottom: 1px solid var(--border, #2d2d4a);
        cursor: pointer;
        transition: background 0.15s;
      }

      .metrics-row:last-child {
        border-bottom: none;
      }

      .metrics-row:hover {
        background: var(--bg-hover, #242442);
      }

      .metrics-row-rank {
        font-size: 1rem;
        text-align: center;
      }

      .metrics-agent-name {
        font-weight: 600;
        text-transform: capitalize;
      }

      .metrics-row-runs,
      .metrics-row-success,
      .metrics-row-cost,
      .metrics-row-avgcost {
        font-size: 0.85rem;
        text-align: right;
      }

      .metrics-row-bar {
        padding: 0 8px;
      }

      .metrics-bar {
        display: flex;
        height: 8px;
        background: var(--bg-muted, #1a1a2e);
        border-radius: 4px;
        overflow: hidden;
      }

      .metrics-bar-success {
        background: #10b981;
      }

      .metrics-bar-fail {
        background: #ef4444;
      }

      .metrics-bar-empty {
        font-size: 0.7rem;
        color: var(--text-muted, #94a3b8);
      }

      .metrics-top-performers {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
      }

      .metrics-top-section {
        background: var(--panel, #0f0f23);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 8px;
        padding: 16px;
      }

      .metrics-top-title {
        font-size: 0.85rem;
        font-weight: 600;
        margin-bottom: 12px;
      }

      .metrics-top-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .metrics-top-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: var(--bg-muted, #1a1a2e);
        border-radius: 6px;
        font-size: 0.8rem;
      }

      .metrics-top-name {
        text-transform: capitalize;
        font-weight: 500;
      }

      .metrics-top-stat {
        font-weight: 600;
      }

      .metrics-empty {
        text-align: center;
        padding: 40px;
        color: var(--text-muted, #94a3b8);
      }

      .muted {
        color: var(--text-muted, #94a3b8);
        font-size: 0.8rem;
      }
    </style>

    <div class="card">
      <div class="metrics-header">
        <div>
          <div class="card-title">🤖 Agent Performance</div>
          <div class="card-sub">Compare agent reliability, cost efficiency, and volume</div>
        </div>
        <button class="metrics-refresh-btn" @click=${onRefresh}>↻ Refresh</button>
      </div>

      ${error ? html`<div class="pill danger">${error}</div>` : nothing}
    </div>

    ${
      loading
        ? html`
            <div class="card"><div class="muted">Loading metrics...</div></div>
          `
        : agents.length === 0
          ? html`
              <div class="metrics-empty">No agent activity yet</div>
            `
          : html`
            ${renderSummaryCards(agents)}
            ${renderLeaderboard(agents, sortBy, onChangeSort, onSelectAgent)}
            ${renderTopPerformers(agents)}
          `
    }
  `;
}

// ============================================================================
// Data Fetching
// ============================================================================

export async function fetchAgentStats(): Promise<AgentStats[]> {
  try {
    const res = await fetch(`${AGENCY_API_URL}/api/agents/stats`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn("[Agency] Failed to fetch agent stats:", e);
  }
  return [];
}
