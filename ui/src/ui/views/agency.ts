/**
 * Agency Dashboard view — integrated with OpenClaw's UX patterns
 *
 * Provides:
 *   - Swarm hierarchy with trust scores
 *   - Kanban board matching task-queue style with approval buttons
 *   - Cost analytics
 *   - Event stream with notification-style badges
 */
import { html, nothing } from "lit";
import { formatAgo } from "../format.ts";

// Agency API configuration
const AGENCY_API_URL = "https://srv1318413.tailba1595.ts.net:8765";

// === Types ===

export type AgencyTabId = "hierarchy" | "kanban" | "sprints" | "costs" | "events" | "audit";

export type AgencyViewProps = {
  loading: boolean;
  error: string | null;
  hierarchy: AgencyHierarchy | null;
  kanban: AgencyKanban | null;
  sprints: AgencySprintsData | null;
  costs: AgencyCosts | null;
  events: AgencyEvent[];
  auditEntries: AuditEntry[];
  auditInstances: AuditInstance[];
  auditViolations: AuditViolation[];
  auditSelectedInstanceId: string | null;
  activeTab: AgencyTabId;
  selectedCardId: string | null;
  showSprintForm: boolean;
  costEstimates: Map<string, CostEstimate>;
  modelRecommendations: Map<string, ModelRecommendation>;
  onTabChange: (tab: AgencyTabId) => void;
  onRefresh: () => void;
  onSelectCard: (runId: string | null) => void;
  onCloseCard: () => void;
  onApproveTask: (runId: string) => void;
  onRejectTask: (runId: string) => void;
  onMoveTask: (runId: string, status: string) => void;
  onSelectAuditInstance: (instanceId: string | null) => void;
  // Sprint actions
  onToggleSprintForm: () => void;
  onCreateSprint: (name: string, goal: string, endDate: string, pullFromBoard: boolean) => void;
  onCompleteSprint: (sprintId: string) => void;
  onCancelSprint: (sprintId: string) => void;
  onCompleteSprintCard: (sprintId: string, cardId: string) => void;
  // Cost estimation
  onEstimateCost: (runId: string, description: string) => void;
  onRecommendModel: (runId: string, description: string, optimize: string) => void;
};

export type AgencyHierarchy = {
  root: AgentNode;
  fetchedAt: number;
};

// Sprint types
export type SprintCard = {
  cardId: string;
  cardName: string;
  addedAt: string;
  completedAt: string | null;
};

export type BurndownPoint = {
  date: string;
  remaining: number;
  completed: number;
  total: number;
};

export type VelocityEntry = {
  sprintId: string;
  name: string;
  completed: number;
  total: number;
  days: number;
};

export type SprintData = {
  id: string;
  name: string;
  goal: string;
  status: "active" | "completed" | "cancelled";
  startDate: string;
  endDate: string;
  cards: SprintCard[];
  cardCount: number;
  completedCount: number;
  burndown?: BurndownPoint[];
  createdAt: string;
  completedAt: string | null;
};

export type AgencySprintsData = {
  sprints: SprintData[];
  active: SprintData | null;
  velocity: VelocityEntry[];
  fetchedAt: number;
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
  range: {
    low: number;
    high: number;
  };
  breakdown: {
    input_cost: number;
    output_cost: number;
  };
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
};

export type AgentNode = {
  id: string;
  name: string;
  role: string;
  level: string;
  status: string;
  trustScore: number;
  emoji?: string;
  currentTask?: string;
  children: AgentNode[];
  activeCount?: number;
  recentTasks?: Array<{ task: string; status: string; cost?: number; completedAt?: string }>;
  instances?: Array<{
    instance_id: string;
    status: string;
    assigned_task?: string;
    spawned_at: string;
    cost?: number;
  }>;
  // Live activity fields
  health?: "healthy" | "degraded" | "stalled" | "offline";
  lastActivityAt?: string;
  lastActivityMsg?: string;
  currentThinking?: string; // Latest thought/reasoning preview
  activeTasks?: Array<{
    run_id: string;
    goal: string;
    status: string;
    progress_percent?: number;
    started_at?: string;
    cost?: number;
  }>;
  recentActivity?: Array<{
    timestamp: string;
    type: string;
    message: string;
    category?: string;
  }>;
  metrics?: {
    tasks_completed: number;
    tasks_failed: number;
    avg_response_time_ms: number;
    total_cost: number;
  };
};

export type AgencyKanban = {
  backlog: KanbanCard[];
  in_progress: KanbanCard[];
  completed: KanbanCard[];
  failed: KanbanCard[];
};

export type KanbanCard = {
  run_id: string;
  goal: string;
  agent_id: string;
  status: string;
  total_cost?: number;
  direct_cost?: number;
  child_count?: number;
  active_children?: number;
  progress_percent?: number;
  created_at?: string;
  started_at?: string;
  ended_at?: string;
  needs_approval?: boolean;
  description?: string;
  // Cost estimation fields
  cost_confidence?: number;
  token_estimate?: number;
  model?: string;
  model_recommendations?: Array<{ model: string; cost: number }>;
  // Labeling/categorization
  priority?: "low" | "medium" | "high";
  agent_type?: string;
  labels?: string[];
};

export type AgencyCosts = {
  total_cost: number;
  total_runs: number;
  avg_cost_per_run: number;
  agents?: Array<{
    agent_id: string;
    total_runs: number;
    total_cost: number;
    avg_cost: number;
    success_rate: number;
  }>;
  by_model?: Array<{
    model: string;
    runs: number;
    cost: number;
  }>;
  estimation_accuracy?: {
    avg_accuracy_pct: number | null;
    sample_count: number;
    comparisons: Array<{
      estimated: number;
      actual: number;
      complexity: string;
      ratio: number;
      accuracy_pct: number;
      over_under: "over" | "under";
    }>;
  } | null;
};

export type AgencyEvent = {
  id: number;
  timestamp: string;
  category: string;
  type: string;
  message: string;
  agent_id?: string;
  run_id?: string;
};

// Audit types (matching OpenClaw audit.ts patterns)
export type AuditEntry = {
  id: number;
  ts: string;
  agentId: string | null;
  instanceId: string | null;
  action: string;
  target: string | null;
  targetType: string | null;
  status: string;
  cost: number | null;
  durationMs: number | null;
  detail: string | null;
  category: string;
};

export type AuditInstance = {
  instanceId: string;
  agentId: string;
  instanceNum: number;
  status: string;
  assignedTask: string | null;
  taskSummary: string | null;
  model: string | null;
  cost: number;
  spawnedAt: string;
  lastActiveAt: string;
  tornDownAt: string | null;
  actionCount: number;
};

export type AuditViolation = {
  id: number;
  ts: string;
  agentId: string | null;
  runId: string | null;
  type: string;
  category: string;
  message: string;
  action: string | null;
  target: string | null;
  targetType: string | null;
  reason: string | null;
  severity: "warning" | "error";
};

// === State ===

export type AgencyState = {
  agencyLoading: boolean;
  agencyError: string | null;
  agencyHierarchy: AgencyHierarchy | null;
  agencyKanban: AgencyKanban | null;
  agencyCosts: AgencyCosts | null;
  agencyEvents: AgencyEvent[];
  agencyAuditEntries: AuditEntry[];
  agencyAuditInstances: AuditInstance[];
  agencyAuditViolations: AuditViolation[];
  agencyAuditSelectedInstance: string | null;
  agencyTab: "hierarchy" | "kanban" | "costs" | "events" | "audit";
  agencySelectedCard: string | null;
};

// === Data Loading ===

export async function loadAgencyData(state: AgencyState) {
  state.agencyLoading = true;
  state.agencyError = null;

  try {
    const [hierarchy, kanban, costs, events, auditEntries, auditInstances, auditViolations] =
      await Promise.all([
        fetch(`${AGENCY_API_URL}/api/swarm/hierarchy`).then((r) => r.json()),
        fetch(`${AGENCY_API_URL}/api/goals/kanban`).then((r) => r.json()),
        fetch(`${AGENCY_API_URL}/api/costs/summary?days=7`).then((r) => r.json()),
        fetch(`${AGENCY_API_URL}/api/events/stream?limit=50`).then((r) => r.json()),
        fetch(`${AGENCY_API_URL}/api/audit/entries?limit=100`).then((r) => r.json()),
        fetch(`${AGENCY_API_URL}/api/audit/instances`).then((r) => r.json()),
        fetch(`${AGENCY_API_URL}/api/audit/violations?limit=50`).then((r) => r.json()),
      ]);

    state.agencyHierarchy = hierarchy;
    state.agencyKanban = kanban;
    state.agencyCosts = costs;
    state.agencyEvents = events;
    state.agencyAuditEntries = auditEntries;
    state.agencyAuditInstances = auditInstances;
    state.agencyAuditViolations = auditViolations;
    state.agencyLoading = false;
  } catch (err) {
    state.agencyError = `Failed to connect to Agency API: ${err}`;
    state.agencyLoading = false;
  }
}

// === Styles (matching OpenClaw task-queue patterns) ===

const styles = html`
  <style>
    /* Tabs */
    .ag-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border, #333);
      padding-bottom: 12px;
    }
    .ag-tab {
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted, #888);
      transition: all 0.15s;
    }
    .ag-tab:hover {
      background: var(--bg-hover, rgba(255, 255, 255, 0.05));
    }
    .ag-tab.active {
      background: var(--accent, #1f6feb);
      color: white;
      border-color: var(--accent, #1f6feb);
    }

    /* Kanban header stats */
    .ag-kanban-header {
      display: flex;
      align-items: center;
      gap: 20px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .ag-stats {
      display: flex;
      gap: 20px;
    }
    .ag-stat {
      text-align: center;
    }
    .ag-stat-num {
      font-size: 24px;
      font-weight: 700;
    }
    .ag-stat-label {
      font-size: 11px;
      opacity: 0.5;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .ag-stat--active .ag-stat-num {
      color: #58a6ff;
    }
    .ag-stat--progress .ag-stat-num {
      color: #d29922;
    }
    .ag-stat--done .ag-stat-num {
      color: #238636;
    }
    .ag-overall-progress {
      flex: 1;
      min-width: 120px;
      max-width: 300px;
    }
    .ag-overall-bar {
      height: 8px;
      background: var(--border, #333);
      border-radius: 4px;
      overflow: hidden;
    }
    .ag-overall-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.5s ease;
    }
    .ag-overall-text {
      font-size: 11px;
      opacity: 0.5;
      margin-top: 4px;
    }

    /* Board layout */
    .ag-board {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding: 4px 0 8px;
      min-height: 300px;
    }

    /* Kanban columns */
    .ag-column {
      min-width: 220px;
      max-width: 280px;
      flex: 1 0 220px;
      background: var(--bg-hover, #1a1a2e);
      border-radius: 10px;
      display: flex;
      flex-direction: column;
    }
    .ag-column--backlog {
      border-top: 3px solid #8b5cf6;
    }
    .ag-column--in-progress {
      border-top: 3px solid #1f6feb;
    }
    .ag-column--completed {
      border-top: 3px solid #238636;
      opacity: 0.85;
    }
    .ag-column--failed {
      border-top: 3px solid #da3633;
    }
    .ag-column-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border, #333);
    }
    .ag-column-title {
      font-weight: 600;
      font-size: 13px;
    }
    .ag-column-count {
      font-size: 11px;
      background: var(--border, #333);
      padding: 2px 7px;
      border-radius: 10px;
      font-weight: 600;
    }
    .ag-column-body {
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      overflow-y: auto;
      flex: 1;
      max-height: 500px;
    }
    .ag-empty {
      padding: 12px;
      text-align: center;
      opacity: 0.3;
      font-size: 13px;
    }

    /* Cards */
    .ag-card {
      background: var(--panel, #0d1117);
      border: 1px solid var(--border, #333);
      border-radius: 8px;
      padding: 10px 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .ag-card:hover {
      border-color: var(--border-hover, #555);
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }
    .ag-card--selected {
      border-color: #58a6ff;
      box-shadow: 0 0 0 1px #58a6ff;
      box-shadow: 0 0 0 1px var(--accent, #1f6feb);
    }
    .ag-card-title {
      font-size: 0.85rem;
      font-weight: 500;
      margin-bottom: 8px;
      line-height: 1.4;
    }
    .ag-card-meta {
      display: flex;
      justify-content: space-between;
      font-size: 0.7rem;
      color: var(--text-muted, #888);
    }

    /* Progress bar */
    .ag-progress {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }
    .ag-progress-bar {
      flex: 1;
      height: 6px;
      background: var(--bg-hover, #242442);
      border-radius: 3px;
      overflow: hidden;
    }
    .ag-progress-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s;
    }
    .ag-progress-text {
      font-size: 0.7rem;
      color: var(--text-muted, #888);
    }

    /* Cost badge */
    .ag-cost-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    /* Action buttons (matching notifications.ts) */
    .ag-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .ag-btn {
      border: none;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition:
        opacity 0.15s,
        transform 0.1s;
    }
    .ag-btn:hover {
      opacity: 0.9;
    }
    .ag-btn:active {
      transform: scale(0.97);
    }
    .ag-btn--approve {
      background: #43a047;
      color: white;
    }
    .ag-btn--reject {
      background: transparent;
      color: #e53935;
      border: 1px solid #e53935;
    }
    .ag-btn--move {
      background: var(--bg-hover, #242442);
      color: var(--text, #e0e0e0);
      border: 1px solid var(--border, #333);
    }

    /* Agent hierarchy */
    .ag-agent {
      padding: 12px;
      margin-bottom: 8px;
      background: var(--panel, #1a1a2e);
      border-radius: 8px;
      border-left: 3px solid var(--agent-color, #6b7280);
    }
    .ag-agent-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .ag-agent-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .ag-agent-emoji {
      font-size: 1.4rem;
    }
    .ag-agent-name {
      font-weight: 600;
    }
    .ag-agent-role {
      font-size: 0.8rem;
      color: var(--text-muted, #888);
    }
    .ag-agent-status {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .ag-status-badge {
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.7rem;
      font-weight: 500;
      text-transform: uppercase;
    }
    .ag-trust-score {
      font-size: 0.8rem;
      color: var(--text-muted, #888);
    }
    .ag-agent-task {
      margin-top: 8px;
      font-size: 0.85rem;
      color: var(--text-muted, #888);
      padding: 8px;
      background: var(--bg-hover, rgba(255, 255, 255, 0.03));
      border-radius: 6px;
    }
    .ag-agent-children {
      margin-left: 24px;
      margin-top: 8px;
      border-left: 2px solid var(--border, #333);
      padding-left: 12px;
    }
    .ag-instance-count {
      font-size: 0.7rem;
      background: var(--accent, #1f6feb);
      color: white;
      padding: 2px 6px;
      border-radius: 10px;
    }

    /* Events (notification style) */
    .ag-event {
      display: flex;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border, #333);
    }
    .ag-event:last-child {
      border-bottom: none;
    }
    .ag-event-time {
      color: var(--text-muted, #888);
      font-size: 0.75rem;
      width: 70px;
      flex-shrink: 0;
    }
    .ag-event-badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .ag-event-message {
      flex: 1;
      font-size: 0.85rem;
    }
    .ag-event-agent {
      color: var(--text-muted, #888);
      font-size: 0.75rem;
    }

    /* Stats cards for costs view (grid layout) */
    .ag-costs-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }
    .ag-costs-stats .ag-stat {
      background: var(--panel, #1a1a2e);
      border-radius: 10px;
      padding: 20px;
      text-align: center;
    }
    .ag-costs-stats .ag-stat-value {
      font-size: 2rem;
      font-weight: 700;
    }
    .ag-costs-stats .ag-stat-label {
      font-size: 0.8rem;
      color: var(--text-muted, #888);
      margin-top: 4px;
    }

    /* Model breakdown */
    .ag-model-breakdown {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .ag-model-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .ag-model-name {
      min-width: 140px;
      font-size: 0.9rem;
      color: var(--text-muted, #888);
    }
    .ag-model-bar-container {
      flex: 1;
      height: 8px;
      background: var(--border, #333);
      border-radius: 4px;
      overflow: hidden;
    }
    .ag-model-bar {
      height: 100%;
      background: linear-gradient(90deg, #238636, #1f6feb);
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    .ag-model-cost {
      min-width: 70px;
      text-align: right;
      font-weight: 600;
      color: #238636;
    }
    .ag-model-runs {
      min-width: 60px;
      font-size: 0.8rem;
      color: var(--text-muted, #666);
    }

    /* Cost table */
    .ag-table {
      width: 100%;
      border-collapse: collapse;
    }
    .ag-table th {
      text-align: left;
      padding: 10px;
      color: var(--text-muted, #888);
      font-size: 0.75rem;
      font-weight: 500;
      text-transform: uppercase;
      border-bottom: 1px solid var(--border, #333);
    }
    .ag-table td {
      padding: 10px;
      border-bottom: 1px solid var(--border, #333);
      font-size: 0.85rem;
    }
    .ag-table tr:hover {
      background: var(--bg-hover, rgba(255, 255, 255, 0.03));
    }

    /* Detail panel (matching task-queue.ts) */
    .ag-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 100;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 48px;
      overflow-y: auto;
      backdrop-filter: blur(4px);
    }
    .ag-panel {
      background: var(--panel, #1a1a2e);
      border: 1px solid var(--border-strong, #444);
      border-radius: 14px;
      width: 95%;
      max-width: 640px;
      max-height: 85vh;
      overflow-y: auto;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
    }
    .ag-panel-header {
      display: flex;
      gap: 12px;
      padding: 20px 20px 12px;
    }
    .ag-panel-title {
      font-size: 18px;
      font-weight: 600;
      line-height: 1.3;
      flex: 1;
    }
    .ag-panel-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      margin-top: 8px;
    }
    .ag-list-badge {
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid;
      background: var(--bg-muted, #0d1117);
    }
    .ag-close {
      background: none;
      border: none;
      color: var(--text, #e0e0e0);
      font-size: 20px;
      cursor: pointer;
      padding: 4px 8px;
      opacity: 0.4;
      border-radius: 6px;
    }
    .ag-close:hover {
      opacity: 1;
      background: var(--border, #333);
    }
    .ag-panel-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 0 20px 14px;
      border-bottom: 1px solid var(--border, #333);
    }
    .ag-btn-approve {
      background: #238636;
      color: #fff;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
    }
    .ag-btn-approve:hover {
      background: #2ea043;
    }
    .ag-btn-reject {
      background: transparent;
      color: #da3633;
      border: 1px solid #da3633;
      padding: 6px 14px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
    }
    .ag-btn-reject:hover {
      background: rgba(218, 54, 51, 0.1);
    }
    .ag-select {
      background: var(--bg-muted, #0d1117);
      color: var(--text, #e0e0e0);
      border: 1px solid var(--border-strong, #444);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 13px;
    }
    .ag-section {
      padding: 14px 20px;
      border-top: 1px solid var(--bg-muted, #0d1117);
    }
    .ag-section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.4;
      margin-bottom: 8px;
    }
    .ag-desc {
      font-size: 14px;
      line-height: 1.6;
      white-space: pre-wrap;
      opacity: 0.8;
    }

    /* Cost estimate in panel */
    .ag-cost-detail {
      margin-top: 8px;
    }
    .ag-cost-main {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 6px;
    }
    .ag-cost-amount {
      font-size: 20px;
      font-weight: 700;
      color: #10b981;
    }
    .ag-cost-range {
      font-size: 12px;
      opacity: 0.5;
    }
    .ag-cost-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 12px;
      opacity: 0.7;
      margin-bottom: 6px;
    }
    .ag-cost-meta span {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .ag-cost-tokens {
      font-size: 12px;
      opacity: 0.5;
    }
    .ag-cost-compare {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .ag-cost-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .ag-cost-label {
      opacity: 0.5;
      font-size: 12px;
    }
    .ag-cost-value {
      font-weight: 600;
    }

    /* Metrics grid (matching task-queue.ts) */
    .ag-metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .ag-metric-card {
      background: var(--bg-muted, #0d1117);
      border-radius: 8px;
      padding: 12px 10px;
      text-align: center;
      border: 1px solid var(--border, #333);
    }
    .ag-metric-value {
      font-size: 18px;
      font-weight: 700;
    }
    .ag-metric-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.5;
      margin-top: 2px;
    }
    .ag-model-breakdown {
      margin-top: 12px;
    }
    .ag-model-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 12px;
    }
    .ag-model-name {
      width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.7;
    }
    .ag-model-bar-container {
      flex: 1;
      height: 6px;
      background: var(--border, #333);
      border-radius: 3px;
      overflow: hidden;
    }
    .ag-model-bar {
      height: 100%;
      background: #58a6ff;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .ag-model-cost {
      width: 60px;
      text-align: right;
      font-weight: 600;
      opacity: 0.8;
    }

    /* Activity log in panel */
    .ag-activity-list {
      max-height: 200px;
      overflow-y: auto;
    }
    .ag-activity-entry {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      font-size: 13px;
    }
    .ag-activity-icon {
      width: 20px;
      text-align: center;
    }
    .ag-activity-msg {
      flex: 1;
    }
    .ag-activity-ts {
      font-size: 11px;
      opacity: 0.4;
    }
    .ag-cat-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 6px;
    }

    /* Labels on cards */
    .ag-labels {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }
    .ag-label {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 3px;
      color: #fff;
      font-weight: 500;
    }

    /* === LIVE VIEW STYLES === */

    /* Health indicator */
    .ag-health {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 500;
    }
    .ag-health-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
    }
    .ag-health-dot--healthy {
      background: #238636;
      box-shadow: 0 0 6px #238636;
    }
    .ag-health-dot--degraded {
      background: #f59e0b;
      box-shadow: 0 0 6px #f59e0b;
      animation: pulse-fast 1s ease-in-out infinite;
    }
    .ag-health-dot--stalled {
      background: #da3633;
      box-shadow: 0 0 6px #da3633;
      animation: pulse-alert 0.5s ease-in-out infinite;
    }
    .ag-health-dot--offline {
      background: #6b7280;
      animation: none;
    }
    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.6;
        transform: scale(0.9);
      }
    }
    @keyframes pulse-fast {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.4;
      }
    }
    @keyframes pulse-alert {
      0%,
      100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.5;
        transform: scale(1.2);
      }
    }

    /* Enhanced agent card for live view */
    .ag-agent-live {
      background: var(--panel, #1a1a2e);
      border: 1px solid var(--border, #333);
      border-radius: 12px;
      margin-bottom: 12px;
      overflow: hidden;
      transition:
        border-color 0.2s ease,
        box-shadow 0.2s ease;
    }
    .ag-agent-live:hover {
      border-color: var(--border-strong, #444);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }
    .ag-agent-live--active {
      border-color: #1f6feb;
      box-shadow: 0 0 0 1px rgba(31, 111, 235, 0.3);
    }
    .ag-agent-live--stalled {
      border-color: #da3633;
    }
    .ag-agent-live-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      background: var(--bg-muted, #0d1117);
      border-bottom: 1px solid var(--border, #333);
    }
    .ag-agent-live-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .ag-agent-live-avatar {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--agent-color, #1f6feb), #8b5cf6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }
    .ag-agent-live-name {
      font-weight: 600;
      font-size: 15px;
    }
    .ag-agent-live-role {
      font-size: 12px;
      color: var(--text-muted, #888);
      margin-top: 2px;
    }
    .ag-agent-live-status {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .ag-agent-live-metrics {
      display: flex;
      gap: 12px;
      font-size: 11px;
      color: var(--text-muted, #888);
    }
    .ag-agent-live-metrics span {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* Active tasks section */
    .ag-agent-tasks {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border, #333);
    }
    .ag-agent-tasks-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted, #888);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ag-task-mini {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      background: var(--bg-muted, #0d1117);
      border-radius: 8px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .ag-task-mini:hover {
      background: var(--bg-hover, rgba(255, 255, 255, 0.05));
    }
    .ag-task-mini:last-child {
      margin-bottom: 0;
    }
    .ag-task-mini-status {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .ag-task-mini-goal {
      flex: 1;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ag-task-mini-progress {
      width: 60px;
      height: 4px;
      background: var(--border, #333);
      border-radius: 2px;
      overflow: hidden;
    }
    .ag-task-mini-progress-fill {
      height: 100%;
      background: #1f6feb;
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .ag-task-mini-cost {
      font-size: 11px;
      color: #10b981;
      font-weight: 500;
    }
    .ag-task-mini-link {
      font-size: 12px;
      color: var(--text-muted, #888);
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .ag-task-mini:hover .ag-task-mini-link {
      opacity: 1;
    }

    /* Live activity stream */
    .ag-agent-activity {
      padding: 12px 16px;
      max-height: 150px;
      overflow-y: auto;
    }
    .ag-activity-stream {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .ag-activity-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 12px;
      padding: 4px 0;
      animation: fadeIn 0.3s ease;
    }
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    .ag-activity-item-time {
      color: var(--text-muted, #888);
      font-size: 10px;
      min-width: 50px;
      flex-shrink: 0;
    }
    .ag-activity-item-icon {
      width: 16px;
      text-align: center;
      flex-shrink: 0;
    }
    .ag-activity-item-msg {
      flex: 1;
      line-height: 1.4;
    }

    /* Thinking preview */
    .ag-thinking {
      padding: 12px 16px;
      background: rgba(139, 92, 246, 0.08);
      border-top: 1px solid rgba(139, 92, 246, 0.2);
    }
    .ag-thinking-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: #8b5cf6;
      font-weight: 500;
      margin-bottom: 8px;
    }
    .ag-thinking-dots {
      display: flex;
      gap: 3px;
    }
    .ag-thinking-dots span {
      width: 4px;
      height: 4px;
      background: #8b5cf6;
      border-radius: 50%;
      animation: thinking-bounce 1.4s ease-in-out infinite;
    }
    .ag-thinking-dots span:nth-child(1) {
      animation-delay: 0s;
    }
    .ag-thinking-dots span:nth-child(2) {
      animation-delay: 0.2s;
    }
    .ag-thinking-dots span:nth-child(3) {
      animation-delay: 0.4s;
    }
    @keyframes thinking-bounce {
      0%,
      80%,
      100% {
        transform: translateY(0);
      }
      40% {
        transform: translateY(-4px);
      }
    }
    .ag-thinking-text {
      font-size: 12px;
      color: var(--text, #e0e0e0);
      opacity: 0.8;
      font-style: italic;
      line-height: 1.5;
      max-height: 60px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
    }

    /* Stall warning */
    .ag-stall-warning {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      background: rgba(218, 54, 51, 0.1);
      border-top: 1px solid rgba(218, 54, 51, 0.3);
      font-size: 12px;
      color: #da3633;
    }
    .ag-stall-warning-icon {
      animation: pulse-alert 0.5s ease-in-out infinite;
    }

    /* Agent children in live view */
    .ag-agent-children-live {
      padding: 0 16px 16px;
    }
    .ag-children-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-muted, #888);
      cursor: pointer;
      padding: 8px 0;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
    }
    .ag-children-toggle:hover {
      color: var(--text, #e0e0e0);
    }
    .ag-children-toggle-icon {
      transition: transform 0.2s ease;
    }
    .ag-children-toggle-icon--open {
      transform: rotate(90deg);
    }
    .ag-children-list {
      margin-left: 20px;
      border-left: 2px solid var(--border, #333);
      padding-left: 16px;
    }
  </style>
`;

// === Render Helpers ===

const statusColors: Record<string, string> = {
  working: "#1f6feb",
  running: "#1f6feb",
  active: "#10b981",
  idle: "#6b7280",
  completed: "#238636",
  failed: "#da3633",
  pending: "#8b5cf6",
};

const eventBadgeColors: Record<string, { bg: string; fg: string }> = {
  run: { bg: "rgba(59, 130, 246, 0.2)", fg: "#3b82f6" },
  tool: { bg: "rgba(139, 92, 246, 0.2)", fg: "#8b5cf6" },
  context: { bg: "rgba(245, 158, 11, 0.2)", fg: "#f59e0b" },
  node: { bg: "rgba(16, 185, 129, 0.2)", fg: "#10b981" },
  safety: { bg: "rgba(239, 68, 68, 0.2)", fg: "#ef4444" },
  system: { bg: "rgba(107, 114, 128, 0.2)", fg: "#6b7280" },
};

function renderProgress(done: number, total: number) {
  if (total === 0) return nothing;
  const pct = Math.round((done / total) * 100);
  const color = pct === 100 ? "#238636" : pct > 50 ? "#1f6feb" : "#6b7280";
  return html`
    <div class="ag-progress">
      <div class="ag-progress-bar">
        <div class="ag-progress-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="ag-progress-text">${done}/${total}</span>
    </div>
  `;
}

// Health status helpers
function getHealthLabel(health: string | undefined): string {
  switch (health) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Slow";
    case "stalled":
      return "Stalled!";
    case "offline":
      return "Offline";
    default:
      return "Unknown";
  }
}

function detectStall(agent: AgentNode): boolean {
  if (!agent.lastActivityAt) return false;
  const lastActivity = new Date(agent.lastActivityAt).getTime();
  const now = Date.now();
  const stallThresholdMs = 60000; // 60 seconds without activity
  return agent.status === "working" && now - lastActivity > stallThresholdMs;
}

function getActivityIcon(type: string): string {
  const icons: Record<string, string> = {
    tool_call: "🔧",
    tool_result: "✓",
    thinking: "💭",
    context_pull: "📥",
    spawn: "🚀",
    complete: "✅",
    error: "❌",
    message: "💬",
  };
  return icons[type] || "•";
}

function renderAgentNode(
  agent: AgentNode,
  depth = 0,
  props?: AgencyViewProps,
): ReturnType<typeof html> {
  const color = statusColors[agent.status] || "#6b7280";
  const hasActiveInstances = (agent.activeCount ?? 0) > 0;
  const isActive = agent.status === "working" || agent.status === "running";
  const health = agent.health || (isActive ? "healthy" : "offline");
  const isStalled = detectStall(agent);
  const effectiveHealth = isStalled ? "stalled" : health;

  // Get task status colors
  const taskStatusColor = (status: string): string => {
    return statusColors[status] || "#6b7280";
  };

  return html`
    <div
      class="ag-agent-live ${isActive ? "ag-agent-live--active" : ""} ${isStalled ? "ag-agent-live--stalled" : ""}"
      style="--agent-color: ${color};"
    >
      <!-- Header -->
      <div class="ag-agent-live-header">
        <div class="ag-agent-live-info">
          <div class="ag-agent-live-avatar">${agent.emoji || "🤖"}</div>
          <div>
            <div class="ag-agent-live-name">${agent.name}</div>
            <div class="ag-agent-live-role">${agent.level} • ${agent.role}</div>
          </div>
        </div>
        <div class="ag-agent-live-status">
          <div class="ag-agent-live-metrics">
            ${
              agent.metrics
                ? html`
                  <span>✓ ${agent.metrics.tasks_completed}</span>
                  <span>💰 $${agent.metrics.total_cost.toFixed(2)}</span>
                `
                : nothing
            }
            <span>🛡️ ${Math.round(agent.trustScore * 100)}%</span>
          </div>
          <div class="ag-health">
            <span class="ag-health-dot ag-health-dot--${effectiveHealth}"></span>
            <span>${getHealthLabel(effectiveHealth)}</span>
          </div>
        </div>
      </div>

      <!-- Active Tasks -->
      ${
        agent.activeTasks?.length
          ? html`
            <div class="ag-agent-tasks">
              <div class="ag-agent-tasks-title">
                <span>⚡</span> Active Tasks (${agent.activeTasks.length})
              </div>
              ${agent.activeTasks.slice(0, 3).map(
                (task) => html`
                  <div
                    class="ag-task-mini"
                    @click=${() => props?.onSelectCard(task.run_id)}
                  >
                    <span
                      class="ag-task-mini-status"
                      style="background: ${taskStatusColor(task.status)};"
                    ></span>
                    <span class="ag-task-mini-goal">${task.goal}</span>
                    ${
                      task.progress_percent != null
                        ? html`
                          <div class="ag-task-mini-progress">
                            <div
                              class="ag-task-mini-progress-fill"
                              style="width: ${task.progress_percent}%;"
                            ></div>
                          </div>
                        `
                        : nothing
                    }
                    ${
                      task.cost != null
                        ? html`<span class="ag-task-mini-cost">$${task.cost.toFixed(2)}</span>`
                        : nothing
                    }
                    <span class="ag-task-mini-link">→</span>
                  </div>
                `,
              )}
              ${
                agent.activeTasks.length > 3
                  ? html`
                    <div style="font-size: 11px; color: var(--text-muted); padding-top: 6px;">
                      +${agent.activeTasks.length - 3} more tasks
                    </div>
                  `
                  : nothing
              }
            </div>
          `
          : agent.currentTask
            ? html`
              <div class="ag-agent-tasks">
                <div class="ag-agent-tasks-title">
                  <span>⚡</span> Current Task
                </div>
                <div class="ag-task-mini">
                  <span
                    class="ag-task-mini-status"
                    style="background: ${color};"
                  ></span>
                  <span class="ag-task-mini-goal">${agent.currentTask}</span>
                </div>
              </div>
            `
            : nothing
      }

      <!-- Thinking Preview -->
      ${
        agent.currentThinking && isActive
          ? html`
            <div class="ag-thinking">
              <div class="ag-thinking-header">
                <span>💭</span> Thinking
                <div class="ag-thinking-dots">
                  <span></span><span></span><span></span>
                </div>
              </div>
              <div class="ag-thinking-text">${agent.currentThinking}</div>
            </div>
          `
          : nothing
      }

      <!-- Stall Warning -->
      ${
        isStalled
          ? html`
            <div class="ag-stall-warning">
              <span class="ag-stall-warning-icon">⚠️</span>
              <span>
                No activity for ${agent.lastActivityAt ? formatRelativeTime(agent.lastActivityAt) : "a while"}.
                Agent may be stalled.
              </span>
            </div>
          `
          : nothing
      }

      <!-- Live Activity Stream -->
      ${
        agent.recentActivity?.length
          ? html`
            <div class="ag-agent-activity">
              <div class="ag-activity-stream">
                ${agent.recentActivity.slice(0, 5).map(
                  (activity) => html`
                    <div class="ag-activity-item">
                      <span class="ag-activity-item-time">
                        ${formatRelativeTime(activity.timestamp)}
                      </span>
                      <span class="ag-activity-item-icon">
                        ${getActivityIcon(activity.type)}
                      </span>
                      <span class="ag-activity-item-msg">${activity.message}</span>
                    </div>
                  `,
                )}
              </div>
            </div>
          `
          : isActive && agent.lastActivityMsg
            ? html`
              <div class="ag-agent-activity">
                <div class="ag-activity-stream">
                  <div class="ag-activity-item">
                    <span class="ag-activity-item-time">
                      ${agent.lastActivityAt ? formatRelativeTime(agent.lastActivityAt) : "now"}
                    </span>
                    <span class="ag-activity-item-icon">•</span>
                    <span class="ag-activity-item-msg">${agent.lastActivityMsg}</span>
                  </div>
                </div>
              </div>
            `
            : nothing
      }

      <!-- Children Agents -->
      ${
        agent.children?.length
          ? html`
            <div class="ag-agent-children-live">
              <details>
                <summary class="ag-children-toggle">
                  <span class="ag-children-toggle-icon">▶</span>
                  ${agent.children.length} sub-agent${agent.children.length > 1 ? "s" : ""}
                  ${
                    agent.children.filter((c) => c.status === "working" || c.status === "running")
                      .length > 0
                      ? html`<span style="color: #10b981;">(${agent.children.filter((c) => c.status === "working" || c.status === "running").length} active)</span>`
                      : nothing
                  }
                </summary>
                <div class="ag-children-list">
                  ${agent.children.map((child) => renderAgentNode(child, depth + 1, props))}
                </div>
              </details>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

// Helper to format relative time
function formatRelativeTime(ts: string): string {
  const d = new Date(ts);
  const now = Date.now();
  const diffSecs = Math.floor((now - d.getTime()) / 1000);
  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
  return `${Math.floor(diffSecs / 86400)}d ago`;
}

// Helper to get confidence color
function confidenceColor(conf: number): string {
  if (conf >= 0.8) return "#238636";
  if (conf >= 0.5) return "#f59e0b";
  return "#da3633";
}

function renderKanbanCard(
  card: KanbanCard,
  isSelected: boolean,
  props: AgencyViewProps,
): ReturnType<typeof html> {
  const hasProgress = (card.child_count ?? 0) > 0;
  const done = (card.child_count ?? 0) - (card.active_children ?? 0);
  const needsApproval = card.needs_approval || card.status === "pending";
  const cost = card.total_cost || card.direct_cost || 0;
  const confidence = card.cost_confidence ?? 0.7; // Default medium confidence
  const confColor = confidenceColor(confidence);

  // Generate labels based on card properties
  const labels: Array<{ text: string; color: string }> = [];
  if (card.priority === "high") labels.push({ text: "High Priority", color: "#da3633" });
  if (card.model) labels.push({ text: card.model, color: "#8b5cf6" });
  if (card.agent_type) labels.push({ text: card.agent_type, color: "#1f6feb" });

  return html`
    <div
      class="ag-card ${isSelected ? "ag-card--selected" : ""}"
      @click=${() => props.onSelectCard(card.run_id)}
    >
      <div class="ag-card-title">${card.goal || "Unnamed task"}</div>
      ${hasProgress ? renderProgress(done, card.child_count!) : nothing}
      <div class="ag-card-meta">
        <span>${card.agent_id || "Unassigned"}</span>
        <span class="ag-cost-badge" style="border-color: ${confColor}40; color: ${confColor};">
          💰 $${cost.toFixed(2)}
          ${
            confidence < 1
              ? html`<span style="opacity:0.6; font-size:0.65rem;"> (~${Math.round(confidence * 100)}%)</span>`
              : nothing
          }
        </span>
      </div>
      ${
        labels.length
          ? html`
            <div class="ag-labels">
              ${labels.map(
                (l) =>
                  html`<span class="ag-label" style="background: ${l.color};">${l.text}</span>`,
              )}
            </div>
          `
          : nothing
      }
      ${
        needsApproval
          ? html`
            <div class="ag-actions">
              <button
                class="ag-btn ag-btn--approve"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  props.onApproveTask(card.run_id);
                }}
              >
                ✓ Approve
              </button>
              <button
                class="ag-btn ag-btn--reject"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  props.onRejectTask(card.run_id);
                }}
              >
                ✕ Reject
              </button>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

// Detail panel for selected card (matching task-queue.ts)
function renderDetailPanel(
  card: KanbanCard,
  events: AgencyEvent[],
  props: AgencyViewProps,
): ReturnType<typeof html> {
  const cost = card.total_cost || card.direct_cost || 0;
  const confidence = card.cost_confidence ?? 0.7;
  const confColor = confidenceColor(confidence);

  // Cost range estimation based on confidence
  const lowEst = cost * (1 - (1 - confidence) * 0.3);
  const highEst = cost * (1 + (1 - confidence) * 0.5);

  // Filter events for this card
  const cardEvents = events.filter((e) => e.run_id === card.run_id).slice(0, 10);

  // Calculate metrics
  const toolCalls = cardEvents.filter((e) => e.category === "tool").length;
  const contextPulls = cardEvents.filter((e) => e.category === "context").length;
  const childCount = card.child_count ?? 0;
  const completed = childCount - (card.active_children ?? 0);

  // Duration calculation
  const started = card.started_at ? new Date(card.started_at) : null;
  const ended = card.ended_at ? new Date(card.ended_at) : null;
  const durationMs = started && ended ? ended.getTime() - started.getTime() : 0;
  const durationStr =
    durationMs > 0
      ? durationMs < 60000
        ? `${Math.round(durationMs / 1000)}s`
        : `${Math.round(durationMs / 60000)}m`
      : "In progress";

  // Status color for badge
  const statusColor = statusColors[card.status] || "#6b7280";

  return html`
    <div class="ag-overlay" @click=${() => props.onSelectCard(null)}>
      <div class="ag-panel" @click=${(e: Event) => e.stopPropagation()}>
        <!-- Header -->
        <div class="ag-panel-header">
          <div style="flex:1">
            <div class="ag-panel-title">${card.goal || "Unnamed Task"}</div>
            <div class="ag-panel-meta">
              <span
                class="ag-list-badge"
                style="border-color: ${statusColor}; color: ${statusColor};"
              >
                ${card.status}
              </span>
              ${
                card.agent_id
                  ? html`<span style="opacity:0.6;">Assigned to ${card.agent_id}</span>`
                  : nothing
              }
              ${
                started
                  ? html`<span style="opacity:0.4;">Started ${formatRelativeTime(card.started_at!)}</span>`
                  : nothing
              }
            </div>
          </div>
          <button class="ag-close" @click=${() => props.onSelectCard(null)}>×</button>
        </div>

        <!-- Actions -->
        <div class="ag-panel-actions">
          ${
            card.needs_approval || card.status === "pending"
              ? html`
                <button class="ag-btn-approve" @click=${() => props.onApproveTask(card.run_id)}>
                  ✓ Approve
                </button>
                <button class="ag-btn-reject" @click=${() => props.onRejectTask(card.run_id)}>
                  ✕ Reject
                </button>
              `
              : nothing
          }
          <select class="ag-select" @change=${(e: Event) => {
            const target = e.target as HTMLSelectElement;
            props.onMoveTask?.(card.run_id, target.value);
          }}>
            <option value="" disabled selected>Move to...</option>
            <option value="backlog">Backlog</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        <!-- Metrics -->
        <div class="ag-section">
          <div class="ag-section-title">Metrics</div>
          <div class="ag-metrics-grid">
            <div class="ag-metric-card">
              <div class="ag-metric-value">${toolCalls}</div>
              <div class="ag-metric-label">Tool Calls</div>
            </div>
            <div class="ag-metric-card">
              <div class="ag-metric-value">${contextPulls}</div>
              <div class="ag-metric-label">Context Pulls</div>
            </div>
            <div class="ag-metric-card">
              <div class="ag-metric-value">${completed}/${childCount || 0}</div>
              <div class="ag-metric-label">Sub-tasks</div>
            </div>
            <div class="ag-metric-card">
              <div class="ag-metric-value">${durationStr}</div>
              <div class="ag-metric-label">Duration</div>
            </div>
          </div>
        </div>

        <!-- Cost Estimate -->
        <div class="ag-section">
          <div class="ag-section-title">Cost Estimate</div>
          <div class="ag-cost-detail">
            <div class="ag-cost-main">
              <span class="ag-cost-amount" style="color: ${confColor};">$${cost.toFixed(2)}</span>
              <span class="ag-cost-range">
                ($${lowEst.toFixed(2)} - $${highEst.toFixed(2)})
              </span>
            </div>
            <div class="ag-cost-meta">
              <span>
                <span style="color: ${confColor};">●</span>
                ${Math.round(confidence * 100)}% confidence
              </span>
              ${card.model ? html`<span>📊 ${card.model}</span>` : nothing}
              ${
                card.token_estimate
                  ? html`<span>🔤 ~${card.token_estimate.toLocaleString()} tokens</span>`
                  : nothing
              }
            </div>
            ${
              card.model_recommendations?.length
                ? html`
                  <div class="ag-model-breakdown">
                    <div style="font-size: 11px; opacity: 0.5; margin-bottom: 6px;">
                      Alternative Models
                    </div>
                    ${card.model_recommendations.slice(0, 3).map(
                      (rec) => html`
                        <div class="ag-model-row">
                          <span class="ag-model-name">${rec.model}</span>
                          <div class="ag-model-bar-container">
                            <div
                              class="ag-model-bar"
                              style="width: ${Math.min(100, (rec.cost / cost) * 100)}%;"
                            ></div>
                          </div>
                          <span class="ag-model-cost">$${rec.cost.toFixed(2)}</span>
                        </div>
                      `,
                    )}
                  </div>
                `
                : nothing
            }
          </div>
        </div>

        <!-- Activity Log -->
        ${
          cardEvents.length
            ? html`
              <div class="ag-section">
                <div class="ag-section-title">Recent Activity</div>
                <div class="ag-activity-list">
                  ${cardEvents.map((evt) => {
                    const badge = eventBadgeColors[evt.category] || eventBadgeColors.system;
                    return html`
                      <div class="ag-activity-entry">
                        <span class="ag-cat-dot" style="background: ${badge.fg};"></span>
                        <span class="ag-activity-msg">${evt.message || evt.type}</span>
                        <span class="ag-activity-ts">${formatRelativeTime(evt.timestamp)}</span>
                      </div>
                    `;
                  })}
                </div>
              </div>
            `
            : nothing
        }

        <!-- Description / Notes -->
        ${
          card.description
            ? html`
              <div class="ag-section">
                <div class="ag-section-title">Description</div>
                <div class="ag-desc">${card.description}</div>
              </div>
            `
            : nothing
        }
      </div>
    </div>
  `;
}

function renderKanbanColumn(
  key: string,
  title: string,
  icon: string,
  cards: KanbanCard[],
  props: AgencyViewProps,
): ReturnType<typeof html> {
  return html`
    <div class="ag-column ag-column--${key}">
      <div class="ag-column-header">
        <span class="ag-column-title">${icon} ${title}</span>
        <span class="ag-column-count">${cards.length}</span>
      </div>
      ${
        cards.length === 0
          ? html`
              <div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 20px">
                No items
              </div>
            `
          : cards
              .slice(0, 10)
              .map((card) => renderKanbanCard(card, props.selectedCardId === card.run_id, props))
      }
    </div>
  `;
}

function renderEvent(evt: AgencyEvent): ReturnType<typeof html> {
  const badge = eventBadgeColors[evt.category] || eventBadgeColors.system;
  const time = new Date(evt.timestamp).toLocaleTimeString();

  return html`
    <div class="ag-event">
      <div class="ag-event-time">${time}</div>
      <span class="ag-event-badge" style="background: ${badge.bg}; color: ${badge.fg};">
        ${evt.category}
      </span>
      <div class="ag-event-message">${evt.message || evt.type}</div>
      <div class="ag-event-agent">${evt.agent_id || ""}</div>
    </div>
  `;
}

// === Sprint Rendering ===

function daysLeft(endDate: string): number {
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function renderBurndownChart(burndown: BurndownPoint[]) {
  if (!burndown || burndown.length < 2) return nothing;

  const W = 400;
  const H = 160;
  const pad = { top: 15, right: 15, bottom: 25, left: 30 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const total = burndown[0]?.total ?? 1;
  const n = burndown.length;

  const xScale = (i: number) => pad.left + (i / (n - 1)) * chartW;
  const yScale = (v: number) => pad.top + (1 - v / total) * chartH;

  const actualPath = burndown
    .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(i)},${yScale(p.remaining)}`)
    .join(" ");

  return html`
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:180px;">
      <!-- Grid lines -->
      ${[0, Math.round(total / 2), total].map(
        (v) => html`
          <line
            x1="${pad.left}"
            y1="${yScale(v)}"
            x2="${W - pad.right}"
            y2="${yScale(v)}"
            stroke="var(--border)"
            stroke-width="0.5"
            stroke-dasharray="3,3"
          />
          <text
            x="${pad.left - 6}"
            y="${yScale(v) + 4}"
            text-anchor="end"
            fill="var(--text)"
            opacity="0.4"
            font-size="10"
          >
            ${v}
          </text>
        `,
      )}
      <!-- Ideal line -->
      <line
        x1="${xScale(0)}"
        y1="${yScale(total)}"
        x2="${xScale(n - 1)}"
        y2="${yScale(0)}"
        stroke="var(--border-strong)"
        stroke-width="1.5"
        stroke-dasharray="6,4"
        opacity="0.5"
      />
      <!-- Actual burndown -->
      <path
        d="${actualPath}"
        fill="none"
        stroke="#58a6ff"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      <!-- Points -->
      ${burndown.map(
        (p, i) => html`
          <circle
            cx="${xScale(i)}"
            cy="${yScale(p.remaining)}"
            r="3"
            fill="${p.remaining === 0 ? "#238636" : "#58a6ff"}"
          />
        `,
      )}
    </svg>
  `;
}

function renderSprintCreateForm(props: AgencyViewProps) {
  if (!props.showSprintForm) return nothing;

  const today = new Date().toISOString().split("T")[0];
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

  return html`
    <div
      style="
        background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
        padding: 20px; margin-bottom: 20px;
      "
    >
      <div style="font-size: 15px; font-weight: 600; margin-bottom: 12px;">New Sprint</div>
      <input
        id="sp-name"
        type="text"
        placeholder="Sprint name"
        value="Sprint ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}"
        style="
          width: 100%; box-sizing: border-box; background: var(--bg-muted); color: var(--text);
          border: 1px solid var(--border-strong); border-radius: 6px;
          padding: 8px 10px; font-size: 13px; margin-bottom: 8px;
        "
      />
      <input
        id="sp-goal"
        type="text"
        placeholder="Sprint goal (optional)"
        style="
          width: 100%; box-sizing: border-box; background: var(--bg-muted); color: var(--text);
          border: 1px solid var(--border-strong); border-radius: 6px;
          padding: 8px 10px; font-size: 13px; margin-bottom: 8px;
        "
      />
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <label style="font-size: 12px; opacity: 0.6; min-width: 60px;">End date</label>
        <input
          id="sp-end"
          type="date"
          value="${twoWeeks}"
          min="${today}"
          style="
            background: var(--bg-muted); color: var(--text);
            border: 1px solid var(--border-strong); border-radius: 6px;
            padding: 8px 10px; font-size: 13px;
          "
        />
      </div>
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; margin-bottom: 12px;">
        <input id="sp-pull" type="checkbox" checked style="accent-color: #238636" />
        Pull pending/running tasks from board
      </label>
      <div style="display: flex; gap: 8px;">
        <button
          class="ag-btn ag-btn--approve"
          @click=${() => {
            const name = (document.getElementById("sp-name") as HTMLInputElement)?.value?.trim();
            const goal =
              (document.getElementById("sp-goal") as HTMLInputElement)?.value?.trim() ?? "";
            const end = (document.getElementById("sp-end") as HTMLInputElement)?.value ?? twoWeeks;
            const pull = (document.getElementById("sp-pull") as HTMLInputElement)?.checked ?? false;
            if (name) props.onCreateSprint(name, goal, end, pull);
          }}
        >
          Create Sprint
        </button>
        <button class="ag-btn" @click=${props.onToggleSprintForm}>Cancel</button>
      </div>
    </div>
  `;
}

function renderVelocityChart(velocity: VelocityEntry[]) {
  if (velocity.length === 0) return nothing;

  const maxCards = Math.max(...velocity.map((v) => v.total), 1);

  return html`
    <div style="padding: 14px 20px; border-top: 1px solid var(--border);">
      <div
        style="font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.5px; opacity: 0.4; margin-bottom: 10px;"
      >
        📈 Velocity (last ${velocity.length} sprints)
      </div>
      <div style="display: flex; gap: 16px; align-items: flex-end;">
        ${velocity.map(
          (v) => html`
            <div style="text-align: center; flex: 1;">
              <div
                style="
                  width: 100%; background: var(--border); border-radius: 4px;
                  overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end;
                  height: ${Math.round((v.total / maxCards) * 60)}px;
                "
              >
                <div
                  style="background: #238636; border-radius: 4px;
                    height: ${Math.round((v.completed / maxCards) * 60)}px;"
                ></div>
              </div>
              <div style="font-size: 11px; font-weight: 600; margin-top: 4px;">
                ${v.completed}/${v.total}
              </div>
              <div
                style="font-size: 9px; opacity: 0.4; overflow: hidden;
                  text-overflow: ellipsis; white-space: nowrap;"
              >
                ${v.name}
              </div>
            </div>
          `,
        )}
      </div>
    </div>
  `;
}

function renderSprintsTab(props: AgencyViewProps): ReturnType<typeof html> {
  const data = props.sprints;
  const active = data?.active ?? null;
  const past = (data?.sprints ?? [])
    .filter((s) => s.status !== "active")
    .slice(-5)
    .reverse();

  return html`
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
      <div style="font-size: 18px; font-weight: 700; flex: 1;">🏃 Sprints</div>
      ${
        !active
          ? html`
            <button class="ag-btn ag-btn--approve" @click=${props.onToggleSprintForm}>
              + New Sprint
            </button>
          `
          : nothing
      }
    </div>

    ${renderSprintCreateForm(props)}

    ${
      active
        ? html`
          <div
            style="
              background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
              overflow: hidden; margin-bottom: 20px;
            "
          >
            <!-- Header -->
            <div
              style="
                padding: 16px 20px; display: flex; align-items: center; gap: 12px;
                border-bottom: 1px solid var(--border);
              "
            >
              <div style="font-size: 16px; font-weight: 700; flex: 1;">${active.name}</div>
              <div
                style="
                  font-size: 11px; font-weight: 600; padding: 3px 10px;
                  border-radius: 12px; background: #1f6feb22; color: #58a6ff;
                "
              >
                ${daysLeft(active.endDate)} days left
              </div>
            </div>

            ${
              active.goal
                ? html`
                  <div
                    style="
                      padding: 8px 20px; font-size: 13px; opacity: 0.6; font-style: italic;
                      border-bottom: 1px solid var(--border);
                    "
                  >
                    "${active.goal}"
                  </div>
                `
                : nothing
            }

            <!-- Stats -->
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 14px 20px;">
              <div style="text-align: center;">
                <div style="font-size: 20px; font-weight: 700;">
                  ${active.completedCount}/${active.cardCount}
                </div>
                <div style="font-size: 10px; text-transform: uppercase; opacity: 0.4;">Cards</div>
              </div>
              <div style="text-align: center;">
                <div style="font-size: 20px; font-weight: 700;">
                  ${pct(active.completedCount, active.cardCount)}%
                </div>
                <div style="font-size: 10px; text-transform: uppercase; opacity: 0.4;">Complete</div>
              </div>
              <div style="text-align: center;">
                <div style="font-size: 20px; font-weight: 700;">${daysLeft(active.endDate)}</div>
                <div style="font-size: 10px; text-transform: uppercase; opacity: 0.4;">Days Left</div>
              </div>
              <div style="text-align: center;">
                <div style="font-size: 14px; font-weight: 700;">
                  ${fmtDate(active.startDate)} – ${fmtDate(active.endDate)}
                </div>
                <div style="font-size: 10px; text-transform: uppercase; opacity: 0.4;">Dates</div>
              </div>
            </div>

            <!-- Progress bar -->
            <div style="padding: 0 20px 14px;">
              <div style="height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;">
                <div
                  style="
                    height: 100%; border-radius: 4px; transition: width 0.5s;
                    width: ${pct(active.completedCount, active.cardCount)}%;
                    background: ${pct(active.completedCount, active.cardCount) === 100 ? "#238636" : "#1f6feb"};
                  "
                ></div>
              </div>
            </div>

            <!-- Burndown -->
            ${
              active.burndown && active.burndown.length >= 2
                ? html`
                  <div style="padding: 14px 20px; border-top: 1px solid var(--border);">
                    <div
                      style="font-size: 11px; font-weight: 600; text-transform: uppercase;
                        letter-spacing: 0.5px; opacity: 0.4; margin-bottom: 10px;"
                    >
                      📉 Burndown
                    </div>
                    ${renderBurndownChart(active.burndown)}
                  </div>
                `
                : nothing
            }

            <!-- Cards -->
            <div style="padding: 14px 20px; border-top: 1px solid var(--border);">
              <div
                style="font-size: 11px; font-weight: 600; text-transform: uppercase;
                  letter-spacing: 0.5px; opacity: 0.4; margin-bottom: 10px;"
              >
                📋 Cards (${active.completedCount}/${active.cardCount})
              </div>
              ${[...active.cards]
                .sort((a, b) => {
                  if (a.completedAt && !b.completedAt) return 1;
                  if (!a.completedAt && b.completedAt) return -1;
                  return a.cardName.localeCompare(b.cardName);
                })
                .map(
                  (c) => html`
                    <div
                      style="
                        display: flex; align-items: center; gap: 8px; padding: 6px 0;
                        font-size: 13px; border-bottom: 1px solid var(--bg-hover);
                        ${c.completedAt ? "opacity: 0.4;" : ""}
                      "
                    >
                      <span
                        style="cursor: pointer; font-size: 12px;"
                        @click=${() => {
                          if (!c.completedAt) props.onCompleteSprintCard(active.id, c.cardId);
                        }}
                      >
                        ${c.completedAt ? "✅" : "⬜"}
                      </span>
                      <span
                        style="flex: 1; ${c.completedAt ? "text-decoration: line-through;" : ""}"
                        @click=${() => props.onSelectCard(c.cardId)}
                      >
                        ${c.cardName}
                      </span>
                      ${
                        c.completedAt
                          ? html`<span style="font-size: 11px; opacity: 0.4;">${fmtDate(c.completedAt)}</span>`
                          : nothing
                      }
                    </div>
                  `,
                )}
              ${
                active.cards.length === 0
                  ? html`
                      <div style="font-size: 13px; opacity: 0.4; padding: 8px 0">No cards in sprint</div>
                    `
                  : nothing
              }
            </div>

            <!-- Actions -->
            <div
              style="padding: 14px 20px; border-top: 1px solid var(--border); display: flex; gap: 8px;"
            >
              <button class="ag-btn ag-btn--approve" @click=${() => props.onCompleteSprint(active.id)}>
                ✓ Complete Sprint
              </button>
              <button class="ag-btn ag-btn--reject" @click=${() => props.onCancelSprint(active.id)}>
                ✕ Cancel
              </button>
            </div>
          </div>
        `
        : !props.showSprintForm
          ? html`
            <div
              style="
                text-align: center; padding: 40px 20px;
                background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
              "
            >
              <div style="font-size: 40px; margin-bottom: 12px;">🏃</div>
              <div style="font-size: 14px; opacity: 0.5; margin-bottom: 16px;">
                No active sprint. Create one to start tracking progress.
              </div>
              <button class="ag-btn ag-btn--approve" @click=${props.onToggleSprintForm}>
                + New Sprint
              </button>
            </div>
          `
          : nothing
    }

    ${renderVelocityChart(data?.velocity ?? [])}

    ${
      past.length > 0
        ? html`
          <div style="margin-top: 20px;">
            <div
              style="font-size: 11px; font-weight: 600; text-transform: uppercase;
                letter-spacing: 0.5px; opacity: 0.4; padding: 0 0 10px;"
            >
              📦 Past Sprints
            </div>
            ${past.map(
              (s) => html`
                <div
                  style="
                    background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
                    padding: 14px 16px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px;
                  "
                >
                  <div style="flex: 1; font-size: 14px; font-weight: 600;">${s.name}</div>
                  <div style="font-size: 12px; opacity: 0.5;">${s.completedCount}/${s.cardCount} cards</div>
                  <span
                    style="
                      font-size: 10px; padding: 2px 8px; border-radius: 10px;
                      ${
                        s.status === "completed"
                          ? "background: #23863622; color: #238636;"
                          : "background: #da363322; color: #da3633;"
                      }
                    "
                  >
                    ${s.status}
                  </span>
                </div>
              `,
            )}
          </div>
        `
        : nothing
    }
  `;
}

// === Main Render ===

export function renderAgencyView(props: AgencyViewProps): ReturnType<typeof html> {
  const tabs: Array<{ id: AgencyTabId; label: string }> = [
    { id: "hierarchy", label: "🌳 Hierarchy" },
    { id: "kanban", label: "📋 Kanban" },
    { id: "sprints", label: "🏃 Sprints" },
    { id: "costs", label: "💰 Costs" },
    { id: "events", label: "📜 Events" },
    { id: "audit", label: "🔍 Audit" },
  ];

  return html`
    ${styles}

    <div style="padding: 0;">
      <div
        style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;"
      >
        <div class="ag-tabs">
          ${tabs.map(
            (tab) => html`
              <button
                class="ag-tab ${props.activeTab === tab.id ? "active" : ""}"
                @click=${() => props.onTabChange(tab.id)}
              >
                ${tab.label}
              </button>
            `,
          )}
        </div>
        <button
          @click=${props.onRefresh}
          style="
            padding: 8px 16px;
            border-radius: 6px;
            border: 1px solid var(--border, #333);
            background: var(--panel, #1a1a2e);
            color: var(--text, #e0e0e0);
            cursor: pointer;
            font-size: 0.85rem;
          "
        >
          ↻ Refresh
        </button>
      </div>

      ${
        props.loading
          ? html`
              <div style="text-align: center; padding: 60px; color: var(--text-muted, #888)">
                Loading Agency data…
              </div>
            `
          : props.error
            ? html`<div class="callout danger">${props.error}</div>`
            : renderTabContent(props)
      }
    </div>
  `;
}

function renderTabContent(props: AgencyViewProps): ReturnType<typeof html> {
  switch (props.activeTab) {
    case "hierarchy": {
      if (!props.hierarchy?.root) {
        return html`
          <div style="color: var(--text-muted); text-align: center; padding: 40px">
            No hierarchy data available
          </div>
        `;
      }

      // Count agents by status
      const countAgents = (node: AgentNode): { total: number; active: number; healthy: number } => {
        let total = 1;
        let active = node.status === "working" || node.status === "running" ? 1 : 0;
        let healthy = node.health === "healthy" || (!node.health && active) ? 1 : 0;
        for (const child of node.children || []) {
          const childCounts = countAgents(child);
          total += childCounts.total;
          active += childCounts.active;
          healthy += childCounts.healthy;
        }
        return { total, active, healthy };
      };

      const counts = countAgents(props.hierarchy.root);
      const healthPct =
        counts.active > 0 ? Math.round((counts.healthy / counts.active) * 100) : 100;

      return html`
        <!-- Live Status Summary -->
        <div class="ag-kanban-header" style="margin-bottom: 16px;">
          <div class="ag-stats">
            <div class="ag-stat">
              <div class="ag-stat-num">${counts.total}</div>
              <div class="ag-stat-label">Total Agents</div>
            </div>
            <div class="ag-stat ag-stat--active">
              <div class="ag-stat-num">${counts.active}</div>
              <div class="ag-stat-label">Active Now</div>
            </div>
            <div class="ag-stat ag-stat--progress">
              <div class="ag-stat-num">${healthPct}%</div>
              <div class="ag-stat-label">Health</div>
            </div>
            <div class="ag-stat ag-stat--done">
              <div class="ag-stat-num" style="display: flex; align-items: center; gap: 6px;">
                <span
                  class="ag-health-dot ag-health-dot--${counts.active > 0 ? "healthy" : "offline"}"
                  style="width: 10px; height: 10px;"
                ></span>
                ${counts.active > 0 ? "Live" : "Idle"}
              </div>
              <div class="ag-stat-label">Status</div>
            </div>
          </div>
        </div>

        <!-- Agent Hierarchy -->
        <div>${renderAgentNode(props.hierarchy.root, 0, props)}</div>
      `;
    }

    case "kanban": {
      if (!props.kanban) {
        return html`
          <div style="color: var(--text-muted); text-align: center; padding: 40px">
            No kanban data available
          </div>
        `;
      }

      const backlog = props.kanban.backlog || [];
      const inProgress = props.kanban.in_progress || [];
      const completed = props.kanban.completed || [];
      const failed = props.kanban.failed || [];
      const total = backlog.length + inProgress.length + completed.length + failed.length;
      const done = completed.length;
      const active = inProgress.length;
      const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

      // Find selected card across all columns
      const allCards = [...backlog, ...inProgress, ...completed, ...failed];
      const selectedCard = props.selectedCardId
        ? allCards.find((c) => c.run_id === props.selectedCardId)
        : null;

      // Calculate total estimated cost
      const totalEstCost = allCards.reduce(
        (sum, c) => sum + (c.total_cost || c.direct_cost || 0),
        0,
      );

      return html`
        <!-- Stats Header -->
        <div class="ag-kanban-header">
          <div class="ag-stats">
            <div class="ag-stat">
              <div class="ag-stat-num">${total}</div>
              <div class="ag-stat-label">Total Tasks</div>
            </div>
            <div class="ag-stat ag-stat--active">
              <div class="ag-stat-num">${active}</div>
              <div class="ag-stat-label">Active</div>
            </div>
            <div class="ag-stat ag-stat--progress">
              <div class="ag-stat-num">${done}</div>
              <div class="ag-stat-label">Completed</div>
            </div>
            <div class="ag-stat ag-stat--done">
              <div class="ag-stat-num">$${totalEstCost.toFixed(2)}</div>
              <div class="ag-stat-label">Est. Cost</div>
            </div>
          </div>
          <div class="ag-overall-progress">
            <div class="ag-overall-bar">
              <div
                class="ag-overall-fill"
                style="width: ${progressPct}%; background: ${
                  progressPct === 100 ? "#238636" : progressPct > 50 ? "#1f6feb" : "#6b7280"
                };"
              ></div>
            </div>
            <span class="ag-overall-text">${progressPct}% complete</span>
          </div>
        </div>

        <!-- Kanban Board -->
        <div class="ag-board">
          ${renderKanbanColumn("backlog", "Backlog", "💡", backlog, props)}
          ${renderKanbanColumn("in-progress", "In Progress", "⚡", inProgress, props)}
          ${renderKanbanColumn("completed", "Completed", "✅", completed, props)}
          ${renderKanbanColumn("failed", "Failed", "❌", failed, props)}
        </div>

        <!-- Detail Panel Overlay -->
        ${selectedCard ? renderDetailPanel(selectedCard, props.events, props) : nothing}
      `;
    }

    case "sprints":
      return renderSprintsTab(props);

    case "costs":
      return props.costs
        ? html`
            <div class="ag-costs-stats">
              <div class="ag-stat">
                <div class="ag-stat-value">$${props.costs.total_cost.toFixed(2)}</div>
                <div class="ag-stat-label">Total Spent (7d)</div>
              </div>
              <div class="ag-stat">
                <div class="ag-stat-value">${props.costs.total_runs}</div>
                <div class="ag-stat-label">Total Runs</div>
              </div>
              <div class="ag-stat">
                <div class="ag-stat-value">$${props.costs.avg_cost_per_run.toFixed(3)}</div>
                <div class="ag-stat-label">Avg Cost/Run</div>
              </div>
              ${
                props.costs.estimation_accuracy?.avg_accuracy_pct != null
                  ? html`
                      <div class="ag-stat">
                        <div
                          class="ag-stat-value"
                          style="color: ${
                            props.costs.estimation_accuracy.avg_accuracy_pct >= 80
                              ? "#238636"
                              : props.costs.estimation_accuracy.avg_accuracy_pct >= 60
                                ? "#d29922"
                                : "#da3633"
                          }"
                        >
                          ${props.costs.estimation_accuracy.avg_accuracy_pct.toFixed(0)}%
                        </div>
                        <div class="ag-stat-label">Est. Accuracy</div>
                      </div>
                    `
                  : nothing
              }
            </div>

            <!-- Model Breakdown -->
            ${
              props.costs.by_model?.length
                ? html`
                    <div
                      class="card"
                      style="background: var(--panel); padding: 16px; border-radius: 10px; margin-bottom: 16px;"
                    >
                      <div style="font-weight: 600; margin-bottom: 12px;">💰 Cost by Model</div>
                      <div class="ag-model-breakdown">
                        ${props.costs.by_model.map((m) => {
                          const pct =
                            props.costs!.total_cost > 0
                              ? Math.round((m.cost / props.costs!.total_cost) * 100)
                              : 0;
                          return html`
                            <div class="ag-model-row">
                              <span class="ag-model-name">${m.model || "unknown"}</span>
                              <span class="ag-model-bar-container">
                                <span class="ag-model-bar" style="width: ${pct}%;"></span>
                              </span>
                              <span class="ag-model-cost">$${m.cost.toFixed(2)}</span>
                              <span class="ag-model-runs">(${m.runs} runs)</span>
                            </div>
                          `;
                        })}
                      </div>
                    </div>
                  `
                : nothing
            }

            <!-- Agent Breakdown -->
            ${
              props.costs.agents?.length
                ? html`
                    <div
                      class="card"
                      style="background: var(--panel); padding: 16px; border-radius: 10px; margin-bottom: 16px;"
                    >
                      <div style="font-weight: 600; margin-bottom: 12px;">🤖 Cost by Agent</div>
                      <table class="ag-table">
                        <thead>
                          <tr>
                            <th>Agent</th>
                            <th>Runs</th>
                            <th>Total Cost</th>
                            <th>Avg Cost</th>
                            <th>Success Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${props.costs.agents.map(
                            (a) => html`
                              <tr>
                                <td>${a.agent_id}</td>
                                <td>${a.total_runs}</td>
                                <td>$${a.total_cost.toFixed(2)}</td>
                                <td>$${a.avg_cost.toFixed(3)}</td>
                                <td style="color: ${a.success_rate >= 0.7 ? "#238636" : "#da3633"}">
                                  ${(a.success_rate * 100).toFixed(0)}%
                                </td>
                              </tr>
                            `,
                          )}
                        </tbody>
                      </table>
                    </div>
                  `
                : nothing
            }

            <!-- Estimation Accuracy -->
            ${
              props.costs.estimation_accuracy?.comparisons?.length
                ? html`
                    <div class="card" style="background: var(--panel); padding: 16px; border-radius: 10px;">
                      <div style="font-weight: 600; margin-bottom: 12px;">
                        📊 Estimation Accuracy (last ${props.costs.estimation_accuracy.sample_count} tasks)
                      </div>
                      <table class="ag-table">
                        <thead>
                          <tr>
                            <th>Complexity</th>
                            <th>Estimated</th>
                            <th>Actual</th>
                            <th>Accuracy</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${props.costs.estimation_accuracy.comparisons.map(
                            (c) => html`
                              <tr>
                                <td>${c.complexity}</td>
                                <td>$${c.estimated.toFixed(2)}</td>
                                <td>$${c.actual.toFixed(2)}</td>
                                <td
                                  style="color: ${
                                    c.accuracy_pct >= 80
                                      ? "#238636"
                                      : c.accuracy_pct >= 60
                                        ? "#d29922"
                                        : "#da3633"
                                  }"
                                >
                                  ${c.accuracy_pct.toFixed(0)}% ${c.over_under === "over" ? "↑" : "↓"}
                                </td>
                              </tr>
                            `,
                          )}
                        </tbody>
                      </table>
                    </div>
                  `
                : nothing
            }
          `
        : html`
            <div style="color: var(--text-muted); text-align: center; padding: 40px">
              No cost data available
            </div>
          `;

    case "events":
      return props.events?.length
        ? html`
            <div
              style="background: var(--panel); border-radius: 10px; padding: 16px; max-height: 500px; overflow-y: auto;"
            >
              ${props.events.map((evt) => renderEvent(evt))}
            </div>
          `
        : html`
            <div style="color: var(--text-muted); text-align: center; padding: 40px">No events yet</div>
          `;

    case "audit":
      return renderAuditTab(props);

    default:
      return html`
        <div>Unknown tab</div>
      `;
  }
}

// === Audit Tab Rendering ===

function renderAuditTab(props: AgencyViewProps): ReturnType<typeof html> {
  const { auditEntries, auditInstances, auditViolations, auditSelectedInstanceId } = props;

  // Filter entries if instance selected
  const filteredEntries = auditSelectedInstanceId
    ? auditEntries.filter((e) => e.instanceId === auditSelectedInstanceId)
    : auditEntries;

  return html`
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <!-- Instance selector chips -->
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;">
        <button
          class="ag-tab ${!auditSelectedInstanceId ? "active" : ""}"
          style="padding: 4px 12px; font-size: 0.8rem;"
          @click=${() => props.onSelectAuditInstance(null)}
        >
          All Instances
        </button>
        ${auditInstances.slice(0, 10).map(
          (inst) => html`
            <button
              class="ag-tab ${auditSelectedInstanceId === inst.instanceId ? "active" : ""}"
              style="padding: 4px 12px; font-size: 0.8rem;"
              @click=${() => props.onSelectAuditInstance(inst.instanceId)}
            >
              ${inst.agentId} · ${inst.status}
              ${inst.actionCount > 0 ? html`<span style="opacity: 0.6;">(${inst.actionCount})</span>` : nothing}
            </button>
          `,
        )}
      </div>

      <!-- Violations alert section (if any) -->
      ${
        auditViolations.length > 0
          ? html`
            <div
              style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 12px;"
            >
              <div style="font-weight: 600; color: #ef4444; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                ⚠️ Recent Violations (${auditViolations.length})
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px; max-height: 150px; overflow-y: auto;">
                ${auditViolations.slice(0, 5).map(
                  (v) => html`
                    <div
                      style="display: flex; gap: 12px; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 0.8rem;"
                    >
                      <span style="color: var(--text-muted); width: 70px;">
                        ${new Date(v.ts).toLocaleTimeString()}
                      </span>
                      <span
                        style="padding: 1px 6px; border-radius: 3px; background: ${
                          v.severity === "error"
                            ? "rgba(239, 68, 68, 0.3)"
                            : "rgba(245, 158, 11, 0.3)"
                        }; color: ${
                          v.severity === "error" ? "#ef4444" : "#f59e0b"
                        }; font-size: 0.7rem; text-transform: uppercase;"
                      >
                        ${v.type}
                      </span>
                      <span style="flex: 1;">${v.message}</span>
                      <span style="color: var(--text-muted);">${v.agentId || ""}</span>
                    </div>
                  `,
                )}
              </div>
            </div>
          `
          : nothing
      }

      <!-- Audit entries table -->
      <div style="background: var(--panel); border-radius: 10px; overflow: hidden;">
        <div style="padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 600;">
          📋 Action Audit Log
        </div>
        <div style="max-height: 400px; overflow-y: auto;">
          ${
            filteredEntries.length > 0
              ? html`
                <table class="ag-table" style="width: 100%;">
                  <thead>
                    <tr>
                      <th style="width: 80px;">Time</th>
                      <th style="width: 80px;">Agent</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th style="width: 60px;">Status</th>
                      <th style="width: 70px;">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filteredEntries.map((entry) => {
                      const statusColor =
                        entry.status === "ok"
                          ? "#10b981"
                          : entry.status === "denied"
                            ? "#ef4444"
                            : entry.status === "error"
                              ? "#ef4444"
                              : "#94a3b8";
                      return html`
                        <tr>
                          <td style="font-size: 0.75rem; color: var(--text-muted);">
                            ${new Date(entry.ts).toLocaleTimeString()}
                          </td>
                          <td>${entry.agentId || "—"}</td>
                          <td>
                            <span style="font-weight: 500;">${entry.action}</span>
                            ${
                              entry.detail
                                ? html`<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
                                  ${entry.detail.slice(0, 60)}${entry.detail.length > 60 ? "…" : ""}
                                </div>`
                                : nothing
                            }
                          </td>
                          <td>
                            ${
                              entry.target
                                ? html`<span style="font-size: 0.85rem;">${entry.targetType}:${entry.target}</span>`
                                : "—"
                            }
                          </td>
                          <td>
                            <span
                              style="padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; text-transform: uppercase; background: ${statusColor}22; color: ${statusColor};"
                            >
                              ${entry.status}
                            </span>
                          </td>
                          <td style="font-size: 0.8rem;">
                            ${entry.cost != null ? `$${entry.cost.toFixed(4)}` : "—"}
                          </td>
                        </tr>
                      `;
                    })}
                  </tbody>
                </table>
              `
              : html`
                <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                  <div style="font-size: 24px; margin-bottom: 8px;">📋</div>
                  No audit entries${auditSelectedInstanceId ? " for this instance" : ""}.
                </div>
              `
          }
        </div>
      </div>
    </div>
  `;
}
