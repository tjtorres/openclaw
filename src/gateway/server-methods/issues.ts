import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

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

type IssuesFile = {
  issues: Issue[];
  nextId: number;
};

function issuesPath(): string {
  const workspace =
    process.env.OPENCLAW_WORKSPACE ??
    join(process.env.HOME ?? "/home/teej", ".openclaw", "workspace");
  return join(workspace, "issues.json");
}

function readIssues(): IssuesFile {
  const p = issuesPath();
  if (!existsSync(p)) return { issues: [], nextId: 1 };
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return { issues: [], nextId: 1 };
  }
}

function writeIssues(data: IssuesFile): void {
  const p = issuesPath();
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

export const issuesHandlers: GatewayRequestHandlers = {
  "issues.list": ({ params, respond }) => {
    const { status, category, limit } = params as {
      status?: IssueStatus | "all";
      category?: IssueCategory;
      limit?: number;
    };
    const data = readIssues();
    let filtered = data.issues;
    if (status && status !== "all") {
      filtered = filtered.filter((i) => i.status === status);
    }
    if (category) {
      filtered = filtered.filter((i) => i.category === category);
    }
    // Sort: open first, then by creation date desc
    filtered.sort((a, b) => {
      if (a.status === "open" && b.status !== "open") return -1;
      if (b.status === "open" && a.status !== "open") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    if (limit && limit > 0) {
      filtered = filtered.slice(0, limit);
    }
    const counts = {
      open: data.issues.filter((i) => i.status === "open").length,
      resolved: data.issues.filter((i) => i.status === "resolved").length,
      dismissed: data.issues.filter((i) => i.status === "dismissed").length,
      total: data.issues.length,
    };
    respond(true, { issues: filtered, counts, fetchedAt: Date.now() });
  },

  "issues.create": ({ params, respond }) => {
    const {
      title,
      description,
      severity,
      category,
      data: issueData,
    } = params as {
      title?: string;
      description?: string;
      severity?: IssueSeverity;
      category?: IssueCategory;
      data?: Record<string, unknown>;
    };
    if (!title) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "title required"));
      return;
    }
    const file = readIssues();
    const now = new Date().toISOString();
    const issue: Issue = {
      id: `ISS-${String(file.nextId).padStart(3, "0")}`,
      title,
      description: description ?? "",
      severity: severity ?? "info",
      category: category ?? "other",
      status: "open",
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      data: issueData,
    };
    file.issues.push(issue);
    file.nextId++;
    writeIssues(file);
    respond(true, { issue });
  },

  "issues.resolve": ({ params, respond }) => {
    const { id, note } = params as { id?: string; note?: string };
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id required"));
      return;
    }
    const file = readIssues();
    const issue = file.issues.find((i) => i.id === id);
    if (!issue) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `Issue ${id} not found`));
      return;
    }
    const now = new Date().toISOString();
    issue.status = "resolved";
    issue.resolvedAt = now;
    issue.updatedAt = now;
    if (note) {
      issue.data = { ...issue.data, resolveNote: note };
    }
    writeIssues(file);
    respond(true, { issue });
  },

  "issues.dismiss": ({ params, respond }) => {
    const { id, reason } = params as { id?: string; reason?: string };
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id required"));
      return;
    }
    const file = readIssues();
    const issue = file.issues.find((i) => i.id === id);
    if (!issue) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `Issue ${id} not found`));
      return;
    }
    const now = new Date().toISOString();
    issue.status = "dismissed";
    issue.updatedAt = now;
    if (reason) {
      issue.data = { ...issue.data, dismissReason: reason };
    }
    writeIssues(file);
    respond(true, { issue });
  },

  "issues.reopen": ({ params, respond }) => {
    const { id } = params as { id?: string };
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id required"));
      return;
    }
    const file = readIssues();
    const issue = file.issues.find((i) => i.id === id);
    if (!issue) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `Issue ${id} not found`));
      return;
    }
    issue.status = "open";
    issue.resolvedAt = null;
    issue.updatedAt = new Date().toISOString();
    writeIssues(file);
    respond(true, { issue });
  },
};
