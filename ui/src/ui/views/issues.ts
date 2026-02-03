import { html, nothing } from "lit";
import type { Issue, IssuesCounts, IssueStatus } from "../controllers/issues.ts";

export type IssuesProps = {
  loading: boolean;
  issues: Issue[] | null;
  counts: IssuesCounts | null;
  error: string | null;
  filter: IssueStatus | "all";
  busy: boolean;
  onRefresh: () => void;
  onFilterChange: (filter: IssueStatus | "all") => void;
  onResolve: (id: string) => void;
  onDismiss: (id: string) => void;
  onReopen: (id: string) => void;
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function severityBadge(severity: string) {
  const colors: Record<string, { bg: string; text: string }> = {
    critical: {
      bg: "var(--severity-critical-bg, rgba(218,54,51,0.15))",
      text: "var(--severity-critical, #da3633)",
    },
    warning: {
      bg: "var(--severity-warning-bg, rgba(210,153,34,0.15))",
      text: "var(--severity-warning, #d29922)",
    },
    info: {
      bg: "var(--severity-info-bg, rgba(31,111,235,0.15))",
      text: "var(--severity-info, #1f6feb)",
    },
  };
  const c = colors[severity] ?? colors.info;
  return html`<span class="iss-badge" style="background:${c.bg};color:${c.text}">${severity}</span>`;
}

function categoryBadge(category: string) {
  const icons: Record<string, string> = {
    cost: "💰",
    error: "❌",
    performance: "⚡",
    config: "⚙️",
    security: "🔒",
    other: "📋",
  };
  return html`<span class="iss-cat">${icons[category] ?? "📋"} ${category}</span>`;
}

function statusIcon(status: string) {
  if (status === "open")
    return html`
      <span class="iss-status-dot iss-status-open"></span>
    `;
  if (status === "resolved")
    return html`
      <span class="iss-status-dot iss-status-resolved"></span>
    `;
  return html`
    <span class="iss-status-dot iss-status-dismissed"></span>
  `;
}

export function renderIssues(props: IssuesProps) {
  const filters: Array<{ key: IssueStatus | "all"; label: string }> = [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "resolved", label: "Resolved" },
    { key: "dismissed", label: "Dismissed" },
  ];

  return html`
    <style>
      .iss-toolbar {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        margin-bottom: 16px;
      }
      .iss-filter-btn {
        padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 500;
        border: 1px solid var(--border); background: var(--panel); color: var(--text);
        cursor: pointer; transition: all 0.15s;
      }
      .iss-filter-btn:hover { border-color: var(--border-strong); }
      .iss-filter-btn.active {
        background: var(--bg-accent, rgba(31,111,235,0.12));
        border-color: var(--accent, #1f6feb);
        color: var(--accent, #1f6feb);
      }
      .iss-filter-count {
        font-size: 11px; opacity: 0.6; margin-left: 4px;
      }
      .iss-list { display: flex; flex-direction: column; gap: 8px; }
      .iss-card {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: start;
        gap: 12px;
        padding: 16px;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 10px;
        transition: border-color 0.15s;
      }
      .iss-card:hover { border-color: var(--border-strong); }
      .iss-status-dot {
        display: inline-block; width: 10px; height: 10px; border-radius: 50%;
        margin-top: 5px;
      }
      .iss-status-open { background: #da3633; }
      .iss-status-resolved { background: #238636; }
      .iss-status-dismissed { background: #6e7681; }
      .iss-body { min-width: 0; }
      .iss-title {
        font-weight: 600; font-size: 14px; color: var(--text);
        margin-bottom: 4px;
      }
      .iss-desc {
        font-size: 13px; color: var(--text-secondary, var(--text));
        opacity: 0.7; margin-bottom: 8px;
        white-space: pre-wrap; word-break: break-word;
        max-height: 80px; overflow: hidden;
      }
      .iss-meta {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        font-size: 12px;
      }
      .iss-badge {
        padding: 2px 8px; border-radius: 4px; font-size: 11px;
        font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;
      }
      .iss-cat {
        font-size: 12px; opacity: 0.6;
      }
      .iss-time {
        font-size: 11px; opacity: 0.4;
      }
      .iss-actions {
        display: flex; flex-direction: column; gap: 4px; align-items: flex-end;
      }
      .iss-action-btn {
        padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 500;
        border: 1px solid var(--border); background: var(--panel); color: var(--text);
        cursor: pointer; transition: all 0.15s; white-space: nowrap;
      }
      .iss-action-btn:hover { border-color: var(--border-strong); }
      .iss-action-btn.resolve { color: #238636; border-color: rgba(35,134,54,0.4); }
      .iss-action-btn.resolve:hover { background: rgba(35,134,54,0.1); }
      .iss-action-btn.dismiss { color: #6e7681; }
      .iss-action-btn.reopen { color: #d29922; border-color: rgba(210,153,34,0.4); }
      .iss-action-btn.reopen:hover { background: rgba(210,153,34,0.1); }
      .iss-id { font-family: var(--font-mono, monospace); font-size: 11px; opacity: 0.4; }
      .iss-empty {
        text-align: center; padding: 40px; opacity: 0.5; font-size: 14px;
      }
      .iss-stats {
        display: flex; gap: 16px; margin-bottom: 16px;
      }
      .iss-stat {
        display: flex; align-items: center; gap: 6px; font-size: 13px;
      }
      .iss-stat-num { font-weight: 700; font-size: 18px; }
      .iss-stat-label { opacity: 0.5; font-size: 11px; text-transform: uppercase; }
      .iss-resolve-note {
        font-size: 12px; font-style: italic; opacity: 0.6;
        margin-top: 4px; padding-left: 12px;
        border-left: 2px solid var(--border);
      }
    </style>

    <!-- Stats bar -->
    ${
      props.counts
        ? html`
        <div class="iss-stats">
          <div class="iss-stat">
            <span class="iss-stat-num" style="color:#da3633">${props.counts.open}</span>
            <span class="iss-stat-label">Open</span>
          </div>
          <div class="iss-stat">
            <span class="iss-stat-num" style="color:#238636">${props.counts.resolved}</span>
            <span class="iss-stat-label">Resolved</span>
          </div>
          <div class="iss-stat">
            <span class="iss-stat-num" style="color:#6e7681">${props.counts.dismissed}</span>
            <span class="iss-stat-label">Dismissed</span>
          </div>
        </div>`
        : nothing
    }

    <!-- Toolbar -->
    <div class="iss-toolbar">
      ${filters.map((f) => {
        const count = props.counts
          ? f.key === "all"
            ? props.counts.total
            : props.counts[f.key]
          : null;
        return html`
          <button
            class="iss-filter-btn ${props.filter === f.key ? "active" : ""}"
            @click=${() => props.onFilterChange(f.key)}
          >
            ${f.label}${count != null ? html`<span class="iss-filter-count">(${count})</span>` : nothing}
          </button>`;
      })}
      <div style="flex:1"></div>
      <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
        ${props.loading ? "↻" : "↻ Refresh"}
      </button>
    </div>

    ${props.error ? html`<div style="color:#da3633;margin-bottom:12px;">${props.error}</div>` : nothing}

    ${
      props.loading && !props.issues
        ? html`
            <div class="muted" style="padding: 20px">Loading issues…</div>
          `
        : nothing
    }

    ${
      props.issues && props.issues.length === 0
        ? html`<div class="iss-empty">
          ${props.filter === "open" ? "🎉 No open issues!" : "No issues found."}
        </div>`
        : nothing
    }

    ${
      props.issues && props.issues.length > 0
        ? html`
        <div class="iss-list">
          ${props.issues.map(
            (issue) => html`
            <div class="iss-card">
              ${statusIcon(issue.status)}
              <div class="iss-body">
                <div class="iss-title">${issue.title}</div>
                ${
                  issue.description
                    ? html`<div class="iss-desc">${issue.description}</div>`
                    : nothing
                }
                <div class="iss-meta">
                  ${severityBadge(issue.severity)}
                  ${categoryBadge(issue.category)}
                  <span class="iss-id">${issue.id}</span>
                  <span class="iss-time">${timeAgo(issue.createdAt)}</span>
                  ${
                    issue.resolvedAt
                      ? html`<span class="iss-time">resolved ${timeAgo(issue.resolvedAt)}</span>`
                      : nothing
                  }
                </div>
                ${
                  issue.data?.resolveNote
                    ? html`<div class="iss-resolve-note">${issue.data.resolveNote}</div>`
                    : nothing
                }
                ${
                  issue.data?.dismissReason
                    ? html`<div class="iss-resolve-note">${issue.data.dismissReason}</div>`
                    : nothing
                }
              </div>
              <div class="iss-actions">
                ${
                  issue.status === "open"
                    ? html`
                    <button class="iss-action-btn resolve" ?disabled=${props.busy}
                      @click=${() => props.onResolve(issue.id)}>✓ Resolve</button>
                    <button class="iss-action-btn dismiss" ?disabled=${props.busy}
                      @click=${() => props.onDismiss(issue.id)}>✕ Dismiss</button>`
                    : html`
                    <button class="iss-action-btn reopen" ?disabled=${props.busy}
                      @click=${() => props.onReopen(issue.id)}>↺ Reopen</button>`
                }
              </div>
            </div>
          `,
          )}
        </div>`
        : nothing
    }
  `;
}
