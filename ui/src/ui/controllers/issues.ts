import type { GatewayBrowserClient } from "../gateway.ts";

export type IssueSeverity = "critical" | "warning" | "info";
export type IssueStatus = "open" | "resolved" | "dismissed";
export type IssueCategory = "cost" | "error" | "performance" | "config" | "security" | "other";

export type Issue = {
  id: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  category: IssueCategory;
  status: IssueStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  data?: Record<string, unknown>;
};

export type IssuesCounts = {
  open: number;
  resolved: number;
  dismissed: number;
  total: number;
};

export type IssuesListResult = {
  issues: Issue[];
  counts: IssuesCounts;
  fetchedAt: number;
};

export type IssuesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  issuesLoading: boolean;
  issuesData: IssuesListResult | null;
  issuesError: string | null;
  issuesFilter: IssueStatus | "all";
  issuesBusy: boolean;
};

export async function loadIssues(state: IssuesState) {
  if (!state.client || !state.connected) return;
  if (state.issuesLoading) return;
  state.issuesLoading = true;
  state.issuesError = null;
  try {
    const res = await state.client.request<IssuesListResult>("issues.list", {
      status: state.issuesFilter,
    });
    state.issuesData = res;
  } catch (err) {
    state.issuesError = String(err);
  } finally {
    state.issuesLoading = false;
  }
}

export async function resolveIssue(state: IssuesState, id: string, note?: string) {
  if (!state.client || !state.connected) return;
  state.issuesBusy = true;
  try {
    await state.client.request("issues.resolve", { id, note });
    await loadIssues(state);
  } catch (err) {
    state.issuesError = `Resolve failed: ${String(err)}`;
  } finally {
    state.issuesBusy = false;
  }
}

export async function dismissIssue(state: IssuesState, id: string, reason?: string) {
  if (!state.client || !state.connected) return;
  state.issuesBusy = true;
  try {
    await state.client.request("issues.dismiss", { id, reason });
    await loadIssues(state);
  } catch (err) {
    state.issuesError = `Dismiss failed: ${String(err)}`;
  } finally {
    state.issuesBusy = false;
  }
}

export async function reopenIssue(state: IssuesState, id: string) {
  if (!state.client || !state.connected) return;
  state.issuesBusy = true;
  try {
    await state.client.request("issues.reopen", { id });
    await loadIssues(state);
  } catch (err) {
    state.issuesError = `Reopen failed: ${String(err)}`;
  } finally {
    state.issuesBusy = false;
  }
}
