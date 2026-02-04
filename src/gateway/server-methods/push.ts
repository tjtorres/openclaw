/**
 * Web Push notification RPCs.
 *
 * - push.subscribe: Store a push subscription from the browser
 * - push.send: Send a push notification (called internally when proposals/blocks happen)
 * - push.vapidPublicKey: Return the public key for client-side subscription
 *
 * Subscriptions stored in tasks.sqlite.
 * VAPID keys read from workspace/vapid_keys.json.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { getTasksDbWritable, workspacePath, refreshTasksDb } from "./tasks-db.js";

type VapidKeys = { publicKey: string; privateKey: string };

function loadVapidKeys(): VapidKeys | null {
  try {
    const p = join(workspacePath(), "vapid_keys.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function ensurePushTable(): void {
  const db = getTasksDbWritable();
  if (!db) return;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint TEXT UNIQUE NOT NULL,
        keys_p256dh TEXT NOT NULL,
        keys_auth TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        last_used TEXT
      )
    `);
  } finally {
    db.close();
    refreshTasksDb();
  }
}

// Ensure table exists on module load
ensurePushTable();

export const pushHandlers: GatewayRequestHandlers = {
  "push.vapidPublicKey": ({ respond }) => {
    const keys = loadVapidKeys();
    if (!keys) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "VAPID keys not configured"));
      return;
    }
    respond(true, { publicKey: keys.publicKey });
  },

  "push.subscribe": ({ params, respond }) => {
    const { subscription } = params as { subscription?: { endpoint: string; keys: { p256dh: string; auth: string } } };
    if (!subscription?.endpoint || !subscription?.keys) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "subscription required"));
      return;
    }
    const db = getTasksDbWritable();
    if (!db) {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "DB unavailable"));
      return;
    }
    try {
      db.prepare(`
        INSERT OR REPLACE INTO push_subscriptions (endpoint, keys_p256dh, keys_auth, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
      respond(true, { ok: true });
    } finally {
      db.close();
      refreshTasksDb();
    }
  },

  "push.test": ({ respond }) => {
    // Trigger a test push
    void sendPush("Test Notification", "Push notifications are working! 🎉", "alert").then(() => {
      respond(true, { ok: true });
    }).catch((err) => {
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, String(err)));
    });
  },
};

/**
 * Send a push notification to all subscribed browsers.
 */
export async function sendPush(
  title: string,
  body: string,
  type: string,
  cardId?: string,
  actions?: Array<{ label: string; action: string; params: Record<string, unknown> }>,
): Promise<void> {
  const keys = loadVapidKeys();
  if (!keys) return;

  let webPush: typeof import("web-push");
  try {
    webPush = await import("web-push");
  } catch {
    // web-push not installed — skip silently
    console.log("[push] web-push package not available, skipping push notification");
    return;
  }

  webPush.setVapidDetails("mailto:agent@openclaw.local", keys.publicKey, keys.privateKey);

  const { getTasksDb: getDb } = await import("./tasks-db.js");
  const db = getDb();
  if (!db) return;

  const subs = db.prepare("SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions").all() as Array<{
    endpoint: string;
    keys_p256dh: string;
    keys_auth: string;
  }>;

  const payload = JSON.stringify({ title, body, type, cardId, actions, tag: `notif-${type}-${cardId || Date.now()}` });

  for (const sub of subs) {
    try {
      await webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
        },
        payload,
      );
    } catch (err: unknown) {
      // Remove expired/invalid subscriptions
      if (err && typeof err === "object" && "statusCode" in err && ((err as { statusCode: number }).statusCode === 410 || (err as { statusCode: number }).statusCode === 404)) {
        const wdb = getTasksDbWritable();
        if (wdb) {
          wdb.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(sub.endpoint);
          wdb.close();
          refreshTasksDb();
        }
      }
    }
  }
}
