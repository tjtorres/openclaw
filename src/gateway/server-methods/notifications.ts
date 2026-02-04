/**
 * Notifications RPC — surfaces actionable items for quick review.
 *
 * Each notification answers: What is it? Why does it matter? What do you need to do?
 */
import type { GatewayRequestHandlers } from "./types.js";
import { getTasksDb, getChecklistProgress } from "./tasks-db.js";
import { sendPush } from "./push.js";

export type Notification = {
  id: string;
  type: "proposal" | "blocked" | "alert" | "completed" | "in-progress";
  title: string;
  /** Short, clear summary: what this is and what's needed from you. */
  summary: string;
  /** Full description / card body for expand. */
  description: string;
  cardId?: string;
  cardName?: string;
  /** Checklist progress if applicable. */
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

export type NotificationsResult = {
  notifications: Notification[];
  unreadCount: number;
  fetchedAt: number;
};

/** Extract first meaningful paragraph from a card description. */
function extractSummary(desc: string | null, maxLen = 180): string {
  if (!desc) return "";
  // Skip markdown headers, empty lines
  const lines = desc.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
  const first = lines.slice(0, 3).join(" ").trim();
  return first.length > maxLen ? first.slice(0, maxLen) + "…" : first;
}

/** Track which notification IDs have been dismissed/seen. In-memory is fine — resets on gateway restart. */
const seenNotifications = new Set<string>();

/** Track which cards have already had a push notification sent (prevent duplicates). */
const pushedNotifications = new Set<string>();

export const notificationsHandlers: GatewayRequestHandlers = {
  "notifications.dismiss": ({ params, respond }) => {
    const { notificationId } = params as { notificationId?: string };
    if (notificationId) {
      seenNotifications.add(notificationId);
    }
    respond(true, { ok: true });
  },

  "notifications.dismissAll": ({ respond }) => {
    seenNotifications.clear();
    // Mark everything currently known as seen
    const db = getTasksDb();
    if (db) {
      const proposed = db.prepare("SELECT id FROM cards c JOIN lists l ON c.list_id=l.id WHERE l.name='Proposed'").all() as Array<{ id: string }>;
      const blocked = db.prepare("SELECT id FROM cards c JOIN lists l ON c.list_id=l.id WHERE l.name='Blocked'").all() as Array<{ id: string }>;
      for (const c of proposed) seenNotifications.add(`proposal-${c.id}`);
      for (const c of blocked) seenNotifications.add(`blocked-${c.id}`);
    }
    respond(true, { ok: true });
  },

  "notifications.list": ({ respond }) => {
    const db = getTasksDb();
    const notifications: Notification[] = [];

    if (!db) {
      respond(true, { notifications: [], unreadCount: 0, fetchedAt: Date.now() });
      return;
    }

    // ── Proposed cards — need your approval ──────────────────
    const proposed = db.prepare(`
      SELECT c.id, c.name, c.description, c.updated_at
      FROM cards c JOIN lists l ON c.list_id = l.id
      WHERE l.name = 'Proposed'
      ORDER BY c.updated_at DESC
    `).all() as Array<{ id: string; name: string; description: string; updated_at: string }>;

    for (const card of proposed) {
      const progress = getChecklistProgress(db, card.id);
      const summary = extractSummary(card.description) || "New task proposal — review and approve to start work.";

      const notifId = `proposal-${card.id}`;

      // Send push for new proposals (first time only)
      if (!pushedNotifications.has(notifId) && !seenNotifications.has(notifId)) {
        pushedNotifications.add(notifId);
        void sendPush("📋 New Proposal", card.name, "proposal", card.id, [
          { label: "Approve", action: "taskQueue.approveCard", params: { cardId: card.id } },
        ]);
      }

      notifications.push({
        id: notifId,
        type: "proposal",
        title: card.name,
        summary: `🟡 Approval needed — ${summary}`,
        description: card.description || "",
        cardId: card.id,
        cardName: card.name,
        progress: progress.total > 0 ? progress : undefined,
        actions: [
          {
            label: "✓ Approve",
            action: "taskQueue.approveCard",
            params: { cardId: card.id },
            style: "primary",
          },
          {
            label: "✗ Reject",
            action: "taskQueue.moveCard",
            params: { cardId: card.id, listId: "__done__" },
            style: "danger",
          },
          {
            label: "Details",
            action: "navigate",
            params: { tab: "task-queue", cardId: card.id },
            style: "default",
          },
        ],
        createdAt: card.updated_at || new Date().toISOString(),
        read: seenNotifications.has(notifId),
      });
    }

    // ── Blocked cards — need your input ──────────────────────
    const blocked = db.prepare(`
      SELECT c.id, c.name, c.description, c.updated_at
      FROM cards c JOIN lists l ON c.list_id = l.id
      WHERE l.name = 'Blocked'
      ORDER BY c.updated_at DESC
    `).all() as Array<{ id: string; name: string; description: string; updated_at: string }>;

    for (const card of blocked) {
      const summary = extractSummary(card.description) || "This task is blocked and needs your input to proceed.";
      const progress = getChecklistProgress(db, card.id);

      const blockedNotifId = `blocked-${card.id}`;

      // Send push for new blocked cards (first time only)
      if (!pushedNotifications.has(blockedNotifId) && !seenNotifications.has(blockedNotifId)) {
        pushedNotifications.add(blockedNotifId);
        void sendPush("🚧 Card Blocked", card.name, "blocked", card.id);
      }

      notifications.push({
        id: blockedNotifId,
        type: "blocked",
        title: card.name,
        summary: `🔴 Blocked — ${summary}`,
        description: card.description || "",
        cardId: card.id,
        cardName: card.name,
        progress: progress.total > 0 ? progress : undefined,
        actions: [
          {
            label: "Unblock",
            action: "taskQueue.moveCard",
            params: { cardId: card.id, listId: "__approved__" },
            style: "primary",
          },
          {
            label: "Details",
            action: "navigate",
            params: { tab: "task-queue", cardId: card.id },
            style: "default",
          },
        ],
        createdAt: card.updated_at || new Date().toISOString(),
        read: seenNotifications.has(blockedNotifId),
      });
    }

    // ── In-progress cards — status update ────────────────────
    const inProgress = db.prepare(`
      SELECT c.id, c.name, c.description, c.updated_at
      FROM cards c JOIN lists l ON c.list_id = l.id
      WHERE l.name = 'In Progress'
      ORDER BY c.updated_at DESC
    `).all() as Array<{ id: string; name: string; description: string; updated_at: string }>;

    for (const card of inProgress) {
      const progress = getChecklistProgress(db, card.id);
      const pctText = progress.total > 0 ? `${progress.done}/${progress.total} done` : "in progress";

      notifications.push({
        id: `progress-${card.id}`,
        type: "in-progress",
        title: card.name,
        summary: `🔵 Working — ${pctText}`,
        description: card.description || "",
        cardId: card.id,
        cardName: card.name,
        progress: progress.total > 0 ? progress : undefined,
        actions: [
          {
            label: "Details",
            action: "navigate",
            params: { tab: "task-queue", cardId: card.id },
            style: "default",
          },
        ],
        createdAt: card.updated_at || new Date().toISOString(),
        read: true,
      });
    }

    // ── Recently completed (last 5) — informational ──────────
    const completed = db.prepare(`
      SELECT card_id, card_name, ts
      FROM activity
      WHERE category = 'done'
      ORDER BY ts DESC LIMIT 5
    `).all() as Array<{ card_id: string; card_name: string; ts: string }>;

    for (const entry of completed) {
      if (entry.card_id) {
        notifications.push({
          id: `completed-${entry.card_id}-${entry.ts}`,
          type: "completed",
          title: entry.card_name || "task",
          summary: "✅ Completed",
          description: "",
          cardId: entry.card_id,
          cardName: entry.card_name,
          actions: [],
          createdAt: entry.ts,
          read: true,
        });
      }
    }

    // Sort: unread first, then by date
    notifications.sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const unreadCount = notifications.filter((n) => !n.read).length;

    respond(true, {
      notifications,
      unreadCount,
      fetchedAt: Date.now(),
    });
  },
};
