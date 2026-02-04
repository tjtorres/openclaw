/**
 * Notifications RPC — surfaces actionable items for quick review.
 *
 * Returns pending proposals, blocked items, cost alerts, etc.
 * The dashboard shows these in a bell icon with unread count.
 */
import type { GatewayRequestHandlers } from "./types.js";
import { getTasksDb } from "./tasks-db.js";

export type Notification = {
  id: string;
  type: "proposal" | "blocked" | "alert" | "completed";
  title: string;
  description: string;
  cardId?: string;
  cardName?: string;
  actions: Array<{
    label: string;
    action: string; // RPC method to call
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

export const notificationsHandlers: GatewayRequestHandlers = {
  "notifications.list": ({ respond }) => {
    const db = getTasksDb();
    const notifications: Notification[] = [];

    if (!db) {
      respond(true, { notifications: [], unreadCount: 0, fetchedAt: Date.now() });
      return;
    }

    // 1. Proposed cards — need approval
    const proposed = db.prepare(`
      SELECT c.id, c.name, c.description, c.updated_at
      FROM cards c JOIN lists l ON c.list_id = l.id
      WHERE l.name = 'Proposed'
      ORDER BY c.updated_at DESC
    `).all() as Array<{ id: string; name: string; description: string; updated_at: string }>;

    for (const card of proposed) {
      const approvedList = db.prepare(
        "SELECT id FROM lists WHERE name='Approved' LIMIT 1"
      ).all() as Array<{ id: string }>;
      const approvedListId = approvedList[0]?.id;

      notifications.push({
        id: `proposal-${card.id}`,
        type: "proposal",
        title: card.name,
        description: card.description?.slice(0, 200) || "New task proposal",
        cardId: card.id,
        cardName: card.name,
        actions: [
          {
            label: "Approve",
            action: "taskQueue.approveCard",
            params: { cardId: card.id },
            style: "primary",
          },
          {
            label: "View",
            action: "navigate",
            params: { tab: "task-queue", cardId: card.id },
            style: "default",
          },
        ],
        createdAt: card.updated_at || new Date().toISOString(),
        read: false,
      });
    }

    // 2. Blocked cards — need attention
    const blocked = db.prepare(`
      SELECT c.id, c.name, c.description, c.updated_at
      FROM cards c JOIN lists l ON c.list_id = l.id
      WHERE l.name = 'Blocked'
      ORDER BY c.updated_at DESC
    `).all() as Array<{ id: string; name: string; description: string; updated_at: string }>;

    for (const card of blocked) {
      notifications.push({
        id: `blocked-${card.id}`,
        type: "blocked",
        title: `Blocked: ${card.name}`,
        description: card.description?.slice(0, 200) || "Task is blocked",
        cardId: card.id,
        cardName: card.name,
        actions: [
          {
            label: "View",
            action: "navigate",
            params: { tab: "task-queue", cardId: card.id },
            style: "default",
          },
        ],
        createdAt: card.updated_at || new Date().toISOString(),
        read: false,
      });
    }

    // 3. Recently completed (last 3) — informational
    const completed = db.prepare(`
      SELECT card_id, card_name, ts
      FROM activity
      WHERE category = 'done'
      ORDER BY ts DESC LIMIT 3
    `).all() as Array<{ card_id: string; card_name: string; ts: string }>;

    for (const entry of completed) {
      if (entry.card_id) {
        notifications.push({
          id: `completed-${entry.card_id}-${entry.ts}`,
          type: "completed",
          title: `Completed: ${entry.card_name || "task"}`,
          description: "",
          cardId: entry.card_id,
          cardName: entry.card_name,
          actions: [],
          createdAt: entry.ts,
          read: true, // completions are auto-read
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
