/**
 * Agency Event Stream View for OpenClaw
 *
 * Real-time event log showing system activity.
 * Useful for debugging, monitoring, and understanding agent behavior.
 */

import { html, nothing } from "lit";

// ============================================================================
// Types
// ============================================================================

export type AgencyEvent = {
  id: number;
  timestamp: string;
  category: string;
  type: string;
  run_id: string | null;
  agent_id: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
};

export type EventStreamProps = {
  events: AgencyEvent[];
  loading: boolean;
  error: string | null;
  autoRefresh: boolean;
  filter: {
    category: string | null;
    agentId: string | null;
    runId: string | null;
  };
  onToggleAutoRefresh: () => void;
  onSetFilter: (filter: Partial<EventStreamProps["filter"]>) => void;
  onClearFilters: () => void;
  onRefresh: () => void;
  onSelectRun: (runId: string) => void;
};

// ============================================================================
// Configuration
// ============================================================================

const AGENCY_API_URL = (window as any).AGENCY_API_URL || "http://localhost:8765";

const CATEGORY_COLORS: Record<string, string> = {
  run: "#3b82f6",
  tool: "#8b5cf6",
  context: "#f59e0b",
  node: "#10b981",
  safety: "#ef4444",
  system: "#6b7280",
};

const CATEGORY_ICONS: Record<string, string> = {
  run: "🏃",
  tool: "🔧",
  context: "📚",
  node: "🖥️",
  safety: "🛡️",
  system: "⚙️",
};

// ============================================================================
// Helpers
// ============================================================================

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatRelativeTime(ts: string): string {
  const now = Date.now();
  const then = new Date(ts).getTime();
  const diff = now - then;

  if (diff < 1000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function truncate(str: string | null, len: number): string {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

function getUniqueCategories(events: AgencyEvent[]): string[] {
  const categories = new Set(events.map((e) => e.category));
  return Array.from(categories).sort();
}

function getUniqueAgents(events: AgencyEvent[]): string[] {
  const agents = new Set(events.filter((e) => e.agent_id).map((e) => e.agent_id as string));
  return Array.from(agents).sort();
}

// ============================================================================
// Components
// ============================================================================

function renderFilters(
  events: AgencyEvent[],
  filter: EventStreamProps["filter"],
  onSetFilter: EventStreamProps["onSetFilter"],
  onClearFilters: () => void,
) {
  const categories = getUniqueCategories(events);
  const agents = getUniqueAgents(events);
  const hasFilters = filter.category || filter.agentId || filter.runId;

  return html`
    <div class="events-filters">
      <div class="events-filter-group">
        <label class="events-filter-label">Category</label>
        <select
          class="events-filter-select"
          .value=${filter.category || ""}
          @change=${(e: Event) =>
            onSetFilter({ category: (e.target as HTMLSelectElement).value || null })}
        >
          <option value="">All</option>
          ${categories.map(
            (cat) => html`<option value=${cat}>${CATEGORY_ICONS[cat] || "📌"} ${cat}</option>`,
          )}
        </select>
      </div>

      <div class="events-filter-group">
        <label class="events-filter-label">Agent</label>
        <select
          class="events-filter-select"
          .value=${filter.agentId || ""}
          @change=${(e: Event) =>
            onSetFilter({ agentId: (e.target as HTMLSelectElement).value || null })}
        >
          <option value="">All</option>
          ${agents.map((a) => html`<option value=${a}>${a}</option>`)}
        </select>
      </div>

      <div class="events-filter-group">
        <label class="events-filter-label">Run ID</label>
        <input
          type="text"
          class="events-filter-input"
          placeholder="Filter by run..."
          .value=${filter.runId || ""}
          @input=${(e: Event) =>
            onSetFilter({ runId: (e.target as HTMLInputElement).value || null })}
        />
      </div>

      ${
        hasFilters
          ? html`
            <button class="events-clear-btn" @click=${onClearFilters}>
              Clear filters
            </button>
          `
          : nothing
      }
    </div>
  `;
}

function renderEventRow(event: AgencyEvent, onSelectRun: (id: string) => void) {
  const color = CATEGORY_COLORS[event.category] || CATEGORY_COLORS.system;
  const icon = CATEGORY_ICONS[event.category] || "📌";

  const metadataStr =
    Object.keys(event.metadata).length > 0 ? JSON.stringify(event.metadata) : null;

  return html`
    <div class="events-row">
      <div class="events-row-time">
        <span class="events-time-abs">${formatTimestamp(event.timestamp)}</span>
        <span class="events-time-rel">${formatRelativeTime(event.timestamp)}</span>
      </div>

      <div class="events-row-category" style="--cat-color: ${color}">
        <span class="events-category-icon">${icon}</span>
        <span class="events-category-label">${event.category}</span>
      </div>

      <div class="events-row-type">${event.type}</div>

      <div class="events-row-agent">
        ${event.agent_id ? html`<span class="events-agent-tag">${event.agent_id}</span>` : nothing}
      </div>

      <div class="events-row-message">
        ${event.message || ""}
        ${
          event.run_id
            ? html`
              <button
                class="events-run-link"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  onSelectRun(event.run_id!);
                }}
              >
                → ${truncate(event.run_id, 8)}
              </button>
            `
            : nothing
        }
      </div>

      ${
        metadataStr
          ? html`
            <div class="events-row-meta" title=${metadataStr}>
              {${Object.keys(event.metadata).length}}
            </div>
          `
          : html`
              <div class="events-row-meta"></div>
            `
      }
    </div>
  `;
}

function renderStats(events: AgencyEvent[]) {
  const categoryCounts: Record<string, number> = {};
  for (const e of events) {
    categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
  }

  return html`
    <div class="events-stats">
      ${Object.entries(categoryCounts).map(
        ([cat, count]) => html`
          <div class="events-stat" style="--cat-color: ${CATEGORY_COLORS[cat] || "#6b7280"}">
            <span class="events-stat-icon">${CATEGORY_ICONS[cat] || "📌"}</span>
            <span class="events-stat-label">${cat}</span>
            <span class="events-stat-count">${count}</span>
          </div>
        `,
      )}
    </div>
  `;
}

// ============================================================================
// Main Render
// ============================================================================

export function renderAgencyEvents(props: EventStreamProps) {
  const {
    events,
    loading,
    error,
    autoRefresh,
    filter,
    onToggleAutoRefresh,
    onSetFilter,
    onClearFilters,
    onRefresh,
    onSelectRun,
  } = props;

  // Apply filters
  let filtered = events;
  if (filter.category) {
    filtered = filtered.filter((e) => e.category === filter.category);
  }
  if (filter.agentId) {
    filtered = filtered.filter((e) => e.agent_id === filter.agentId);
  }
  if (filter.runId) {
    filtered = filtered.filter(
      (e) => e.run_id && e.run_id.toLowerCase().includes(filter.runId!.toLowerCase()),
    );
  }

  return html`
    <style>
      .events-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .events-controls {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .events-auto-btn {
        padding: 6px 12px;
        background: ${autoRefresh ? "#1f6feb" : "var(--bg-hover, #242442)"};
        border: 1px solid ${autoRefresh ? "#1f6feb" : "var(--border, #2d2d4a)"};
        border-radius: 6px;
        color: var(--text, #e2e8f0);
        font-size: 0.8rem;
        cursor: pointer;
      }

      .events-refresh-btn {
        padding: 6px 12px;
        background: var(--bg-hover, #242442);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 6px;
        color: var(--text, #e2e8f0);
        font-size: 0.8rem;
        cursor: pointer;
      }

      .events-refresh-btn:hover,
      .events-auto-btn:hover {
        background: var(--border, #2d2d4a);
      }

      .events-filters {
        display: flex;
        gap: 12px;
        align-items: flex-end;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }

      .events-filter-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .events-filter-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted, #94a3b8);
      }

      .events-filter-select,
      .events-filter-input {
        padding: 6px 10px;
        background: var(--bg-muted, #1a1a2e);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 6px;
        color: var(--text, #e2e8f0);
        font-size: 0.8rem;
        min-width: 120px;
      }

      .events-clear-btn {
        padding: 6px 12px;
        background: transparent;
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 6px;
        color: var(--text-muted, #94a3b8);
        font-size: 0.8rem;
        cursor: pointer;
      }

      .events-clear-btn:hover {
        color: var(--text, #e2e8f0);
        border-color: var(--text, #e2e8f0);
      }

      .events-stats {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }

      .events-stat {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        background: var(--bg-muted, #1a1a2e);
        border-radius: 20px;
        border-left: 3px solid var(--cat-color);
        font-size: 0.75rem;
      }

      .events-stat-count {
        font-weight: 600;
      }

      .events-table {
        background: var(--panel, #0f0f23);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 8px;
        overflow: hidden;
      }

      .events-table-header {
        display: grid;
        grid-template-columns: 100px 100px 120px 100px 1fr 40px;
        gap: 8px;
        padding: 10px 16px;
        background: var(--bg-muted, #1a1a2e);
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted, #94a3b8);
        border-bottom: 1px solid var(--border, #2d2d4a);
      }

      .events-table-body {
        max-height: 500px;
        overflow-y: auto;
      }

      .events-row {
        display: grid;
        grid-template-columns: 100px 100px 120px 100px 1fr 40px;
        gap: 8px;
        padding: 8px 16px;
        border-bottom: 1px solid var(--border, #2d2d4a);
        font-size: 0.8rem;
        align-items: center;
      }

      .events-row:last-child {
        border-bottom: none;
      }

      .events-row:hover {
        background: var(--bg-hover, #242442);
      }

      .events-row-time {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .events-time-abs {
        font-family: monospace;
        font-size: 0.75rem;
      }

      .events-time-rel {
        font-size: 0.65rem;
        color: var(--text-muted, #94a3b8);
      }

      .events-row-category {
        display: flex;
        align-items: center;
        gap: 4px;
        color: var(--cat-color);
      }

      .events-category-label {
        font-weight: 500;
        text-transform: capitalize;
      }

      .events-row-type {
        color: var(--text-muted, #94a3b8);
        font-family: monospace;
        font-size: 0.75rem;
      }

      .events-agent-tag {
        padding: 2px 8px;
        background: var(--bg-muted, #1a1a2e);
        border-radius: 12px;
        font-size: 0.7rem;
        text-transform: capitalize;
      }

      .events-row-message {
        display: flex;
        align-items: center;
        gap: 8px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .events-run-link {
        padding: 2px 6px;
        background: var(--accent, #1f6feb);
        border: none;
        border-radius: 4px;
        color: white;
        font-size: 0.65rem;
        cursor: pointer;
        white-space: nowrap;
      }

      .events-run-link:hover {
        opacity: 0.9;
      }

      .events-row-meta {
        font-size: 0.7rem;
        color: var(--text-muted, #94a3b8);
        text-align: center;
      }

      .events-empty {
        text-align: center;
        padding: 40px;
        color: var(--text-muted, #94a3b8);
      }

      .events-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 20px;
        color: var(--text-muted, #94a3b8);
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .events-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--border, #2d2d4a);
        border-top-color: var(--accent, #1f6feb);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
    </style>

    <div class="card">
      <div class="events-header">
        <div>
          <div class="card-title">📜 Event Stream</div>
          <div class="card-sub">Real-time activity log (${filtered.length} events)</div>
        </div>
        <div class="events-controls">
          <button class="events-auto-btn" @click=${onToggleAutoRefresh}>
            ${autoRefresh ? "⏸ Pause" : "▶ Auto"}
          </button>
          <button class="events-refresh-btn" @click=${onRefresh}>↻</button>
        </div>
      </div>

      ${error ? html`<div class="pill danger">${error}</div>` : nothing}
    </div>

    ${renderFilters(events, filter, onSetFilter, onClearFilters)}
    ${renderStats(events)}

    <div class="events-table">
      <div class="events-table-header">
        <div>Time</div>
        <div>Category</div>
        <div>Type</div>
        <div>Agent</div>
        <div>Message</div>
        <div>Meta</div>
      </div>
      <div class="events-table-body">
        ${
          loading && events.length === 0
            ? html`
                <div class="events-loading">
                  <div class="events-spinner"></div>
                  Loading events...
                </div>
              `
            : filtered.length === 0
              ? html`<div class="events-empty">No events${filter.category || filter.agentId || filter.runId ? " matching filter" : ""}</div>`
              : filtered.map((event) => renderEventRow(event, onSelectRun))
        }
      </div>
    </div>
  `;
}

// ============================================================================
// Data Fetching
// ============================================================================

export async function fetchEvents(limit = 100): Promise<AgencyEvent[]> {
  try {
    const res = await fetch(`${AGENCY_API_URL}/api/events/stream?limit=${limit}`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn("[Agency] Failed to fetch events:", e);
  }
  return [];
}

/**
 * Creates a polling-based event stream.
 * Call the returned stop() function to terminate.
 */
export function createEventPoller(
  onEvents: (events: AgencyEvent[]) => void,
  intervalMs = 2000,
): { stop: () => void } {
  let active = true;
  let timeoutId: number | undefined;

  async function poll() {
    if (!active) return;
    const events = await fetchEvents();
    if (active) {
      onEvents(events);
      timeoutId = window.setTimeout(poll, intervalMs);
    }
  }

  poll();

  return {
    stop: () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
    },
  };
}
