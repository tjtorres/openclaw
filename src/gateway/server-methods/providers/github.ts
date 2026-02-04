/**
 * GitHubProvider — GitHub Issues as a task management backend.
 *
 * Maps GitHub concepts to task management:
 *   - Issues → Cards
 *   - Labels → Lists (columns): e.g., "status:proposed", "status:in-progress", "status:done"
 *   - Issue comments → Comments
 *   - Task lists in issue body → Checklists
 *   - Milestones → Sprints (optional)
 *
 * Config: github_task_queue.json in workspace:
 *   {
 *     "owner": "myorg",
 *     "repo": "my-tasks",
 *     "labelPrefix": "status:",         // labels like "status:proposed", "status:in-progress"
 *     "defaultLabels": ["proposed", "approved", "in-progress", "blocked", "done"]
 *   }
 *
 * Auth: GITHUB_TOKEN env var or `gh auth` token.
 *
 * Reads prefer local DB (fast, offline-capable).
 * Writes go to GitHub API first, then update local DB.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  TaskProvider,
  ListResult,
  CardDetail,
  MutationResult,
  CardMetricsResult,
  CardSummary,
  ListInfo,
} from "../task-provider.js";
import {
  getTasksDb,
  getTasksDbWritable,
  refreshTasksDb,
  getLists,
  getCardsByBoard,
  getCard,
  getChecklists,
  getChecklistProgress,
  getComments,
  workspacePath,
} from "../tasks-db.js";
import { computeCardMetrics } from "./local.js";

// ── Config ───────────────────────────────────────────────────

type GitHubConfig = {
  owner: string;
  repo: string;
  labelPrefix: string;
  defaultLabels: string[];
  token: string;
};

const DEFAULT_LABELS = ["proposed", "approved", "in-progress", "blocked", "done"];

function readConfig(): GitHubConfig | null {
  try {
    const configPath = join(workspacePath(), "github_task_queue.json");
    if (!existsSync(configPath)) return null;
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
    if (!token || !config.owner || !config.repo) return null;
    return {
      owner: config.owner,
      repo: config.repo,
      labelPrefix: config.labelPrefix || "status:",
      defaultLabels: config.defaultLabels || DEFAULT_LABELS,
      token,
    };
  } catch {
    return null;
  }
}

// ── GitHub API helpers ───────────────────────────────────────

async function ghFetch(cfg: GitHubConfig, path: string, init?: RequestInit): Promise<unknown> {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

async function ghPost(cfg: GitHubConfig, path: string, body: Record<string, unknown>) {
  return ghFetch(cfg, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function ghPatch(cfg: GitHubConfig, path: string, body: Record<string, unknown>) {
  return ghFetch(cfg, path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Helpers ──────────────────────────────────────────────────

/** Extract status label from issue labels. */
function getStatusLabel(labels: Array<{ name: string }>, prefix: string): string | null {
  for (const l of labels) {
    if (l.name.startsWith(prefix)) return l.name.slice(prefix.length);
  }
  return null;
}

/** Build virtual list ID from a status label. */
function listIdFromLabel(label: string): string {
  return `gh-${label}`;
}

/** Parse task list checkboxes from issue body markdown. */
function parseTaskList(body: string): Array<{ name: string; done: boolean }> {
  const items: Array<{ name: string; done: boolean }> = [];
  const re = /^- \[([ xX])\] (.+)$/gm;
  let match;
  while ((match = re.exec(body)) !== null) {
    items.push({ name: match[2].trim(), done: match[1] !== " " });
  }
  return items;
}

/** Map an API issue to our CardSummary format. */
function issueToCard(issue: Record<string, unknown>, cfg: GitHubConfig): CardSummary {
  const labels = (issue.labels as Array<{ id: number; name: string; color?: string }>) || [];
  const status = getStatusLabel(labels, cfg.labelPrefix);
  const listId = status ? listIdFromLabel(status) : listIdFromLabel("proposed");
  const body = (issue.body as string) || "";
  const tasks = parseTaskList(body);

  return {
    id: String(issue.number),
    name: (issue.title as string) || "",
    desc: body,
    url: (issue.html_url as string) || "",
    listId,
    listName: status || "proposed",
    labels: labels.map((l) => l.name),
    labelIds: labels.map((l) => String(l.id)),
    hasChecklists: tasks.length > 0,
    checkItems: tasks.length,
    checkItemsChecked: tasks.filter((t) => t.done).length,
    commentCount: (issue.comments as number) || 0,
    dateLastActivity: (issue.updated_at as string) || null,
  };
}

// ── Provider ─────────────────────────────────────────────────

export class GitHubProvider implements TaskProvider {
  readonly name = "github";
  private config: GitHubConfig | null;

  constructor() {
    this.config = readConfig();
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  private requireConfig(): GitHubConfig {
    if (!this.config) throw new Error("GitHub provider not configured");
    return this.config;
  }

  private boardId(): string {
    const cfg = this.requireConfig();
    return `gh-${cfg.owner}-${cfg.repo}`;
  }

  // ── List ─────────────────────────────────────────────────

  async list(): Promise<ListResult> {
    const cfg = this.requireConfig();

    // Try DB first
    const db = getTasksDb();
    if (db) {
      const lists = getLists(db, this.boardId());
      if (lists.length > 0) {
        const cards = getCardsByBoard(db, this.boardId());
        const listMap = new Map(lists.map((l) => [l.id, l.name]));

        const cardData: CardSummary[] = cards.map((c) => {
          const progress = getChecklistProgress(db, c.id);
          let labels: Array<{ id: string; name: string }> = [];
          try { labels = JSON.parse(c.labels || "[]"); } catch {}
          const commentCount = db.prepare("SELECT COUNT(*) as cnt FROM comments WHERE card_id=?").all(c.id);
          return {
            id: c.id, name: c.name, desc: c.description ?? "", url: c.url || "",
            listId: c.list_id, listName: listMap.get(c.list_id) ?? null,
            labels: labels.map((l) => l.name), labelIds: labels.map((l) => l.id),
            hasChecklists: progress.total > 0, checkItems: progress.total, checkItemsChecked: progress.done,
            commentCount: Number((commentCount[0] as { cnt: number })?.cnt ?? 0),
            dateLastActivity: c.updated_at,
          };
        });

        const syncedTimes = cards.map((c) => c.synced_at).filter(Boolean).sort();
        const lastSynced = syncedTimes.length > 0 ? syncedTimes[syncedTimes.length - 1] : null;

        return {
          board: { id: this.boardId(), name: `${cfg.owner}/${cfg.repo}`, url: `https://github.com/${cfg.owner}/${cfg.repo}/issues` },
          lists: lists.map((l) => ({ id: l.id, name: l.name, closed: false })),
          cards: cardData,
          source: "db",
          lastSynced,
          isStale: lastSynced ? Date.now() - new Date(lastSynced).getTime() > 5 * 60 * 1000 : true,
          fetchedAt: Date.now(),
        };
      }
    }

    // Fallback: GitHub API
    return this.listFromApi(cfg);
  }

  private async listFromApi(cfg: GitHubConfig): Promise<ListResult> {
    const issues = (await ghFetch(cfg, "/issues?state=open&per_page=100&sort=updated")) as Array<Record<string, unknown>>;

    // Build virtual lists from config labels
    const lists: ListInfo[] = cfg.defaultLabels.map((label, i) => ({
      id: listIdFromLabel(label),
      name: label,
      closed: false,
    }));

    const cards = issues.map((issue) => issueToCard(issue, cfg));

    return {
      board: { id: this.boardId(), name: `${cfg.owner}/${cfg.repo}`, url: `https://github.com/${cfg.owner}/${cfg.repo}/issues` },
      lists,
      cards,
      source: "api",
      fetchedAt: Date.now(),
    };
  }

  // ── Card detail ──────────────────────────────────────────

  async cardDetail(cardId: string): Promise<CardDetail | null> {
    const cfg = this.requireConfig();

    // Try DB
    const db = getTasksDb();
    if (db) {
      const card = getCard(db, cardId);
      if (card) {
        const checklists = getChecklists(db, cardId);
        const comments = getComments(db, cardId, 20);
        let labels: Array<{ id: string; name: string; color?: string }> = [];
        try { labels = JSON.parse(card.labels || "[]"); } catch {}
        return {
          card: { id: card.id, name: card.name, desc: card.description, idList: card.list_id, url: card.url || "", labels, dateLastActivity: card.updated_at },
          comments: comments.map((c) => ({ id: c.id, date: c.created_at, text: c.text, author: c.author })),
          checklists: checklists.map((cl) => ({ id: cl.id, name: cl.name, items: cl.checkItems.map((ci) => ({ id: ci.id, name: ci.name, complete: ci.state === "complete" })) })),
          source: "db",
        };
      }
    }

    // Fallback: API
    const [issue, comments] = await Promise.all([
      ghFetch(cfg, `/issues/${cardId}`) as Promise<Record<string, unknown>>,
      ghFetch(cfg, `/issues/${cardId}/comments?per_page=20`) as Promise<Array<Record<string, unknown>>>,
    ]);

    const labels = (issue.labels as Array<{ id: number; name: string; color?: string }>) || [];
    const status = getStatusLabel(labels, cfg.labelPrefix);
    const body = (issue.body as string) || "";
    const tasks = parseTaskList(body);

    return {
      card: {
        id: String(issue.number), name: (issue.title as string) || "", desc: body,
        idList: status ? listIdFromLabel(status) : listIdFromLabel("proposed"),
        url: (issue.html_url as string) || "",
        labels: labels.map((l) => ({ id: String(l.id), name: l.name, color: l.color })),
        dateLastActivity: (issue.updated_at as string) || null,
      },
      comments: comments.map((c) => ({
        id: String(c.id), date: (c.created_at as string) || null,
        text: (c.body as string) || "",
        author: ((c.user as Record<string, unknown>)?.login as string) || "unknown",
      })),
      checklists: tasks.length > 0 ? [{
        id: `tasks-${issue.number}`,
        name: "Tasks",
        items: tasks.map((t, i) => ({ id: `task-${issue.number}-${i}`, name: t.name, complete: t.done })),
      }] : [],
      source: "api",
    };
  }

  // ── Mutations ────────────────────────────────────────────

  async moveCard(cardId: string, listId: string): Promise<MutationResult> {
    const cfg = this.requireConfig();
    const newLabel = listId.replace(/^gh-/, "");

    // Get current labels, remove old status label, add new one
    const issue = (await ghFetch(cfg, `/issues/${cardId}`)) as Record<string, unknown>;
    const currentLabels = ((issue.labels as Array<{ name: string }>) || []).map((l) => l.name);
    const filtered = currentLabels.filter((l) => !l.startsWith(cfg.labelPrefix));
    filtered.push(`${cfg.labelPrefix}${newLabel}`);

    await ghPatch(cfg, `/issues/${cardId}`, { labels: filtered });

    // Update DB
    const wdb = getTasksDbWritable();
    if (wdb) {
      wdb.prepare("UPDATE cards SET list_id=?, updated_at=datetime('now') WHERE id=?").run(listId, cardId);
      wdb.close();
      refreshTasksDb();
    }
    return { ok: true };
  }

  async approveCard(cardId: string): Promise<MutationResult> {
    return this.moveCard(cardId, listIdFromLabel("approved"));
  }

  async addComment(cardId: string, text: string): Promise<MutationResult> {
    const cfg = this.requireConfig();
    const result = (await ghPost(cfg, `/issues/${cardId}/comments`, { body: text })) as Record<string, unknown>;

    const wdb = getTasksDbWritable();
    if (wdb) {
      wdb.prepare(
        "INSERT OR IGNORE INTO comments (id, card_id, text, author, created_at, synced_at) VALUES (?,?,?,?,datetime('now'),datetime('now'))",
      ).run(String(result.id), cardId, text, "agent");
      wdb.close();
      refreshTasksDb();
    }
    return { ok: true };
  }

  async toggleCheckItem(cardId: string, checkItemId: string, complete: boolean): Promise<MutationResult> {
    const cfg = this.requireConfig();

    // Task list items live in the issue body. We need to toggle the checkbox.
    const issue = (await ghFetch(cfg, `/issues/${cardId}`)) as Record<string, unknown>;
    let body = (issue.body as string) || "";
    const tasks = parseTaskList(body);
    const idx = parseInt(checkItemId.replace(`task-${cardId}-`, ""), 10);

    if (idx >= 0 && idx < tasks.length) {
      const re = /^- \[([ xX])\] (.+)$/gm;
      let count = 0;
      body = body.replace(re, (match, check, text) => {
        if (count === idx) {
          count++;
          return `- [${complete ? "x" : " "}] ${text}`;
        }
        count++;
        return match;
      });
      await ghPatch(cfg, `/issues/${cardId}`, { body });
    }

    // Update DB
    const wdb = getTasksDbWritable();
    if (wdb) {
      const state = complete ? "complete" : "incomplete";
      wdb.prepare("UPDATE checklist_items SET state=? WHERE id=? AND card_id=?").run(state, checkItemId, cardId);
      wdb.close();
      refreshTasksDb();
    }
    return { ok: true };
  }

  async markSeen(cardId: string): Promise<MutationResult> {
    // GitHub doesn't have a "new" concept — no-op
    return { ok: true };
  }

  cardMetrics(cardId: string): CardMetricsResult {
    return computeCardMetrics(cardId);
  }

  async sync(): Promise<void> {
    const cfg = this.requireConfig();
    const boardId = this.boardId();
    const wdb = getTasksDbWritable();
    if (!wdb) return;

    try {
      // Ensure lists exist
      const stmt = wdb.prepare(
        "INSERT OR REPLACE INTO lists (id, board_id, name, position, synced_at) VALUES (?,?,?,?,datetime('now'))",
      );
      cfg.defaultLabels.forEach((label, i) => stmt.run(listIdFromLabel(label), boardId, label, i));

      // Fetch all open issues
      const issues = (await ghFetch(cfg, "/issues?state=open&per_page=100&sort=updated")) as Array<Record<string, unknown>>;

      const cardStmt = wdb.prepare(`
        INSERT OR REPLACE INTO cards (id, board_id, list_id, name, description, url, labels, updated_at, synced_at)
        VALUES (?,?,?,?,?,?,?,?,datetime('now'))
      `);

      for (const issue of issues) {
        const card = issueToCard(issue, cfg);
        const labels = (issue.labels as Array<{ id: number; name: string; color?: string }>) || [];
        cardStmt.run(
          card.id, boardId, card.listId, card.name, card.desc, card.url,
          JSON.stringify(labels.map((l) => ({ id: String(l.id), name: l.name, color: l.color }))),
          (issue.updated_at as string) || null,
        );

        // Sync task list items as checklist
        const tasks = parseTaskList(card.desc);
        if (tasks.length > 0) {
          const clId = `tasks-${issue.number}`;
          wdb.prepare("INSERT OR REPLACE INTO checklists (id, card_id, name, position, synced_at) VALUES (?,?,?,?,datetime('now'))").run(clId, card.id, "Tasks", 0);
          wdb.prepare("DELETE FROM checklist_items WHERE checklist_id=?").run(clId);
          const ciStmt = wdb.prepare("INSERT INTO checklist_items (id, checklist_id, card_id, name, state, position, synced_at) VALUES (?,?,?,?,?,?,datetime('now'))");
          tasks.forEach((t, i) => ciStmt.run(`task-${issue.number}-${i}`, clId, card.id, t.name, t.done ? "complete" : "incomplete", i));
        }
      }
    } finally {
      wdb.close();
      refreshTasksDb();
    }
  }
}
