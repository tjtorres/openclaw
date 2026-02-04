/**
 * Notifications view — actionable items with quick approve/dismiss.
 */
import { html, nothing } from "lit";
import { formatAgo } from "../format.ts";

export type NotificationItem = {
  id: string;
  type: "proposal" | "blocked" | "alert" | "completed";
  title: string;
  description: string;
  cardId?: string;
  cardName?: string;
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

const typeIcons: Record<string, string> = {
  proposal: "📋",
  blocked: "🚫",
  alert: "⚠️",
  completed: "✅",
};

const typeLabels: Record<string, string> = {
  proposal: "Needs Approval",
  blocked: "Blocked",
  alert: "Alert",
  completed: "Completed",
};

export function renderNotifications(props: NotificationsProps) {
  if (props.loading && !props.data) {
    return html`<div class="card"><div class="muted">Loading notifications...</div></div>`;
  }
  if (props.error) {
    return html`<div class="card"><div class="callout danger">${props.error}</div></div>`;
  }
  if (!props.data) {
    return html`<div class="card"><div class="muted">No notification data.</div></div>`;
  }

  const { notifications, unreadCount } = props.data;
  const unread = notifications.filter((n) => !n.read);
  const read = notifications.filter((n) => n.read);

  return html`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
      <div>
        ${unreadCount > 0
          ? html`<span style="background: var(--accent, #4caf50); color: white; padding: 2px 10px; border-radius: 12px; font-size: 13px; font-weight: 600">${unreadCount} pending</span>`
          : html`<span class="muted">All caught up</span>`}
      </div>
      <button class="btn" @click=${() => props.onRefresh()}>Refresh</button>
    </div>

    ${unread.length > 0
      ? html`
          <div style="display: flex; flex-direction: column; gap: 8px">
            ${unread.map((n) => renderNotificationCard(n, props.onAction))}
          </div>
        `
      : nothing}

    ${read.length > 0
      ? html`
          <div style="margin-top: 16px">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 8px">Recent</div>
            <div style="display: flex; flex-direction: column; gap: 6px">
              ${read.map((n) => renderNotificationCard(n, props.onAction, true))}
            </div>
          </div>
        `
      : nothing}
  `;
}

function renderNotificationCard(
  n: NotificationItem,
  onAction: (action: string, params: Record<string, unknown>) => void,
  dimmed = false,
) {
  const icon = typeIcons[n.type] || "📌";
  const label = typeLabels[n.type] || n.type;

  return html`
    <div class="card" style="padding: 12px 16px; ${dimmed ? "opacity: 0.6;" : ""}">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px">
        <div style="flex: 1; min-width: 0">
          <div style="display: flex; align-items: center; gap: 8px">
            <span style="font-size: 18px">${icon}</span>
            <div>
              <div style="font-weight: 600; font-size: 14px">${n.title}</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px">
                ${label} · ${formatAgo(new Date(n.createdAt).getTime())}
              </div>
            </div>
          </div>
          ${n.description
            ? html`<div style="margin-top: 6px; font-size: 13px; color: var(--text-muted); line-height: 1.4; max-height: 60px; overflow: hidden">${n.description}</div>`
            : nothing}
        </div>
        ${n.actions.length > 0
          ? html`
              <div style="display: flex; gap: 6px; flex-shrink: 0; align-items: center">
                ${n.actions.map(
                  (a) => html`
                    <button
                      class="btn ${a.style === "primary" ? "btn--primary" : ""}"
                      style="${a.style === "primary" ? "background: var(--accent, #4caf50); color: white; border: none; font-weight: 600;" : ""}"
                      @click=${() => onAction(a.action, a.params)}
                    >
                      ${a.label}
                    </button>
                  `,
                )}
              </div>
            `
          : nothing}
      </div>
    </div>
  `;
}
