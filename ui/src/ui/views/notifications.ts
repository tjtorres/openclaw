/**
 * Notifications view — actionable items with prominent approve/reject.
 *
 * Design: Each notification card shows:
 *   - Icon + type badge (Approval Needed / Blocked / Working / Done)
 *   - Title (card name)
 *   - Summary: clear sentence about what this is and what you need to do
 *   - Progress bar if checklist exists
 *   - Action buttons (Approve/Reject prominent, Details secondary)
 *   - Expandable description
 */
import { html, nothing } from "lit";
import { formatAgo } from "../format.ts";

export type NotificationItem = {
  id: string;
  type: "proposal" | "blocked" | "alert" | "completed" | "in-progress";
  title: string;
  summary: string;
  description: string;
  cardId?: string;
  cardName?: string;
  progress?: { done: number; total: number };
  actions: Array<{
    label: string;
    action: string;
    params: Record<string, unknown>;
    style?: "primary" | "danger" | "default";
  }>;
  createdAt: string;
  read: boolean;
};

export type NotificationsData = {
  notifications: NotificationItem[];
  unreadCount: number;
  fetchedAt: number;
};

export type NotificationsProps = {
  loading: boolean;
  data: NotificationsData | null;
  error: string | null;
  onAction: (action: string, params: Record<string, unknown>) => void;
  onRefresh: () => void;
};

/** Strip markdown formatting for clean plaintext display. */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "") // headers
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic
    .replace(/`(.+?)`/g, "$1") // inline code
    .replace(/^[-*]\s+/gm, "• ") // list items
    .replace(/^\d+\.\s+/gm, "") // numbered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/---+/g, "") // hr
    .replace(/\n{2,}/g, "\n") // collapse whitespace
    .trim();
}

const typeBadge: Record<string, { label: string; bg: string; fg: string }> = {
  proposal: { label: "Approval Needed", bg: "rgba(255, 193, 7, 0.2)", fg: "#ffc107" },
  blocked: { label: "Blocked", bg: "rgba(229, 57, 53, 0.2)", fg: "#ef5350" },
  alert: { label: "Alert", bg: "rgba(229, 57, 53, 0.2)", fg: "#ef5350" },
  "in-progress": { label: "In Progress", bg: "rgba(66, 165, 245, 0.2)", fg: "#42a5f5" },
  completed: { label: "Done", bg: "rgba(76, 175, 80, 0.2)", fg: "#66bb6a" },
};

export function renderNotifications(props: NotificationsProps) {
  if (props.loading && !props.data) {
    return html`
      <div class="card" style="padding: 24px; text-align: center; color: var(--text-muted)">
        Loading notifications…
      </div>
    `;
  }
  if (props.error) {
    return html`<div class="card"><div class="callout danger">${props.error}</div></div>`;
  }
  if (!props.data) {
    return html`
      <div class="card" style="padding: 24px; text-align: center; color: var(--text-muted)">No data</div>
    `;
  }

  const { notifications, unreadCount } = props.data;
  const actionable = notifications.filter((n) => !n.read);
  const informational = notifications.filter((n) => n.read);

  return html`
    <style>
      .notif-card {
        background: var(--panel, #1a1a2e);
        border: 1px solid var(--border, #333);
        border-radius: 10px;
        padding: 16px 20px;
        transition: border-color 0.15s;
      }
      .notif-card:hover { border-color: var(--border-strong, #555); }
      .notif-card--unread { border-left: 3px solid var(--accent, #4caf50); }
      .notif-badge {
        display: inline-block;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      .notif-summary {
        font-size: 14px;
        line-height: 1.5;
        color: var(--text, #e0e0e0);
        margin: 8px 0;
      }
      .notif-desc {
        font-size: 12px;
        color: var(--text-muted, #888);
        line-height: 1.4;
        max-height: 80px;
        overflow: hidden;
        margin-top: 8px;
        padding: 8px;
        background: var(--bg-hover, rgba(255,255,255,0.03));
        border-radius: 6px;
      }
      .notif-actions { display: flex; gap: 8px; margin-top: 12px; }
      .notif-btn {
        border: none;
        border-radius: 6px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.15s, transform 0.1s;
      }
      .notif-btn:hover { opacity: 0.9; }
      .notif-btn:active { transform: scale(0.97); }
      .notif-btn--approve {
        background: #43a047;
        color: white;
        font-size: 14px;
        padding: 10px 24px;
      }
      .notif-btn--reject {
        background: transparent;
        color: #e53935;
        border: 1px solid #e53935;
        padding: 8px 16px;
      }
      .notif-btn--default {
        background: var(--bg-hover, rgba(255,255,255,0.08));
        color: var(--text-muted, #aaa);
      }
      .notif-progress {
        height: 4px;
        background: var(--bg-hover, rgba(255,255,255,0.08));
        border-radius: 2px;
        margin-top: 8px;
        overflow: hidden;
      }
      .notif-progress-bar {
        height: 100%;
        background: var(--accent, #4caf50);
        border-radius: 2px;
        transition: width 0.3s;
      }
      .notif-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      .notif-time { font-size: 11px; color: var(--text-muted, #888); }
      .notif-section-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
        margin: 20px 0 8px;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--border, #333);
      }
    </style>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px">
        ${
          unreadCount > 0
            ? html`<span style="background:#e53935;color:white;padding:4px 14px;border-radius:16px;font-size:14px;font-weight:700">${unreadCount} need${unreadCount === 1 ? "s" : ""} attention</span>`
            : html`
                <span
                  style="
                    background: #43a047;
                    color: white;
                    padding: 4px 14px;
                    border-radius: 16px;
                    font-size: 14px;
                    font-weight: 600;
                  "
                  >✓ All clear</span
                >
              `
        }
      </div>
      <div style="display:flex;gap:8px">
        ${unreadCount > 0 ? html`<button class="notif-btn notif-btn--default" @click=${() => props.onAction("dismissAll", {})} style="font-size:12px">Mark all read</button>` : nothing}
        <button class="notif-btn notif-btn--default" @click=${() => props.onRefresh()} style="font-size:12px">↻ Refresh</button>
      </div>
    </div>

    ${
      actionable.length > 0
        ? html`
      <div style="display:flex;flex-direction:column;gap:10px">
        ${actionable.map((n) => renderNotifCard(n, props.onAction))}
      </div>
    `
        : nothing
    }

    ${
      informational.length > 0
        ? html`
      <div class="notif-section-label">Recent Activity</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${informational.map((n) => renderNotifCard(n, props.onAction, true))}
      </div>
    `
        : nothing
    }

    ${
      notifications.length === 0
        ? html`
            <div style="text-align: center; padding: 40px 20px; color: var(--text-muted)">
              <div style="font-size: 32px; margin-bottom: 8px">🔔</div>
              <div>No notifications yet.</div>
            </div>
          `
        : nothing
    }
  `;
}

function renderNotifCard(
  n: NotificationItem,
  onAction: (action: string, params: Record<string, unknown>) => void,
  compact = false,
) {
  const badge = typeBadge[n.type] || typeBadge["alert"];
  const pct = n.progress?.total ? Math.round((n.progress.done / n.progress.total) * 100) : 0;

  if (compact) {
    return html`
      <div class="notif-card" style="padding:10px 16px;opacity:0.7">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="notif-badge" style="background:${badge.bg};color:${badge.fg}">${badge.label}</span>
          <span style="font-size:13px;font-weight:500">${n.title}</span>
          <span class="notif-time" style="margin-left:auto">${(() => {
            const createdMs = new Date(n.createdAt).getTime();
            return isNaN(createdMs) ? "recently" : formatAgo(createdMs);
          })()}</span>
        </div>
      </div>
    `;
  }

  return html`
    <div class="notif-card ${n.read ? "" : "notif-card--unread"}" style="cursor:pointer" @click=${(
      e: Event,
    ) => {
      // Don't navigate if clicking an action button
      if ((e.target as HTMLElement)?.closest?.("button")) return;
      // Mark as read + navigate to the card
      if (n.cardId) {
        onAction("navigate", { cardId: n.cardId });
      }
      if (!n.read && n.id) {
        onAction("dismiss", { notificationId: n.id });
      }
    }}>
      <div class="notif-meta">
        <span class="notif-badge" style="background:${badge.bg};color:${badge.fg}">${badge.label}</span>
        <span class="notif-time">${(() => {
          const createdMs = new Date(n.createdAt).getTime();
          return isNaN(createdMs) ? "recently" : formatAgo(createdMs);
        })()}</span>
      </div>

      <div style="font-size:16px;font-weight:600;margin:4px 0">${n.title}</div>
      <div class="notif-summary">${n.summary}</div>

      ${
        n.progress && n.progress.total > 0
          ? html`
        <div class="notif-progress">
          <div class="notif-progress-bar" style="width:${pct}%"></div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${n.progress.done}/${n.progress.total} checklist items</div>
      `
          : nothing
      }

      ${
        n.description && n.type !== "completed"
          ? html`
        <div class="notif-desc">${stripMarkdown(n.description).slice(0, 300)}${n.description.length > 300 ? "…" : ""}</div>
      `
          : nothing
      }

      ${
        n.actions.length > 0
          ? html`
        <div class="notif-actions">
          ${n.actions.map(
            (a) => html`
            <button
              class="notif-btn ${a.style === "primary" ? "notif-btn--approve" : a.style === "danger" ? "notif-btn--reject" : "notif-btn--default"}"
              @click=${() => onAction(a.action, a.params)}
            >${a.label}</button>
          `,
          )}
        </div>
      `
          : nothing
      }
    </div>
  `;
}
