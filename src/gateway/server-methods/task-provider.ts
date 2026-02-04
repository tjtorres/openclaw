/**
 * TaskProvider — abstract interface for task management backends.
 *
 * Providers handle reads + writes for cards, checklists, comments, lists.
 * The RPC layer calls provider methods without knowing whether the backend
 * is Trello, GitHub Issues, Linear, or purely local SQLite.
 *
 * Read operations should prefer the local DB (fast, offline-capable).
 * Write operations should update the external service (if any) AND the local DB.
 */

// ── Domain types ─────────────────────────────────────────────

export type ListInfo = {
  id: string;
  name: string;
  closed: boolean;
};

export type CardSummary = {
  id: string;
  name: string;
  desc: string;
  url: string;
  listId: string;
  listName: string | null;
  labels: string[];
  labelIds: string[];
  hasChecklists: boolean;
  checkItems: number;
  checkItemsChecked: number;
  commentCount: number;
  dateLastActivity: string | null;
};

export type CheckItemInfo = {
  id: string;
  name: string;
  complete: boolean;
};

export type ChecklistInfo = {
  id: string;
  name: string;
  items: CheckItemInfo[];
};

export type CommentInfo = {
  id: string;
  date: string | null;
  text: string;
  author: string;
};

export type CardDetail = {
  card: {
    id: string;
    name: string;
    desc: string;
    idList: string;
    url: string;
    labels: Array<{ id: string; name: string; color?: string }>;
    dateLastActivity: string | null;
  };
  comments: CommentInfo[];
  checklists: ChecklistInfo[];
  source: "db" | "api";
};

export type BoardInfo = {
  id: string;
  name: string;
  url: string;
};

export type ListResult = {
  board: BoardInfo;
  lists: ListInfo[];
  cards: CardSummary[];
  source: "db" | "api";
  lastSynced?: string | null;
  isStale?: boolean;
  fetchedAt: number;
};

export type MutationResult = { ok: boolean };

export type CardMetricsWindow = {
  start: string;
  end: string | null;
  durationMin?: number;
};

export type CardMetricsResult = {
  cardId: string;
  windows: CardMetricsWindow[];
  totalCost: number;
  totalEvents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalDurationMin: number;
  firstEvent?: string | null;
  lastEvent?: string | null;
  byModel: unknown[];
  noDb?: boolean;
  fetchedAt: number;
};

// ── Provider interface ───────────────────────────────────────

export interface TaskProvider {
  /** Provider name for logging/UI (e.g., "trello", "local", "github"). */
  readonly name: string;

  /** Whether this provider is configured and ready to use. */
  isConfigured(): boolean;

  /** Fetch all lists + cards for the board/project. */
  list(): Promise<ListResult>;

  /** Fetch full detail for a single card. */
  cardDetail(cardId: string): Promise<CardDetail | null>;

  /** Move a card to a different list. */
  moveCard(cardId: string, listId: string): Promise<MutationResult>;

  /** Approve a card (provider-specific: labels, status change, etc.). */
  approveCard(cardId: string): Promise<MutationResult>;

  /** Add a comment to a card. */
  addComment(cardId: string, text: string): Promise<MutationResult>;

  /** Toggle a checklist item's completion state. */
  toggleCheckItem(cardId: string, checkItemId: string, complete: boolean): Promise<MutationResult>;

  /** Mark a card as seen / remove "new" indicator. */
  markSeen(cardId: string): Promise<MutationResult>;

  /** Get cost/token metrics for a card (reads from usage DB). */
  cardMetrics(cardId: string): CardMetricsResult;

  /** Pull remote state into local DB (no-op for local-only providers). */
  sync(): Promise<void>;
}

// ── Provider factory ─────────────────────────────────────────

let _activeProvider: TaskProvider | null = null;

/**
 * Get the active task provider.
 * Detected from config: if Trello config exists → TrelloProvider.
 * Otherwise → LocalProvider.
 *
 * Provider is cached for the gateway lifetime. Call resetProvider() to re-detect.
 */
export function getProvider(): TaskProvider {
  if (_activeProvider) return _activeProvider;

  // Try Trello first
  try {
    const { TrelloProvider } = require("./providers/trello.js");
    const provider = new TrelloProvider();
    if (provider.isConfigured()) {
      _activeProvider = provider;
      console.log("[task-provider] Using Trello provider");
      return _activeProvider;
    }
  } catch {}

  // Fallback: local-only
  const { LocalProvider } = require("./providers/local.js");
  _activeProvider = new LocalProvider();
  console.log("[task-provider] Using local-only provider (no external service)");
  return _activeProvider;
}

export function resetProvider(): void {
  _activeProvider = null;
}
