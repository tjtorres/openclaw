/**
 * Provider abstraction for task management backends.
 *
 * Lets different backends (Trello, GitHub Projects, local-only SQLite)
 * plug in behind a unified interface used by the task queue RPC handlers.
 */

// ── Domain types ─────────────────────────────────────────────

export type List = {
  id: string;
  name: string;
  closed: boolean;
};

export type Card = {
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

export type ChecklistItem = {
  id: string;
  name: string;
  complete: boolean;
};

export type Checklist = {
  id: string;
  name: string;
  items: ChecklistItem[];
};

export type Comment = {
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
  comments: Comment[];
  checklists: Checklist[];
};

// ── Provider configuration ───────────────────────────────────

export type ProviderConfig = {
  name: string;
  type: "trello" | "github" | "local";
  config: Record<string, string>;
};

// ── Provider interface ───────────────────────────────────────

export interface TaskProvider {
  /** Fetch all lists (columns/buckets) for the configured board/project. */
  getLists(): Promise<List[]>;

  /** Fetch all open cards across all lists. */
  getCards(): Promise<Card[]>;

  /** Fetch full detail for a single card (description, checklists, comments). */
  getCard(id: string): Promise<CardDetail | null>;

  /** Move a card to a different list. */
  moveCard(id: string, listId: string): Promise<void>;

  /** Add a comment to a card. */
  addComment(id: string, text: string): Promise<void>;

  /** Toggle a checklist item's completion state. */
  toggleCheckItem(cardId: string, itemId: string, complete: boolean): Promise<void>;

  /** Pull remote state into the local database (no-op for local-only provider). */
  syncToLocal(): Promise<void>;
}
