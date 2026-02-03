import { html, nothing } from "lit";

export type ActivityEntry = {
  ts: string;
  icon: string;
  message: string;
  category: string;
  cardId?: string;
  cardName?: string;
};

export type ActivityFeedData = {
  currentTask: {
    cardId: string;
    cardName: string;
    startedAt: string;
    checklistMapping: Record<string, string>;
  } | null;
  progress: { total: number; done: number; pct: number } | null;
  entries: ActivityEntry[];
  fetchedAt: number;
};

export type ActivityFeedProps = {
  loading: boolean;
  data: ActivityFeedData | null;
  error: string | null;
  agentStatus?: "idle" | "working";
  agentLastEvent?: number;
  agentSession?: string | null;
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function categoryColor(cat: string): string {
  switch (cat) {
    case "commit":
      return "var(--act-commit, #1f6feb)";
    case "check":
      return "var(--act-check, #238636)";
    case "task":
      return "var(--act-task, #d29922)";
    case "done":
      return "var(--act-done, #238636)";
    case "status":
      return "var(--act-status, #8b949e)";
    default:
      return "var(--text-secondary, #8b949e)";
  }
}

export function renderActivityFeed(props: ActivityFeedProps) {
  if (props.loading && !props.data) {
    return html`
      <div class="af-loading">Loading activity…</div>
    `;
  }
  if (props.error && !props.data) {
    return html`<div class="af-error">${props.error}</div>`;
  }
  if (!props.data) return nothing;

  const d = props.data;
  const task = d.currentTask;
  const remaining = task ? Object.keys(task.checklistMapping).length : 0;

  return html`
    <style>
      .af-panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: hidden;
      }
      .af-header {
        padding: 14px 16px;
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .af-pulse {
        width: 8px; height: 8px; border-radius: 50%;
        background: #238636;
        animation: af-blink 2s infinite;
      }
      @keyframes af-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      .af-idle .af-pulse { background: #6e7681; animation: none; }
      .af-title { font-size: 13px; font-weight: 600; flex: 1; }
      .af-time { font-size: 11px; opacity: 0.4; }

      .af-task {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border);
      }
      .af-task-name {
        font-size: 14px; font-weight: 600; margin-bottom: 6px;
        color: var(--text);
      }
      .af-progress-bar {
        height: 6px; border-radius: 3px;
        background: var(--border);
        overflow: hidden; margin-bottom: 4px;
      }
      .af-progress-fill {
        height: 100%; border-radius: 3px;
        background: #238636;
        transition: width 0.3s;
      }
      .af-progress-text {
        font-size: 11px; opacity: 0.5;
        display: flex; justify-content: space-between;
      }
      .af-remaining {
        margin-top: 8px; font-size: 12px;
      }
      .af-remaining-item {
        padding: 2px 0; opacity: 0.6;
      }
      .af-remaining-item::before {
        content: "⬜ "; font-size: 10px;
      }

      .af-entries {
        max-height: 300px;
        overflow-y: auto;
      }
      .af-entry {
        display: grid;
        grid-template-columns: 24px 1fr auto;
        align-items: start;
        gap: 8px;
        padding: 8px 16px;
        border-bottom: 1px solid var(--border);
        font-size: 13px;
        transition: background 0.1s;
      }
      .af-entry:last-child { border-bottom: none; }
      .af-entry:hover { background: var(--bg-hover, rgba(255,255,255,0.02)); }
      .af-icon { font-size: 14px; text-align: center; line-height: 1.4; }
      .af-msg {
        color: var(--text);
        word-break: break-word;
        line-height: 1.4;
      }
      .af-msg code {
        font-size: 12px;
        background: var(--bg-accent, rgba(31,111,235,0.08));
        padding: 1px 4px;
        border-radius: 3px;
      }
      .af-ts {
        font-size: 11px;
        opacity: 0.35;
        white-space: nowrap;
      }
      .af-dot {
        display: inline-block;
        width: 6px; height: 6px;
        border-radius: 50%;
        margin-right: 4px;
        vertical-align: middle;
      }
      .af-empty {
        padding: 20px 16px;
        text-align: center;
        opacity: 0.4;
        font-size: 13px;
      }
      .af-no-task {
        padding: 12px 16px;
        font-size: 13px;
        opacity: 0.5;
        font-style: italic;
      }
    </style>

    <div class="af-panel ${props.agentStatus === "working" ? "" : "af-idle"}">
      <div class="af-header">
        <div class="af-pulse"></div>
        <div class="af-title">Agent Activity</div>
        ${
          props.agentStatus === "working"
            ? html`<div class="af-time" style="color:#238636;opacity:1">⚡ Working</div>`
            : html`<div class="af-time">💤 Idle</div>`
        }
        ${
          d.entries.length > 0
            ? html`<div class="af-time">${timeAgo(d.entries[0].ts)}</div>`
            : nothing
        }
      </div>

      ${
        task
          ? html`
          <div class="af-task">
            <div class="af-task-name">🎯 ${task.cardName}</div>
            ${
              d.progress && d.progress.total > 0
                ? html`
                <div class="af-progress-bar">
                  <div class="af-progress-fill" style="width:${d.progress.pct}%"></div>
                </div>
                <div class="af-progress-text">
                  <span>${d.progress.done}/${d.progress.total} items</span>
                  <span>${d.progress.pct}%</span>
                </div>`
                : nothing
            }
            ${
              remaining > 0
                ? html`
                <div class="af-remaining">
                  ${Object.keys(task.checklistMapping)
                    .slice(0, 4)
                    .map((item) => html`<div class="af-remaining-item">${item}</div>`)}
                  ${
                    remaining > 4
                      ? html`<div class="af-remaining-item" style="opacity:0.3">+${remaining - 4} more</div>`
                      : nothing
                  }
                </div>`
                : nothing
            }
          </div>`
          : html`
              <div class="af-no-task">No active task</div>
            `
      }

      <div class="af-entries">
        ${
          d.entries.length > 0
            ? d.entries.map(
                (e) => html`
                <div class="af-entry">
                  <div class="af-icon">${e.icon}</div>
                  <div class="af-msg">
                    <span class="af-dot" style="background:${categoryColor(e.category)}"></span>
                    ${e.message}
                  </div>
                  <div class="af-ts">${timeAgo(e.ts)}</div>
                </div>`,
              )
            : html`
                <div class="af-empty">No activity yet</div>
              `
        }
      </div>
    </div>
  `;
}
