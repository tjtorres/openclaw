export type TaskQueueCard = {
  id: string;
  name: string;
  desc: string;
  url: string | null;
  listId: string;
  listName: string | null;
  labels: string[];
  labelIds: string[];
  hasChecklists: boolean;
  checkItems: number;
  checkItemsChecked: number;
  commentCount: number;
  dateLastActivity: string;
};

export type TaskQueueList = {
  id: string;
  name: string;
  closed: boolean | null;
};

export type TaskQueueSnapshot = {
  board: { id: string; name: string; url: string | null };
  lists: TaskQueueList[];
  cards: TaskQueueCard[];
  fetchedAt: number;
};

export type TaskQueueComment = {
  id: string;
  date: string;
  text: string;
  author: string;
};

export type TaskQueueCheckItem = {
  id: string;
  name: string;
  complete: boolean;
};

export type TaskQueueChecklist = {
  id: string;
  name: string;
  items: TaskQueueCheckItem[];
};

export type TaskQueueCardDetail = {
  card: Record<string, unknown>;
  comments: TaskQueueComment[];
  checklists: TaskQueueChecklist[];
};

export type CardMetricsModelBreakdown = {
  model: string;
  events: number;
  cost: number;
  input_tokens: number;
  output_tokens: number;
};

export type CardMetrics = {
  cardId: string;
  windows: Array<{ start: string; end: string | null; durationMin: number }>;
  totalCost: number;
  totalEvents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheTokens: number;
  totalDurationMin: number;
  firstEvent: string | null;
  lastEvent: string | null;
  byModel: CardMetricsModelBreakdown[];
  noDb?: boolean;
  fetchedAt: number;
};
