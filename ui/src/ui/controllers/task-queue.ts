import type { GatewayBrowserClient } from "../gateway.ts";
import type { TaskQueueCardDetail, TaskQueueSnapshot } from "../task-queue-types.ts";

export type TaskQueueState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  taskQueueLoading: boolean;
  taskQueueSnapshot: TaskQueueSnapshot | null;
  taskQueueError: string | null;
  taskQueueSelectedCardId: string | null;
  taskQueueCardDetail: TaskQueueCardDetail | null;
  taskQueueCardDetailLoading: boolean;
};

export async function loadTaskQueue(state: TaskQueueState) {
  if (!state.client || !state.connected) return;
  if (state.taskQueueLoading) return;
  state.taskQueueLoading = true;
  state.taskQueueError = null;
  try {
    const res = await state.client.request<TaskQueueSnapshot>("taskQueue.list", {});
    state.taskQueueSnapshot = res;
  } catch (err) {
    state.taskQueueError = String(err);
  } finally {
    state.taskQueueLoading = false;
  }
}

export async function loadCardDetail(state: TaskQueueState, cardId: string) {
  if (!state.client || !state.connected) return;
  state.taskQueueSelectedCardId = cardId;
  state.taskQueueCardDetailLoading = true;
  state.taskQueueCardDetail = null;
  try {
    const [res] = await Promise.all([
      state.client.request<TaskQueueCardDetail>("taskQueue.cardDetail", { cardId }),
      // Mark card as seen (removes "New" label) — fire and forget
      state.client.request("taskQueue.markSeen", { cardId }).catch(() => {}),
    ]);
    state.taskQueueCardDetail = res;
    // Update the snapshot to remove "New" label from the card locally
    if (state.taskQueueSnapshot) {
      const card = state.taskQueueSnapshot.cards.find((c) => c.id === cardId);
      if (card) {
        card.labels = card.labels.filter((l) => l !== "New");
        card.labelIds = card.labelIds.filter(
          (id) =>
            !state.taskQueueSnapshot?.cards.some(
              (c) => c.id === cardId && c.labelIds.includes(id) && c.labels.includes("New"),
            ),
        );
      }
    }
  } catch (err) {
    state.taskQueueError = `Card detail error: ${String(err)}`;
  } finally {
    state.taskQueueCardDetailLoading = false;
  }
}

export async function moveCard(state: TaskQueueState, cardId: string, listId: string) {
  if (!state.client || !state.connected) return;
  try {
    await state.client.request("taskQueue.moveCard", { cardId, listId });
    await loadTaskQueue(state);
  } catch (err) {
    state.taskQueueError = `Move failed: ${String(err)}`;
  }
}

export async function approveCard(state: TaskQueueState, cardId: string) {
  if (!state.client || !state.connected) return;
  try {
    await state.client.request("taskQueue.approveCard", { cardId });
    await loadTaskQueue(state);
  } catch (err) {
    state.taskQueueError = `Approve failed: ${String(err)}`;
  }
}

export async function addComment(state: TaskQueueState, cardId: string, text: string) {
  if (!state.client || !state.connected) return;
  try {
    await state.client.request("taskQueue.addComment", { cardId, text });
    if (state.taskQueueSelectedCardId === cardId) {
      await loadCardDetail(state, cardId);
    }
  } catch (err) {
    state.taskQueueError = `Comment failed: ${String(err)}`;
  }
}

export async function toggleCheckItem(
  state: TaskQueueState,
  cardId: string,
  checkItemId: string,
  complete: boolean,
) {
  if (!state.client || !state.connected) return;
  try {
    await state.client.request("taskQueue.toggleCheckItem", {
      cardId,
      checkItemId,
      complete,
    });
    if (state.taskQueueSelectedCardId === cardId) {
      await loadCardDetail(state, cardId);
    }
  } catch (err) {
    state.taskQueueError = `Toggle failed: ${String(err)}`;
  }
}
