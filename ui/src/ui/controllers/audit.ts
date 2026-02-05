/**
 * Audit controller — data loading and state management for the Audit tab.
 */
import type { GatewayBrowserClient } from "../gateway";
import type { AuditInstance, AuditEntry, AuditSummary, AuditViewMode } from "../views/audit";

export type AuditState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  auditLoading: boolean;
  auditError: string | null;
  auditInstances: AuditInstance[];
  auditEntries: AuditEntry[];
  auditEntriesTotal: number;
  auditRawLogs: string | null;
  auditSummary: AuditSummary | null;
  auditSelectedInstanceId: string | null;
  auditViewMode: AuditViewMode;
  auditFilterAgent: string | null;
};

export function initAuditState(): Omit<AuditState, "client" | "connected"> {
  return {
    auditLoading: false,
    auditError: null,
    auditInstances: [],
    auditEntries: [],
    auditEntriesTotal: 0,
    auditRawLogs: null,
    auditSummary: null,
    auditSelectedInstanceId: null,
    auditViewMode: "actions",
    auditFilterAgent: null,
  };
}

export async function loadAuditData(state: AuditState) {
  if (!state.client || !state.connected) return;
  if (state.auditLoading) return;

  state.auditLoading = true;
  state.auditError = null;

  try {
    // Load instances
    const instancesRes = (await state.client.request("audit.instances", {
      agentId: state.auditFilterAgent ?? undefined,
      limit: 100,
    })) as { instances: AuditInstance[]; total: number };
    state.auditInstances = instancesRes.instances;

    // Load entries (filtered by instance if selected)
    const entriesRes = (await state.client.request("audit.list", {
      instanceId: state.auditSelectedInstanceId ?? undefined,
      agentId: state.auditFilterAgent ?? undefined,
      limit: 100,
    })) as { entries: AuditEntry[]; total: number };
    state.auditEntries = entriesRes.entries;
    state.auditEntriesTotal = entriesRes.total;

    // If an instance is selected and we need logs or summary, load those too
    if (state.auditSelectedInstanceId) {
      if (state.auditViewMode === "logs") {
        const logsRes = (await state.client.request("audit.logs", {
          instanceId: state.auditSelectedInstanceId,
        })) as { logs: string };
        state.auditRawLogs = logsRes.logs;
      } else if (state.auditViewMode === "summary") {
        const summaryRes = (await state.client.request("audit.summary", {
          instanceId: state.auditSelectedInstanceId,
        })) as AuditSummary;
        state.auditSummary = summaryRes;
      }
    }
  } catch (err) {
    state.auditError = String(err);
  } finally {
    state.auditLoading = false;
  }
}

export async function loadAuditLogs(state: AuditState) {
  if (!state.client || !state.connected || !state.auditSelectedInstanceId) return;
  try {
    const res = (await state.client.request("audit.logs", {
      instanceId: state.auditSelectedInstanceId,
    })) as { logs: string };
    state.auditRawLogs = res.logs;
  } catch (err) {
    state.auditRawLogs = `Error loading logs: ${err}`;
  }
}

export async function loadAuditSummary(state: AuditState) {
  if (!state.client || !state.connected || !state.auditSelectedInstanceId) return;
  try {
    const res = (await state.client.request("audit.summary", {
      instanceId: state.auditSelectedInstanceId,
    })) as AuditSummary;
    state.auditSummary = res;
  } catch (err) {
    state.auditError = `Error loading summary: ${err}`;
  }
}
