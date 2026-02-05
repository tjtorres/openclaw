/**
 * Agency Cost Analytics View for OpenClaw
 *
 * Shows cost breakdown, trends, and budget utilization.
 * Helps track spending across agents and identify optimization opportunities.
 */

import { html, nothing } from "lit";

// ============================================================================
// Types
// ============================================================================

export type DailyCost = {
  date: string;
  run_count: number;
  total_cost: number;
  avg_cost: number;
};

export type CostSummary = {
  period_days: number;
  total_cost: number;
  total_runs: number;
  avg_cost_per_run: number;
  daily: DailyCost[];
};

export type AgentCost = {
  agent_id: string;
  total_runs: number;
  total_cost: number;
  avg_cost: number;
  success_rate: number;
};

export type CostAnalyticsProps = {
  loading: boolean;
  error: string | null;
  summary: CostSummary | null;
  agentCosts: AgentCost[];
  onRefresh: () => void;
  periodDays: number;
  onChangePeriod: (days: number) => void;
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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ============================================================================
// Components
// ============================================================================

function renderSparkline(daily: DailyCost[], width = 200, height = 40) {
  if (daily.length < 2) return nothing;

  const maxCost = Math.max(...daily.map((d) => d.total_cost), 0.01);
  const points = daily
    .map((d, i) => {
      const x = (i / (daily.length - 1)) * width;
      const y = height - (d.total_cost / maxCost) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return html`
    <svg width="${width}" height="${height}" style="display: block;">
      <polyline
        points="${points}"
        fill="none"
        stroke="#3b82f6"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      ${daily.map((d, i) => {
        const x = (i / (daily.length - 1)) * width;
        const y = height - (d.total_cost / maxCost) * height;
        return html`
          <circle
            cx="${x}"
            cy="${y}"
            r="3"
            fill="${i === daily.length - 1 ? "#3b82f6" : "#64748b"}"
          />
        `;
      })}
    </svg>
  `;
}

function renderCostBar(cost: number, maxCost: number, color = "#3b82f6") {
  const pct = maxCost > 0 ? (cost / maxCost) * 100 : 0;
  return html`
    <div style="
      height: 8px;
      background: var(--border, #2d2d4a);
      border-radius: 4px;
      overflow: hidden;
      flex: 1;
    ">
      <div style="
        height: 100%;
        width: ${pct}%;
        background: ${color};
        border-radius: 4px;
        transition: width 0.3s;
      "></div>
    </div>
  `;
}

function renderMetricCard(
  label: string,
  value: string,
  subtext: string,
  icon: string,
  color = "var(--text)",
) {
  return html`
    <div class="cost-metric-card">
      <div class="cost-metric-icon">${icon}</div>
      <div class="cost-metric-content">
        <div class="cost-metric-value" style="color: ${color}">${value}</div>
        <div class="cost-metric-label">${label}</div>
        <div class="cost-metric-subtext">${subtext}</div>
      </div>
    </div>
  `;
}

function renderDailyChart(daily: DailyCost[]) {
  if (daily.length === 0) return nothing;

  const maxCost = Math.max(...daily.map((d) => d.total_cost), 0.01);
  const barWidth = 100 / daily.length;

  return html`
    <div class="cost-daily-chart">
      <div class="cost-daily-bars">
        ${daily.map((d) => {
          const heightPct = (d.total_cost / maxCost) * 100;
          return html`
            <div
              class="cost-daily-bar"
              style="width: ${barWidth}%;"
              title="${formatDate(d.date)}: ${formatCurrency(d.total_cost)} (${d.run_count} runs)"
            >
              <div
                class="cost-daily-bar-fill"
                style="height: ${heightPct}%;"
              ></div>
              <div class="cost-daily-bar-label">${formatDate(d.date)}</div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

function renderAgentTable(agents: AgentCost[]) {
  if (agents.length === 0) {
    return html`
      <div class="cost-empty">No agent cost data yet</div>
    `;
  }

  const maxCost = Math.max(...agents.map((a) => a.total_cost), 0.01);
  const sorted = [...agents].sort((a, b) => b.total_cost - a.total_cost);

  return html`
    <div class="cost-agent-table">
      ${sorted.map((agent) => {
        const successColor =
          agent.success_rate >= 0.8 ? "#10b981" : agent.success_rate >= 0.5 ? "#f59e0b" : "#ef4444";

        return html`
          <div class="cost-agent-row">
            <div class="cost-agent-name">
              <span class="cost-agent-emoji">🤖</span>
              ${agent.agent_id.replace(/-/g, " ").replace(/_/g, " ")}
            </div>
            <div class="cost-agent-bar">
              ${renderCostBar(agent.total_cost, maxCost)}
            </div>
            <div class="cost-agent-stats">
              <span class="cost-agent-total">${formatCurrency(agent.total_cost)}</span>
              <span class="cost-agent-runs">${agent.total_runs} runs</span>
              <span
                class="cost-agent-success"
                style="color: ${successColor}"
              >${Math.round(agent.success_rate * 100)}%</span>
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

// ============================================================================
// Main Render
// ============================================================================

export function renderAgencyCosts(props: CostAnalyticsProps) {
  const { summary, agentCosts, loading, error, periodDays } = props;

  return html`
    <style>
      .cost-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      .cost-period-select {
        display: flex;
        gap: 4px;
      }

      .cost-period-btn {
        padding: 6px 12px;
        background: var(--bg-hover, #242442);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 6px;
        color: var(--text, #e2e8f0);
        font-size: 0.8rem;
        cursor: pointer;
        transition: all 0.15s;
      }

      .cost-period-btn:hover {
        background: var(--border, #2d2d4a);
      }

      .cost-period-btn.active {
        background: #1f6feb;
        border-color: #1f6feb;
      }

      .cost-metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-bottom: 20px;
      }

      .cost-metric-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
        background: var(--panel, #0f0f23);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 8px;
      }

      .cost-metric-icon {
        font-size: 1.5rem;
      }

      .cost-metric-value {
        font-size: 1.4rem;
        font-weight: 700;
      }

      .cost-metric-label {
        font-size: 0.75rem;
        text-transform: uppercase;
        color: var(--text-muted, #94a3b8);
        letter-spacing: 0.5px;
      }

      .cost-metric-subtext {
        font-size: 0.7rem;
        color: var(--text-muted, #94a3b8);
        margin-top: 2px;
      }

      .cost-daily-chart {
        padding: 16px;
        background: var(--panel, #0f0f23);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 8px;
        margin-bottom: 20px;
      }

      .cost-daily-bars {
        display: flex;
        align-items: flex-end;
        height: 120px;
        gap: 2px;
      }

      .cost-daily-bar {
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 100%;
      }

      .cost-daily-bar-fill {
        flex: 1;
        width: 80%;
        background: #3b82f6;
        border-radius: 2px 2px 0 0;
        min-height: 2px;
        transition: height 0.3s;
      }

      .cost-daily-bar:hover .cost-daily-bar-fill {
        background: #60a5fa;
      }

      .cost-daily-bar-label {
        font-size: 0.65rem;
        color: var(--text-muted, #94a3b8);
        margin-top: 4px;
        white-space: nowrap;
      }

      .cost-agent-table {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .cost-agent-row {
        display: grid;
        grid-template-columns: 200px 1fr 180px;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        background: var(--bg-muted, #1a1a2e);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 6px;
      }

      .cost-agent-name {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.9rem;
        font-weight: 500;
        text-transform: capitalize;
      }

      .cost-agent-emoji {
        font-size: 1rem;
      }

      .cost-agent-stats {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 0.8rem;
      }

      .cost-agent-total {
        font-weight: 600;
        color: #f59e0b;
      }

      .cost-agent-runs {
        color: var(--text-muted, #94a3b8);
      }

      .cost-agent-success {
        font-weight: 600;
      }

      .cost-empty {
        text-align: center;
        padding: 24px;
        color: var(--text-muted, #94a3b8);
      }

      .cost-section {
        margin-top: 20px;
      }

      .cost-section-title {
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted, #94a3b8);
        margin-bottom: 12px;
      }
    </style>

    <div class="card">
      <div class="cost-header">
        <div>
          <div class="card-title">💰 Cost Analytics</div>
          <div class="card-sub">Track spending and identify optimization opportunities</div>
        </div>
        <div class="cost-period-select">
          ${[7, 14, 30].map(
            (days) => html`
              <button
                class="cost-period-btn ${periodDays === days ? "active" : ""}"
                @click=${() => props.onChangePeriod(days)}
              >
                ${days}d
              </button>
            `,
          )}
          <button class="cost-period-btn" @click=${props.onRefresh}>↻</button>
        </div>
      </div>

      ${error ? html`<div class="pill danger">${error}</div>` : nothing}
    </div>

    ${
      summary
        ? html`
          <div class="cost-metrics">
            ${renderMetricCard(
              "Total Spent",
              formatCurrency(summary.total_cost),
              `Last ${summary.period_days} days`,
              "💵",
              "#f59e0b",
            )}
            ${renderMetricCard(
              "Total Runs",
              summary.total_runs.toString(),
              `${(summary.total_runs / summary.period_days).toFixed(1)}/day avg`,
              "🚀",
              "#3b82f6",
            )}
            ${renderMetricCard(
              "Avg Cost/Run",
              formatCurrency(summary.avg_cost_per_run),
              "Per execution",
              "📊",
              "#10b981",
            )}
            ${renderMetricCard(
              "Efficiency",
              summary.total_runs > 0
                ? `${((summary.total_cost / summary.total_runs) * 100).toFixed(0)}¢`
                : "N/A",
              "Cost per run",
              "⚡",
            )}
          </div>

          <div class="cost-section">
            <div class="cost-section-title">📈 Daily Spending</div>
            ${renderDailyChart(summary.daily)}
          </div>
        `
        : loading
          ? html`
              <div class="card"><div class="muted">Loading cost data...</div></div>
            `
          : html`
              <div class="card"><div class="muted">No cost data available</div></div>
            `
    }

    <div class="cost-section">
      <div class="cost-section-title">🤖 Cost by Agent</div>
      ${renderAgentTable(agentCosts)}
    </div>
  `;
}

// ============================================================================
// Data Fetching
// ============================================================================

export async function fetchCostSummary(days = 7): Promise<CostSummary | null> {
  try {
    const res = await fetch(`${AGENCY_API_URL}/api/costs/summary?days=${days}`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn("[Agency] Failed to fetch cost summary:", e);
  }
  return null;
}

export async function fetchAgentCosts(): Promise<AgentCost[]> {
  try {
    const res = await fetch(`${AGENCY_API_URL}/api/agents/stats`);
    if (res.ok) {
      const stats = await res.json();
      return stats.map((s: any) => ({
        agent_id: s.agent_id,
        total_runs: s.total_runs,
        total_cost: s.total_cost,
        avg_cost: s.avg_cost,
        success_rate: s.success_rate,
      }));
    }
  } catch (e) {
    console.warn("[Agency] Failed to fetch agent costs:", e);
  }
  return [];
}
