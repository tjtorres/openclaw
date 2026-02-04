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

// Cost estimation types
export type CostEstimate = {
  complexity: string;
  model: string;
  tier: string;
  estimated_turns: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_total_tokens: number;
  estimated_cost_usd: number;
  confidence: string;
  calibration_factor: number;
  calibration_samples: number;
  breakdown: {
    input_cost: number;
    output_cost: number;
  };
  range: {
    low: number;
    high: number;
  };
};

export type CostComparison = {
  card_id: string;
  card_name: string;
  complexity: string;
  model: string;
  confidence: string;
  estimated_cost_usd: number;
  actual_cost_usd: number;
  accuracy_ratio?: number;
  accuracy_pct?: number;
  over_under?: string;
  variance_usd?: number;
};

export type CostSummary = {
  total_tracked: number;
  completed: number;
  active: number;
  total_estimated_usd: number;
  total_actual_usd: number;
  avg_accuracy_ratio: number;
  calibration: {
    complexity_factors: Record<string, number>;
    samples_per_complexity: Record<string, number>;
    last_calibrated: string | null;
    total_samples?: number;
  };
  recent: Array<{
    card_id: string;
    name: string;
    complexity: string;
    estimated: number;
    actual: number;
    status: string;
  }>;
};

export type ModelRecommendation = {
  description: string;
  complexity: string;
  task_type: string;
  optimize: string;
  recommended: string;
  recommended_score: number;
  rankings: Array<{
    model: string;
    score: number;
    quality: number;
    speed: number;
    cost_score: number;
    reasoning: number;
    cost_per_1k_tokens: number;
  }>;
  reasoning: string;
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
