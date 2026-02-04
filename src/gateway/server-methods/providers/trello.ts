/**
 * TrelloProvider — Trello-backed task management.
 *
 * Reads prefer local DB (fast, offline-capable).
 * Writes go to Trello API first, then update the local DB.
 * Config comes from trello_task_queue.json + env vars.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  TaskProvider,
  ListResult,
  CardDetail,
  MutationResult,
  CardMetricsResult,
  CardSummary,
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

type SqliteDatabase = import("node:sqlite").DatabaseSync;

// ── Config ───────────────────────────────────────────────────

type TrelloConfig = {
  boardId: string;
  apiKey: string;
  apiToken: string;
  approvedLabelId: string;
  newLabelId: string;
};

function readConfig(): TrelloConfig | null {
  try {
    const configPath = join(workspacePath(), "trello_task_queue.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const apiKey = process.env.TRELLO_API_KEY;
    const apiToken = process.env.TRELLO_TOKEN;
    if (!apiKey || !apiToken) return null;
    return {
      boardId: config.boardId,
      apiKey,
      apiToken,
      approvedLabelId: config.labels?.approved ?? "",
      newLabelId: config.labels?.new ?? "",
    };
  } catch {
    return null;
  }
}

// ── Trello API helpers ───────────────────────────────────────

function trelloUrl(path: string, key: string, token: string): string {
  return `https://api.trello.com/1${path}${path.includes("?") ? "&" : "?"}key=${key}&token=${token}`;
}

async function putTrello(path: string, key: string, token: string, body?: Record<string, string>) {
  const res = await fetch(trelloUrl(path, key, token), {
    method: "PUT",
    headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (!res.ok) throw new Error(`Trello PUT ${path}: ${res.status}`);
  return res.json();
}

async function postTrello(path: string, key: string, token: string, body?: Record<string, string>) {
  const res = await fetch(trelloUrl(path, key, token), {
    method: "POST",
    headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  if (!res.ok) throw new Error(`Trello POST ${path}: ${res.status}`);
  return res.json();
}

async function deleteTrello(path: string, key: string, token: string) {
  const res = await fetch(trelloUrl(path, key, token), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Trello DELETE ${path}: ${res.status}`);
}

// ── Provider ─────────────────────────────────────────────────

export class TrelloProvider implements TaskProvider {
  readonly name = "trello";
  private config: TrelloConfig | null;

  constructor() {
    this.config = readConfig();
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  private requireConfig(): TrelloConfig {
    if (!this.config) throw new Error("Trello not configured");
    return this.config;
  }

  // ── List ─────────────────────────────────────────────────

  async list(): Promise<ListResult> {
    const cfg = this.requireConfig();

    // Try DB first
    const db = getTasksDb();
    if (db) {
      try {
        return this.listFromDb(db, cfg);
      } catch (err) {
        console.error("[trello-provider] DB read failed, falling back to API:", err);
      }
    }
    return this.listFromApi(cfg);
  }

  private listFromDb(db: SqliteDatabase, cfg: TrelloConfig): ListResult {
    const lists = getLists(db, cfg.boardId);
    const cards = getCardsByBoard(db, cfg.boardId);
    const listMap = new Map(lists.map((l) => [l.id, l.name]));

    const cardData: CardSummary[] = cards.map((c) => {
      const progress = getChecklistProgress(db, c.id);
      let labels: Array<{ id: string; name: string; color?: string }> = [];
      try { labels = JSON.parse(c.labels || "[]"); } catch {}
      const commentCount = db.prepare("SELECT COUNT(*) as cnt FROM comments WHERE card_id=?").all(c.id);

      return {
        id: c.id,
        name: c.name,
        desc: c.description ?? "",
        url: c.url || `https://trello.com/c/${c.id}`,
        listId: c.list_id,
        listName: listMap.get(c.list_id) ?? null,
        labels: labels.map((l) => l.name),
        labelIds: labels.map((l) => l.id),
        hasChecklists: progress.total > 0,
        checkItems: progress.total,
        checkItemsChecked: progress.done,
        commentCount: Number((commentCount[0] as { cnt: number })?.cnt ?? 0),
        dateLastActivity: c.updated_at,
      };
    });

    const syncedTimes = cards.map((c) => c.synced_at).filter(Boolean).sort();
    const lastSynced = syncedTimes.length > 0 ? syncedTimes[syncedTimes.length - 1] : null;
    const staleMs = lastSynced ? Date.now() - new Date(lastSynced!).getTime() : Infinity;

    return {
      board: { id: cfg.boardId, name: "Jeeves Task Queue", url: `https://trello.com/b/${cfg.boardId}` },
      lists: lists.map((l) => ({ id: l.id, name: l.name, closed: false })),
      cards: cardData,
      source: "db",
      lastSynced,
      isStale: staleMs > 5 * 60 * 1000,
      fetchedAt: Date.now(),
    };
  }

  private async listFromApi(cfg: TrelloConfig): Promise<ListResult> {
    const [lists, cards] = await Promise.all([
      fetch(trelloUrl(`/boards/${cfg.boardId}/lists?fields=name,closed`, cfg.apiKey, cfg.apiToken)).then((r) => r.json()),
      fetch(trelloUrl(`/boards/${cfg.boardId}/cards?fields=name,desc,idList,url,labels,idChecklists,dateLastActivity,badges`, cfg.apiKey, cfg.apiToken)).then((r) => r.json()),
    ]) as [
      Array<{ id: string; name: string; closed: boolean }>,
      Array<{ id: string; name: string; desc: string; idList: string; url: string; labels: Array<{ id: string; name: string }>; idChecklists: string[]; dateLastActivity: string; badges: { checkItems: number; checkItemsChecked: number; comments: number } }>,
    ];
    const listMap = new Map(lists.map((l) => [l.id, l.name]));
    return {
      board: { id: cfg.boardId, name: "Jeeves Task Queue", url: `https://trello.com/b/${cfg.boardId}` },
      lists: lists.map((l) => ({ id: l.id, name: l.name, closed: l.closed })),
      cards: cards.map((c) => ({
        id: c.id, name: c.name, desc: c.desc ?? "", url: c.url,
        listId: c.idList, listName: listMap.get(c.idList) ?? null,
        labels: c.labels.map((l) => l.name), labelIds: c.labels.map((l) => l.id),
        hasChecklists: (c.idChecklists?.length ?? 0) > 0,
        checkItems: c.badges?.checkItems ?? 0, checkItemsChecked: c.badges?.checkItemsChecked ?? 0,
        commentCount: c.badges?.comments ?? 0, dateLastActivity: c.dateLastActivity,
      })),
      source: "api",
      fetchedAt: Date.now(),
    };
  }

  // ── Card detail ──────────────────────────────────────────

  async cardDetail(cardId: string): Promise<CardDetail | null> {
    const cfg = this.requireConfig();
    const db = getTasksDb();
    if (db) {
      try {
        const result = this.cardDetailFromDb(db, cardId);
        if (result) return result;
      } catch (err) {
        console.error("[trello-provider] DB cardDetail failed, falling back to API:", err);
      }
    }
    return this.cardDetailFromApi(cfg, cardId);
  }

  private cardDetailFromDb(db: SqliteDatabase, cardId: string): CardDetail | null {
    const card = getCard(db, cardId);
    if (!card) return null;
    const checklists = getChecklists(db, cardId);
    const comments = getComments(db, cardId, 20);
    let labels: Array<{ id: string; name: string; color?: string }> = [];
    try { labels = JSON.parse(card.labels || "[]"); } catch {}
    return {
      card: {
        id: card.id, name: card.name, desc: card.description, idList: card.list_id,
        url: card.url || `https://trello.com/c/${card.id}`, labels, dateLastActivity: card.updated_at,
      },
      comments: comments.map((c) => ({ id: c.id, date: c.created_at, text: c.text, author: c.author })),
      checklists: checklists.map((cl) => ({
        id: cl.id, name: cl.name,
        items: cl.checkItems.map((ci) => ({ id: ci.id, name: ci.name, complete: ci.state === "complete" })),
      })),
      source: "db",
    };
  }

  private async cardDetailFromApi(cfg: TrelloConfig, cardId: string): Promise<CardDetail> {
    const [card, actions, checklists] = await Promise.all([
      fetch(trelloUrl(`/cards/${cardId}?fields=name,desc,idList,url,labels,dateLastActivity`, cfg.apiKey, cfg.apiToken)).then((r) => r.json()),
      fetch(trelloUrl(`/cards/${cardId}/actions?filter=commentCard&limit=20`, cfg.apiKey, cfg.apiToken)).then((r) => r.json()),
      fetch(trelloUrl(`/cards/${cardId}/checklists`, cfg.apiKey, cfg.apiToken)).then((r) => r.json()),
    ]);
    return {
      card,
      comments: (actions as Array<{ id: string; date: string; data: { text: string }; memberCreator: { fullName: string } }>).map((a) => ({
        id: a.id, date: a.date, text: a.data.text, author: a.memberCreator.fullName,
      })),
      checklists: (checklists as Array<{ id: string; name: string; checkItems: Array<{ id: string; name: string; state: string }> }>).map((cl) => ({
        id: cl.id, name: cl.name,
        items: cl.checkItems.map((ci) => ({ id: ci.id, name: ci.name, complete: ci.state === "complete" })),
      })),
      source: "api",
    };
  }

  // ── Mutations (API + DB) ─────────────────────────────────

  async moveCard(cardId: string, listId: string): Promise<MutationResult> {
    const cfg = this.requireConfig();
    await putTrello(`/cards/${cardId}`, cfg.apiKey, cfg.apiToken, { idList: listId });
    const wdb = getTasksDbWritable();
    if (wdb) {
      wdb.prepare("UPDATE cards SET list_id=?, updated_at=datetime('now') WHERE id=?").run(listId, cardId);
      wdb.close();
      refreshTasksDb();
    }
    return { ok: true };
  }

  async approveCard(cardId: string): Promise<MutationResult> {
    const cfg = this.requireConfig();
    if (cfg.approvedLabelId) {
      await postTrello(`/cards/${cardId}/idLabels`, cfg.apiKey, cfg.apiToken, { value: cfg.approvedLabelId }).catch(() => {});
    }
    if (cfg.newLabelId) {
      await deleteTrello(`/cards/${cardId}/idLabels/${cfg.newLabelId}`, cfg.apiKey, cfg.apiToken).catch(() => {});
    }
    const db = getTasksDb();
    const approvedList = db
      ? (db.prepare("SELECT id FROM lists WHERE board_id=? AND name='Approved'").all(cfg.boardId) as Array<{ id: string }>)[0]
      : null;
    if (approvedList?.id) {
      await putTrello(`/cards/${cardId}`, cfg.apiKey, cfg.apiToken, { idList: approvedList.id });
      const wdb = getTasksDbWritable();
      if (wdb) {
        wdb.prepare("UPDATE cards SET list_id=?, updated_at=datetime('now') WHERE id=?").run(approvedList.id, cardId);
        wdb.close();
        refreshTasksDb();
      }
    }
    return { ok: true };
  }

  async addComment(cardId: string, text: string): Promise<MutationResult> {
    const cfg = this.requireConfig();
    const result = await postTrello(`/cards/${cardId}/actions/comments`, cfg.apiKey, cfg.apiToken, { text });
    const wdb = getTasksDbWritable();
    if (wdb && result && typeof result === "object" && "id" in result) {
      wdb.prepare(
        "INSERT OR IGNORE INTO comments (id, card_id, text, author, created_at, synced_at) VALUES (?,?,?,?,datetime('now'),datetime('now'))",
      ).run((result as { id: string }).id, cardId, text, "Jeeves");
      wdb.close();
      refreshTasksDb();
    }
    return { ok: true };
  }

  async toggleCheckItem(cardId: string, checkItemId: string, complete: boolean): Promise<MutationResult> {
    const cfg = this.requireConfig();
    const state = complete ? "complete" : "incomplete";
    await putTrello(`/cards/${cardId}/checkItem/${checkItemId}`, cfg.apiKey, cfg.apiToken, { state });
    const wdb = getTasksDbWritable();
    if (wdb) {
      wdb.prepare("UPDATE checklist_items SET state=? WHERE id=? AND card_id=?").run(state, checkItemId, cardId);
      wdb.close();
      refreshTasksDb();
    }
    return { ok: true };
  }

  async markSeen(cardId: string): Promise<MutationResult> {
    const cfg = this.requireConfig();
    if (cfg.newLabelId) {
      await deleteTrello(`/cards/${cardId}/idLabels/${cfg.newLabelId}`, cfg.apiKey, cfg.apiToken).catch(() => {});
      const wdb = getTasksDbWritable();
      if (wdb) {
        const row = wdb.prepare("SELECT labels FROM cards WHERE id=?").all(cardId) as Array<{ labels: string }>;
        if (row.length > 0) {
          try {
            const labels = JSON.parse(row[0].labels || "[]");
            const filtered = labels.filter((l: { id: string }) => l.id !== cfg.newLabelId);
            wdb.prepare("UPDATE cards SET labels=? WHERE id=?").run(JSON.stringify(filtered), cardId);
          } catch {}
        }
        wdb.close();
        refreshTasksDb();
      }
    }
    return { ok: true };
  }

  cardMetrics(cardId: string): CardMetricsResult {
    return computeCardMetrics(cardId);
  }

  async sync(): Promise<void> {
    // Trigger a full Trello → DB sync via the Python script
    // This is called from the UI "refresh" button
    const { execSync } = require("node:child_process");
    try {
      execSync("python3 scripts/trello_sync.py sync", {
        cwd: workspacePath(),
        timeout: 30000,
        env: { ...process.env },
      });
      refreshTasksDb();
    } catch (err) {
      console.error("[trello-provider] Sync failed:", err);
    }
  }
}
