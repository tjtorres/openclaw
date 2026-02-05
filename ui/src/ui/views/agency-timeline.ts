/**
 * Agency Timeline View for OpenClaw
 *
 * Visualizes agent runs and tool calls on a timeline.
 * Shows hierarchical execution, parallelism, and duration.
 */

import { html, nothing } from "lit";

// ============================================================================
// Types
// ============================================================================

export type TimelineRun = {
  id: string;
  agent_id: string;
  goal: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  parent_id: string | null;
  started_at: string;
  ended_at: string | null;
  depth: number;
};

export type TimelineToolCall = {
  run_id: string;
  tool: string;
  timestamp: string;
  status: string;
  duration_ms: number;
};

export type TimelineData = {
  runs: TimelineRun[];
  tool_calls: TimelineToolCall[];
  period_hours: number;
  fetchedAt: string;
};

export type TimelineProps = {
  data: TimelineData | null;
  loading: boolean;
  error: string | null;
  selectedRunId: string | null;
  onSelectRun: (runId: string | null) => void;
  periodHours: number;
  onChangePeriod: (hours: number) => void;
  onRefresh: () => void;
};

// ============================================================================
// Configuration
// ============================================================================

const AGENCY_API_URL = (window as any).AGENCY_API_URL || "http://localhost:8765";

const STATUS_COLORS: Record<string, string> = {
  pending: "#6b7280",
  running: "#3b82f6",
  completed: "#10b981",
  failed: "#ef4444",
  cancelled: "#f59e0b",
};

// ============================================================================
// Helpers
// ============================================================================

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function getRunDuration(run: TimelineRun): number {
  const start = new Date(run.started_at).getTime();
  const end = run.ended_at ? new Date(run.ended_at).getTime() : Date.now();
  return end - start;
}

function getTimeRange(runs: TimelineRun[]): { min: number; max: number } {
  if (runs.length === 0) {
    const now = Date.now();
    return { min: now - 3600000, max: now };
  }

  const starts = runs.map((r) => new Date(r.started_at).getTime());
  const ends = runs.filter((r) => r.ended_at).map((r) => new Date(r.ended_at!).getTime());

  const min = Math.min(...starts);
  const max = Math.max(...starts, ...ends, Date.now());

  return { min, max };
}

// ============================================================================
// Components
// ============================================================================

function renderLegend() {
  return html`
    <div class="timeline-legend">
      ${Object.entries(STATUS_COLORS).map(
        ([status, color]) => html`
          <div class="timeline-legend-item">
            <span class="timeline-legend-dot" style="background: ${color}"></span>
            <span class="timeline-legend-label">${status}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderTimeAxis(minTime: number, maxTime: number) {
  const duration = maxTime - minTime;
  const tickCount = 6;
  const ticks = [];

  for (let i = 0; i <= tickCount; i++) {
    const time = minTime + (duration / tickCount) * i;
    const pct = (i / tickCount) * 100;
    ticks.push({ time, pct });
  }

  return html`
    <div class="timeline-axis">
      ${ticks.map(
        (tick) => html`
          <div class="timeline-tick" style="left: ${tick.pct}%">
            <div class="timeline-tick-line"></div>
            <div class="timeline-tick-label">
              ${formatTime(new Date(tick.time).toISOString())}
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderRunBar(
  run: TimelineRun,
  minTime: number,
  maxTime: number,
  isSelected: boolean,
  onSelect: (id: string) => void,
) {
  const duration = maxTime - minTime;
  if (duration <= 0) return nothing;

  const startTime = new Date(run.started_at).getTime();
  const endTime = run.ended_at ? new Date(run.ended_at).getTime() : Date.now();

  const left = ((startTime - minTime) / duration) * 100;
  const width = ((endTime - startTime) / duration) * 100;

  const color = STATUS_COLORS[run.status] || STATUS_COLORS.pending;
  const runDuration = getRunDuration(run);

  return html`
    <div
      class="timeline-run ${isSelected ? "selected" : ""}"
      style="
        margin-left: ${run.depth * 20}px;
      "
      @click=${() => onSelect(run.id)}
    >
      <div class="timeline-run-label">
        <span class="timeline-run-agent">${run.agent_id}</span>
        <span class="timeline-run-goal">${run.goal?.slice(0, 40) || "..."}</span>
      </div>
      <div class="timeline-run-track">
        <div
          class="timeline-run-bar"
          style="
            left: ${left}%;
            width: ${Math.max(width, 0.5)}%;
            background: ${color};
          "
          title="${run.goal}\nDuration: ${formatDuration(runDuration)}"
        >
          ${
            run.status === "running"
              ? html`
                  <span class="timeline-run-pulse"></span>
                `
              : nothing
          }
        </div>
      </div>
      <div class="timeline-run-duration">
        ${formatDuration(runDuration)}
      </div>
    </div>
  `;
}

function renderToolCalls(tools: TimelineToolCall[], minTime: number, maxTime: number) {
  if (tools.length === 0) return nothing;

  const duration = maxTime - minTime;
  if (duration <= 0) return nothing;

  return html`
    <div class="timeline-tools-section">
      <div class="timeline-section-title">🔧 Tool Calls</div>
      <div class="timeline-tools-track">
        ${tools.slice(0, 50).map((tool) => {
          const time = new Date(tool.timestamp).getTime();
          const left = ((time - minTime) / duration) * 100;
          const color = tool.status === "ok" ? "#10b981" : "#ef4444";

          return html`
            <div
              class="timeline-tool-marker"
              style="left: ${left}%"
              title="${tool.tool}: ${tool.status} (${formatDuration(tool.duration_ms)})"
            >
              <div
                class="timeline-tool-dot"
                style="background: ${color}"
              ></div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

function renderRunDetails(run: TimelineRun, tools: TimelineToolCall[]) {
  const runTools = tools.filter((t) => t.run_id === run.id);

  return html`
    <div class="timeline-details">
      <div class="timeline-details-header">
        <span class="timeline-details-status" style="background: ${STATUS_COLORS[run.status]}">
          ${run.status}
        </span>
        <span class="timeline-details-agent">${run.agent_id}</span>
      </div>
      <div class="timeline-details-goal">${run.goal}</div>
      <div class="timeline-details-meta">
        <div>Started: ${formatTime(run.started_at)}</div>
        ${
          run.ended_at
            ? html`<div>Ended: ${formatTime(run.ended_at)}</div>`
            : html`
                <div>Running...</div>
              `
        }
        <div>Duration: ${formatDuration(getRunDuration(run))}</div>
        <div>Depth: ${run.depth}</div>
      </div>
      ${
        runTools.length > 0
          ? html`
            <div class="timeline-details-tools">
              <div class="timeline-section-title">Tools (${runTools.length})</div>
              <div class="timeline-details-tool-list">
                ${runTools.slice(0, 10).map(
                  (t) => html`
                    <div class="timeline-tool-item">
                      <span class="timeline-tool-name">${t.tool}</span>
                      <span
                        class="timeline-tool-status"
                        style="color: ${t.status === "ok" ? "#10b981" : "#ef4444"}"
                      >${t.status}</span>
                      <span class="timeline-tool-duration">${formatDuration(t.duration_ms)}</span>
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

// ============================================================================
// Main Render
// ============================================================================

export function renderAgencyTimeline(props: TimelineProps) {
  const { data, loading, error, selectedRunId, periodHours } = props;

  const runs = data?.runs || [];
  const tools = data?.tool_calls || [];
  const { min: minTime, max: maxTime } = getTimeRange(runs);

  const selectedRun = selectedRunId ? runs.find((r) => r.id === selectedRunId) : null;

  return html`
    <style>
      .timeline-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }

      .timeline-controls {
        display: flex;
        gap: 4px;
      }

      .timeline-period-btn {
        padding: 6px 12px;
        background: var(--bg-hover, #242442);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 6px;
        color: var(--text, #e2e8f0);
        font-size: 0.8rem;
        cursor: pointer;
      }

      .timeline-period-btn:hover {
        background: var(--border, #2d2d4a);
      }

      .timeline-period-btn.active {
        background: #1f6feb;
        border-color: #1f6feb;
      }

      .timeline-legend {
        display: flex;
        gap: 16px;
        margin-bottom: 12px;
      }

      .timeline-legend-item {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.75rem;
        color: var(--text-muted, #94a3b8);
      }

      .timeline-legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }

      .timeline-container {
        display: grid;
        grid-template-columns: ${selectedRun ? "1fr 300px" : "1fr"};
        gap: 16px;
      }

      .timeline-main {
        background: var(--panel, #0f0f23);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 8px;
        padding: 16px;
        overflow-x: auto;
      }

      .timeline-axis {
        position: relative;
        height: 24px;
        margin-bottom: 8px;
        margin-left: 200px;
      }

      .timeline-tick {
        position: absolute;
        transform: translateX(-50%);
      }

      .timeline-tick-line {
        width: 1px;
        height: 8px;
        background: var(--border, #2d2d4a);
      }

      .timeline-tick-label {
        font-size: 0.65rem;
        color: var(--text-muted, #94a3b8);
        white-space: nowrap;
      }

      .timeline-runs {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .timeline-run {
        display: grid;
        grid-template-columns: 180px 1fr 60px;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 4px;
        cursor: pointer;
        transition: background 0.15s;
      }

      .timeline-run:hover {
        background: var(--bg-hover, #242442);
      }

      .timeline-run.selected {
        background: var(--bg-hover, #242442);
        border: 1px solid var(--accent, #1f6feb);
      }

      .timeline-run-label {
        display: flex;
        flex-direction: column;
        gap: 2px;
        overflow: hidden;
      }

      .timeline-run-agent {
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: capitalize;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .timeline-run-goal {
        font-size: 0.7rem;
        color: var(--text-muted, #94a3b8);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .timeline-run-track {
        position: relative;
        height: 20px;
        background: var(--bg-muted, #1a1a2e);
        border-radius: 4px;
        overflow: hidden;
      }

      .timeline-run-bar {
        position: absolute;
        height: 100%;
        border-radius: 4px;
        min-width: 4px;
      }

      .timeline-run-pulse {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        width: 4px;
        background: white;
        animation: pulse 1s infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 1; }
      }

      .timeline-run-duration {
        font-size: 0.7rem;
        color: var(--text-muted, #94a3b8);
        text-align: right;
      }

      .timeline-tools-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--border, #2d2d4a);
      }

      .timeline-section-title {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted, #94a3b8);
        margin-bottom: 8px;
      }

      .timeline-tools-track {
        position: relative;
        height: 30px;
        background: var(--bg-muted, #1a1a2e);
        border-radius: 4px;
        margin-left: 200px;
      }

      .timeline-tool-marker {
        position: absolute;
        transform: translateX(-50%);
        cursor: pointer;
      }

      .timeline-tool-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-top: 11px;
      }

      .timeline-details {
        background: var(--panel, #0f0f23);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 8px;
        padding: 16px;
      }

      .timeline-details-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }

      .timeline-details-status {
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        color: white;
      }

      .timeline-details-agent {
        font-size: 0.9rem;
        font-weight: 600;
        text-transform: capitalize;
      }

      .timeline-details-goal {
        font-size: 0.85rem;
        color: var(--text, #e2e8f0);
        margin-bottom: 12px;
        line-height: 1.4;
      }

      .timeline-details-meta {
        font-size: 0.75rem;
        color: var(--text-muted, #94a3b8);
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 12px;
      }

      .timeline-details-tools {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border, #2d2d4a);
      }

      .timeline-details-tool-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .timeline-tool-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.75rem;
        padding: 4px 8px;
        background: var(--bg-muted, #1a1a2e);
        border-radius: 4px;
      }

      .timeline-tool-name {
        font-weight: 500;
        flex: 1;
      }

      .timeline-tool-duration {
        color: var(--text-muted, #94a3b8);
      }

      .timeline-empty {
        text-align: center;
        padding: 40px;
        color: var(--text-muted, #94a3b8);
      }
    </style>

    <div class="card">
      <div class="timeline-header">
        <div>
          <div class="card-title">📊 Timeline</div>
          <div class="card-sub">Visualize agent execution over time</div>
        </div>
        <div class="timeline-controls">
          ${[1, 6, 24, 72].map(
            (hours) => html`
              <button
                class="timeline-period-btn ${periodHours === hours ? "active" : ""}"
                @click=${() => props.onChangePeriod(hours)}
              >
                ${hours}h
              </button>
            `,
          )}
          <button class="timeline-period-btn" @click=${props.onRefresh}>↻</button>
        </div>
      </div>

      ${error ? html`<div class="pill danger">${error}</div>` : nothing}
    </div>

    ${renderLegend()}

    <div class="timeline-container">
      <div class="timeline-main">
        ${
          loading
            ? html`
                <div class="muted">Loading timeline...</div>
              `
            : runs.length === 0
              ? html`<div class="timeline-empty">No activity in the last ${periodHours} hours</div>`
              : html`
                ${renderTimeAxis(minTime, maxTime)}
                <div class="timeline-runs">
                  ${runs.map((run) =>
                    renderRunBar(
                      run,
                      minTime,
                      maxTime,
                      run.id === selectedRunId,
                      props.onSelectRun,
                    ),
                  )}
                </div>
                ${renderToolCalls(tools, minTime, maxTime)}
              `
        }
      </div>

      ${selectedRun ? renderRunDetails(selectedRun, tools) : nothing}
    </div>
  `;
}

// ============================================================================
// Data Fetching
// ============================================================================

export async function fetchTimeline(hours = 24, runId?: string): Promise<TimelineData | null> {
  try {
    let url = `${AGENCY_API_URL}/api/timeline?hours=${hours}`;
    if (runId) url += `&run_id=${runId}`;

    const res = await fetch(url);
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn("[Agency] Failed to fetch timeline:", e);
  }
  return null;
}
