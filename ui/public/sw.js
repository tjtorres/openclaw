/**
 * Service worker for OpenClaw push notifications.
 *
 * Handles:
 * - Push events → show notification with actions
 * - Notification click → open dashboard tab
 * - Action click → call RPC (approve/reject) via fetch
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const { title, body, type, cardId, actions, tag, icon } = data;

  const opts = {
    body: body || "",
    icon: icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag: tag || `notif-${cardId || Date.now()}`,
    renotify: true,
    requireInteraction: type === "proposal" || type === "blocked",
    data: { cardId, type, actions },
    actions: (actions || []).slice(0, 2).map((a) => ({
      action: a.action,
      title: a.label,
    })),
  };

  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const { cardId, actions } = event.notification.data || {};

  // If an action button was clicked
  if (event.action && actions) {
    const action = actions.find((a) => a.action === event.action);
    if (action && action.action !== "navigate") {
      // Fire RPC via fetch
      event.waitUntil(
        clients.matchAll({ type: "window" }).then((windowClients) => {
          // Post message to any open window to execute the RPC
          for (const client of windowClients) {
            client.postMessage({
              type: "notification-action",
              rpcMethod: action.action,
              rpcParams: action.params,
            });
            client.focus();
            return;
          }
          // No window open — open one
          return clients.openWindow(`/notifications`);
        }),
      );
      return;
    }
  }

  // Default: navigate to task queue with specific card, or notifications tab
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((windowClients) => {
      for (const client of windowClients) {
        client.focus();
        client.postMessage({
          type: "navigate",
          tab: cardId ? "task-queue" : "notifications",
          cardId,
        });
        return;
      }
      return clients.openWindow(cardId ? `/task-queue?card=${cardId}` : "/notifications");
    }),
  );
});
