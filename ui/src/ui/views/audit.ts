/**
 * Audit Log view — agent instance tracking and full observability.
 *
 * Three view modes:
 *   1. Action Audit — structured action log per agent instance
 *   2. Raw Logs — raw log file content
 *   3. Summary — task handling summary with timeline
 */
import { html, nothing } from "lit";
import { formatAgo } from "../format";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type AuditInstance = {
  instanceId: string;
  agentId: string;
  instanceNum: number;
  status: string;
  assignedTask: string | null;
  taskSummary: string | null;
  model: string | null;
  cost: number;
  spawnedAt: string;
  lastActiveAt: string;
  tornDownAt: string | null;
  sessionKey: string | null;
  jobId: string | null;
  actionCount: number;
};

export type AuditEntry = {
  id: number;
  ts: string;
  agentId: string;
  instanceId: string | null;
  action: string;
  target: string | null;
  targetType: string | null;
  status: string;
  cost: number | null;
  durationMs: number | null;
  detail: string | null;
  sessionKey: string | null;
};

export type AuditSummary = {
  instanceId: string;
  agentId: string;
  instanceNum: number;
  status: string;
  assignedTask: string | null;
  taskSummary: string | null;
  model: string | null;
  totalCost: number;
  spawnedAt: string;
  tornDownAt: string | null;
  durationMs: number;
  actionBreakdown: Array<{
    action: string;
    count: number;
    totalCost: number;
    firstAt: string;
    lastAt: string;
  }>;
  timeline: Array<{
    ts: string;
    action: string;
    target: string | null;
    status: string;
    cost: number | null;
    detail: string | null;
  }>;
};

export type AuditViewMode = "actions" | "logs" | "summary";

export type AuditViewProps = {
  loading: boolean;
  error: string | null;
  instances: AuditInstance[];
  entries: AuditEntry[];
  entriesTotal: number;
  rawLogs: string | null;
  summary: AuditSummary | null;
  selectedInstanceId: string | null;
  viewMode: AuditViewMode;
  filterAgent: string | null;
  onRefresh: () => void;
  onSelectInstance: (instanceId: string | null) => void;
  onChangeViewMode: (mode: AuditViewMode) => void;
  onFilterAgent: (agentId: string | null) => void;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function statusBadge(status: string) {
  const colors: Record<string, { bg: string; fg: string }> = {
    running: { bg: "#10b98120", fg: "#10b981" },
    active: { bg: "#10b98120", fg: "#10b981" },
    idle: { bg: "#f59e0b20", fg: "#f59e0b" },
    completed: { bg: "#6366f120", fg: "#6366f1" },
    done: { bg: "#6366f120", fg: "#6366f1" },
    failed: { bg: "#ef444420", fg: "#ef4444" },
    torn_down: { bg: "#6b728020", fg: "#6b7280" },
    ok: { bg: "#10b98120", fg: "#10b981" },
    error: { bg: "#ef444420", fg: "#ef4444" },
  };
  const c = colors[status] ?? { bg: "#94a3b820", fg: "#94a3b8" };
  return html`<span style="
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: ${c.bg};
    color: ${c.fg};
  ">${status}</span>`;
}

function agentEmoji(agentId: string): string {
  const emojis: Record<string, string> = {
    jeeves: "🌟",
    ada: "🎨",
    crash: "🔧",
    ghost: "👻",
  };
  return emojis[agentId] ?? "🤖";
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || isNaN(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

function formatCost(cost: number | null | undefined): string {
  if (cost == null || isNaN(cost)) return "—";
  if (cost === 0) return "$0.00";
  return `$${cost.toFixed(4)}`;
}

/* ------------------------------------------------------------------ */
/*  Instance selector                                                 */
/* ------------------------------------------------------------------ */

function renderInstanceSelector(props: AuditViewProps) {
  const { instances, selectedInstanceId, filterAgent } = props;

  // Get unique agent IDs for filter
  const agentIds = [...new Set(instances.map((i) => i.agentId))].sort();

  // Filter instances
  const filtered = filterAgent ? instances.filter((i) => i.agentId === filterAgent) : instances;

  return html`
    <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">
      <!-- Agent filter + view mode -->
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <select
          style="
            background: var(--panel, #1a1a2e);
            color: var(--text, #e0e0e0);
            border: 1px solid var(--border, #2a2a4a);
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 13px;
          "
          @change=${(e: Event) => {
            const val = (e.target as HTMLSelectElement).value;
            props.onFilterAgent(val || null);
          }}
        >
          <option value="" ?selected=${!filterAgent}>All Agents</option>
          ${agentIds.map(
            (id) => html`
              <option value=${id} ?selected=${filterAgent === id}>
                ${agentEmoji(id)} ${id.charAt(0).toUpperCase() + id.slice(1)}
              </option>
            `,
          )}
        </select>

        <div style="display: flex; border: 1px solid var(--border, #2a2a4a); border-radius: 6px; overflow: hidden;">
          ${(["actions", "logs", "summary"] as AuditViewMode[]).map(
            (mode) => html`
              <button
                style="
                  padding: 6px 14px;
                  font-size: 12px;
                  font-weight: 500;
                  border: none;
                  cursor: pointer;
                  background: ${props.viewMode === mode ? "var(--accent, #6366f1)" : "var(--panel, #1a1a2e)"};
                  color: ${props.viewMode === mode ? "#fff" : "var(--text-muted, #8888aa)"};
                  transition: all 0.15s;
                "
                @click=${() => props.onChangeViewMode(mode)}
              >
                ${mode === "actions" ? "⚡ Actions" : mode === "logs" ? "📄 Raw Logs" : "📊 Summary"}
              </button>
            `,
          )}
        </div>

        <button
          style="
            padding: 6px 12px;
            font-size: 12px;
            border: 1px solid var(--border, #2a2a4a);
            border-radius: 6px;
            background: var(--panel, #1a1a2e);
            color: var(--text-muted, #8888aa);
            cursor: pointer;
          "
          @click=${() => props.onRefresh()}
        >
          ↻ Refresh
        </button>
      </div>

      <!-- Instance chips -->
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        <button
          style="
            padding: 4px 12px;
            font-size: 12px;
            border: 1px solid ${!selectedInstanceId ? "var(--accent, #6366f1)" : "var(--border, #2a2a4a)"};
            border-radius: 16px;
            background: ${!selectedInstanceId ? "var(--accent, #6366f1)20" : "var(--panel, #1a1a2e)"};
            color: ${!selectedInstanceId ? "var(--accent, #6366f1)" : "var(--text-muted, #8888aa)"};
            cursor: pointer;
          "
          @click=${() => props.onSelectInstance(null)}
        >
          All
        </button>
        ${filtered.map(
          (inst) => html`
            <button
              style="
                padding: 4px 12px;
                font-size: 12px;
                border: 1px solid ${selectedInstanceId === inst.instanceId ? "var(--accent, #6366f1)" : "var(--border, #2a2a4a)"};
                border-radius: 16px;
                background: ${selectedInstanceId === inst.instanceId ? "var(--accent, #6366f1)20" : "var(--panel, #1a1a2e)"};
                color: ${selectedInstanceId === inst.instanceId ? "var(--accent, #6366f1)" : "var(--text-muted, #8888aa)"};
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 4px;
              "
              @click=${() => props.onSelectInstance(inst.instanceId)}
            >
              ${agentEmoji(inst.agentId)}
              <span style="font-weight: 600;">${inst.instanceId}</span>
              ${statusBadge(inst.status)}
              ${
                inst.actionCount > 0
                  ? html`<span style="font-size: 10px; color: var(--text-muted, #8888aa);">(${inst.actionCount})</span>`
                  : nothing
              }
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/*  Actions view                                                      */
/* ------------------------------------------------------------------ */

function renderActionsView(props: AuditViewProps) {
  const { entries, entriesTotal } = props;

  if (entries.length === 0) {
    return html`
      <div style="text-align: center; padding: 40px; color: var(--text-muted, #8888aa);">
        <div style="font-size: 32px; margin-bottom: 8px;">📋</div>
        <div>No audit entries${props.selectedInstanceId ? ` for ${props.selectedInstanceId}` : ""}.</div>
        <div style="font-size: 12px; margin-top: 4px;">Actions will appear here as agents work.</div>
      </div>
    `;
  }

  return html`
    <div style="display: flex; flex-direction: column; gap: 1px;">
      <div style="
        display: grid;
        grid-template-columns: 140px 90px 80px 1fr 80px 70px;
        gap: 8px;
        padding: 8px 12px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted, #8888aa);
        border-bottom: 1px solid var(--border, #2a2a4a);
      ">
        <span>Time</span>
        <span>Instance</span>
        <span>Action</span>
        <span>Detail</span>
        <span>Status</span>
        <span>Cost</span>
      </div>

      ${entries.map(
        (entry) => html`
          <div
            style="
              display: grid;
              grid-template-columns: 140px 90px 80px 1fr 80px 70px;
              gap: 8px;
              padding: 8px 12px;
              font-size: 13px;
              border-bottom: 1px solid var(--border, #2a2a4a)08;
              transition: background 0.1s;
            "
            @mouseenter=${(e: Event) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-hover, #242442)")}
            @mouseleave=${(e: Event) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
          >
            <span style="color: var(--text-muted, #8888aa); font-size: 12px; font-family: monospace;">
              ${(() => {
                if (!entry.ts) return "—";
                const ms = typeof entry.ts === "string" ? new Date(entry.ts).getTime() : entry.ts;
                return isNaN(ms) ? "—" : formatAgo(ms);
              })()}
            </span>
            <span style="font-weight: 500;">
              ${
                entry.instanceId
                  ? html`${agentEmoji(entry.agentId)} ${entry.instanceId}`
                  : html`${agentEmoji(entry.agentId)} ${entry.agentId}`
              }
            </span>
            <span style="
              font-family: monospace;
              font-size: 12px;
              color: var(--accent, #6366f1);
            ">${entry.action}</span>
            <span style="
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              color: var(--text, #e0e0e0);
            " title=${entry.detail || entry.target || ""}>${entry.detail || entry.target || "—"}</span>
            <span>${statusBadge(entry.status)}</span>
            <span style="font-family: monospace; font-size: 12px;">${formatCost(entry.cost)}</span>
          </div>
        `,
      )}

      ${
        entriesTotal > entries.length
          ? html`
            <div style="text-align: center; padding: 12px; font-size: 12px; color: var(--text-muted, #8888aa);">
              Showing ${entries.length} of ${entriesTotal} entries
            </div>
          `
          : nothing
      }
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/*  Raw Logs view                                                     */
/* ------------------------------------------------------------------ */

function renderLogsView(props: AuditViewProps) {
  const { rawLogs, selectedInstanceId } = props;

  if (!rawLogs && !selectedInstanceId) {
    // "All" mode — show gateway logs
    return html`
      <div style="text-align: center; padding: 40px; color: var(--text-muted, #8888aa)">
        <div style="font-size: 32px; margin-bottom: 8px">📄</div>
        <div>Loading combined gateway logs...</div>
        <div style="font-size: 12px; margin-top: 4px">Select an agent instance for filtered logs.</div>
      </div>
    `;
  }

  if (!rawLogs) {
    return html`
      <div style="text-align: center; padding: 40px; color: var(--text-muted, #8888aa);">
        <div>Loading logs${selectedInstanceId ? ` for ${selectedInstanceId}` : ""}...</div>
      </div>
    `;
  }

  return html`
    <div style="
      background: var(--panel, #0d0d1a);
      border: 1px solid var(--border, #2a2a4a);
      border-radius: 8px;
      padding: 16px;
      overflow: auto;
      max-height: 600px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--text, #e0e0e0);
    ">
      ${rawLogs}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/*  Summary view                                                      */
/* ------------------------------------------------------------------ */

function renderInstanceCards(props: AuditViewProps) {
  const { instances } = props;
  if (instances.length === 0) return nothing;

  return html`
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;">
      ${instances.map(
        (inst) => html`
          <div
            style="
              background: var(--panel, #1a1a2e);
              border: 1px solid var(--border, #2a2a4a);
              border-radius: 8px;
              padding: 16px;
              cursor: pointer;
              transition: border-color 0.15s;
            "
            @mouseenter=${(e: Event) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--accent, #6366f1)")}
            @mouseleave=${(e: Event) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--border, #2a2a4a)")}
            @click=${() => props.onSelectInstance(inst.instanceId)}
          >
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 20px;">${agentEmoji(inst.agentId)}</span>
              <span style="font-weight: 600; font-size: 14px;">${inst.instanceId}</span>
              ${statusBadge(inst.status)}
            </div>
            ${
              inst.assignedTask
                ? html`<div style="font-size: 12px; color: var(--text-muted, #8888aa); margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${inst.assignedTask}</div>`
                : nothing
            }
            <div style="display: flex; gap: 12px; font-size: 11px; color: var(--text-muted, #8888aa);">
              <span>${inst.model?.split("/").pop() ?? "—"}</span>
              <span>${inst.actionCount} actions</span>
              <span>${formatCost(inst.cost)}</span>
              <span>${(() => {
                if (!inst.spawnedAt) return "";
                const ms =
                  typeof inst.spawnedAt === "string"
                    ? new Date(inst.spawnedAt).getTime()
                    : inst.spawnedAt;
                return isNaN(ms) ? "" : formatAgo(ms);
              })()}</span>
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderSummaryView(props: AuditViewProps) {
  const { summary, selectedInstanceId } = props;

  if (!selectedInstanceId) {
    // No instance selected — show instance overview cards
    return html`
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div style="font-size: 13px; color: var(--text-muted, #8888aa);">
          Click an agent instance for detailed summary.
        </div>
        ${renderInstanceCards(props)}
      </div>
    `;
  }

  if (!summary) {
    return html`
      <div style="text-align: center; padding: 40px; color: var(--text-muted, #8888aa);">
        <div>Loading summary for ${selectedInstanceId}...</div>
      </div>
    `;
  }

  return html`
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <!-- Header card -->
      <div style="
        background: var(--panel, #1a1a2e);
        border: 1px solid var(--border, #2a2a4a);
        border-radius: 8px;
        padding: 20px;
      ">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <span style="font-size: 28px;">${agentEmoji(summary.agentId)}</span>
          <div>
            <div style="font-size: 18px; font-weight: 600;">${summary.instanceId}</div>
            <div style="font-size: 13px; color: var(--text-muted, #8888aa);">
              ${summary.model ?? "unknown model"} · ${statusBadge(summary.status)}
            </div>
          </div>
        </div>

        ${
          summary.assignedTask
            ? html`
              <div style="margin-bottom: 8px;">
                <span style="font-size: 11px; text-transform: uppercase; color: var(--text-muted, #8888aa); font-weight: 600;">Assigned Task</span>
                <div style="margin-top: 4px; font-size: 14px;">${summary.assignedTask}</div>
              </div>
            `
            : nothing
        }

        ${
          summary.taskSummary
            ? html`
              <div style="margin-bottom: 8px;">
                <span style="font-size: 11px; text-transform: uppercase; color: var(--text-muted, #8888aa); font-weight: 600;">Outcome</span>
                <div style="margin-top: 4px; font-size: 13px; color: var(--text, #e0e0e0);">${summary.taskSummary}</div>
              </div>
            `
            : nothing
        }

        <!-- Stats grid -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 16px;">
          <div style="text-align: center;">
            <div style="font-size: 20px; font-weight: 700;">${formatDuration(summary.durationMs)}</div>
            <div style="font-size: 11px; color: var(--text-muted, #8888aa);">Duration</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 20px; font-weight: 700;">${formatCost(summary.totalCost)}</div>
            <div style="font-size: 11px; color: var(--text-muted, #8888aa);">Cost</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 20px; font-weight: 700;">${summary.actionBreakdown.reduce((s, a) => s + a.count, 0)}</div>
            <div style="font-size: 11px; color: var(--text-muted, #8888aa);">Actions</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 20px; font-weight: 700;">${(() => {
              if (!summary.spawnedAt) return "—";
              const ms =
                typeof summary.spawnedAt === "string"
                  ? new Date(summary.spawnedAt).getTime()
                  : summary.spawnedAt;
              return isNaN(ms) ? "—" : formatAgo(ms);
            })()}</div>
            <div style="font-size: 11px; color: var(--text-muted, #8888aa);">Spawned</div>
          </div>
        </div>
      </div>

      <!-- Action breakdown -->
      ${
        summary.actionBreakdown.length > 0
          ? html`
            <div style="
              background: var(--panel, #1a1a2e);
              border: 1px solid var(--border, #2a2a4a);
              border-radius: 8px;
              padding: 16px;
            ">
              <div style="font-size: 13px; font-weight: 600; margin-bottom: 12px;">Action Breakdown</div>
              ${summary.actionBreakdown.map(
                (a) => html`
                  <div style="display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border, #2a2a4a)08;">
                    <span style="font-family: monospace; font-size: 12px; color: var(--accent, #6366f1); width: 100px;">${a.action}</span>
                    <span style="font-weight: 600; width: 40px; text-align: right;">${a.count}×</span>
                    <div style="flex: 1; height: 6px; background: var(--bg-hover, #242442); border-radius: 3px; overflow: hidden;">
                      <div style="
                        height: 100%;
                        width: ${Math.min(100, (a.count / Math.max(...summary.actionBreakdown.map((x) => x.count))) * 100)}%;
                        background: var(--accent, #6366f1);
                        border-radius: 3px;
                      "></div>
                    </div>
                    <span style="font-family: monospace; font-size: 12px; width: 70px; text-align: right;">${formatCost(a.totalCost)}</span>
                  </div>
                `,
              )}
            </div>
          `
          : nothing
      }

      <!-- Timeline -->
      ${
        summary.timeline.length > 0
          ? html`
            <div style="
              background: var(--panel, #1a1a2e);
              border: 1px solid var(--border, #2a2a4a);
              border-radius: 8px;
              padding: 16px;
            ">
              <div style="font-size: 13px; font-weight: 600; margin-bottom: 12px;">Timeline</div>
              <div style="
                border-left: 2px solid var(--border, #2a2a4a);
                margin-left: 8px;
                padding-left: 16px;
              ">
                ${summary.timeline.map(
                  (t) => html`
                    <div style="
                      position: relative;
                      padding: 8px 0;
                      font-size: 13px;
                    ">
                      <div style="
                        position: absolute;
                        left: -21px;
                        top: 12px;
                        width: 8px;
                        height: 8px;
                        border-radius: 50%;
                        background: ${t.status === "ok" || t.status === "done" ? "#10b981" : t.status === "error" || t.status === "failed" ? "#ef4444" : "#6366f1"};
                      "></div>
                      <div style="display: flex; gap: 8px; align-items: baseline;">
                        <span style="font-family: monospace; font-size: 11px; color: var(--text-muted, #8888aa); min-width: 60px;">
                          ${t.ts ? formatAgo(t.ts) : ""}
                        </span>
                        <span style="font-family: monospace; font-size: 12px; color: var(--accent, #6366f1);">${t.action}</span>
                        ${t.detail ? html`<span style="color: var(--text, #e0e0e0);">— ${t.detail}</span>` : nothing}
                        ${t.cost ? html`<span style="font-family: monospace; font-size: 11px; color: var(--text-muted, #8888aa);">${formatCost(t.cost)}</span>` : nothing}
                      </div>
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

/* ------------------------------------------------------------------ */
/*  Main render                                                       */
/* ------------------------------------------------------------------ */

export function renderAudit(props: AuditViewProps) {
  if (props.loading && props.instances.length === 0) {
    return html`
      <div style="text-align: center; padding: 40px; color: var(--text-muted, #8888aa)">
        Loading audit data...
      </div>
    `;
  }

  if (props.error) {
    return html`
      <div style="padding: 16px; color: #ef4444; background: #ef444410; border-radius: 8px; margin-bottom: 16px;">
        ${props.error}
      </div>
    `;
  }

  return html`
    <div style="max-width: 1200px;">
      ${renderInstanceSelector(props)}
      ${
        props.viewMode === "actions"
          ? renderActionsView(props)
          : props.viewMode === "logs"
            ? renderLogsView(props)
            : renderSummaryView(props)
      }
    </div>
  `;
}
