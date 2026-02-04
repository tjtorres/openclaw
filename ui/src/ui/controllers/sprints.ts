import type { GatewayBrowserClient } from "../gateway.ts";
import type { SprintsListData } from "../views/sprints.ts";

export type SprintsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sprintsLoading: boolean;
  sprintsData: SprintsListData | null;
  sprintsError: string | null;
  sprintsShowCreateForm: boolean;
};

export async function loadSprints(state: SprintsState) {
  if (!state.client || !state.connected) return;
  if (state.sprintsLoading) return;
  state.sprintsLoading = true;
  state.sprintsError = null;
  try {
    const res = await state.client.request<SprintsListData>("sprints.list", {});
    state.sprintsData = res;
  } catch (err) {
    state.sprintsError = String(err);
  } finally {
    state.sprintsLoading = false;
  }
}

export async function createSprint(
  state: SprintsState,
  name: string,
  goal: string,
  endDate: string,
  pullFromBoard = false,
) {
  if (!state.client || !state.connected) return;
  try {
    await state.client.request("sprints.create", { name, goal, endDate, pullFromBoard });
    state.sprintsShowCreateForm = false;
    await loadSprints(state);
  } catch (err) {
    state.sprintsError = `Create failed: ${String(err)}`;
  }
}

export async function completeSprint(state: SprintsState, sprintId: string) {
  if (!state.client || !state.connected) return;
  try {
    await state.client.request("sprints.update", { sprintId, status: "completed" });
    await loadSprints(state);
  } catch (err) {
    state.sprintsError = `Complete failed: ${String(err)}`;
  }
}

export async function cancelSprint(state: SprintsState, sprintId: string) {
  if (!state.client || !state.connected) return;
  try {
    await state.client.request("sprints.update", { sprintId, status: "cancelled" });
    await loadSprints(state);
  } catch (err) {
    state.sprintsError = `Cancel failed: ${String(err)}`;
  }
}

export async function completeSprintCard(
  state: SprintsState,
  sprintId: string,
  cardId: string,
) {
  if (!state.client || !state.connected) return;
  try {
    await state.client.request("sprints.completeCard", { sprintId, cardId });
    await loadSprints(state);
  } catch (err) {
    state.sprintsError = `Complete card failed: ${String(err)}`;
  }
}
