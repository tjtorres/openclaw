import type { GatewayBrowserClient } from "../gateway";

export type SwarmWorker = {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  branch?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  taskSpec?: string | null;
  swarmId: string;
  backend?: string | null;
};

export type SwarmGroup = {
  id: string;
  repo: string;
  baseBranch: string;
  createdAt: string;
  status: "active" | "completed" | "failed" | "cancelled";
  workers: SwarmWorker[];
};

export type SwarmSnapshot = {
  swarms: SwarmGroup[];
  fetchedAt: number;
  hasActiveSwarm: boolean;
  totalWorkers: number;
  activeWorkers: number;
};

export type AgentInstance = {
  instance_id: string;
  status: string;
  assigned_task: string | null;
  model: string | null;
  cost: number;
  spawned_at: string;
  torn_down_at: string | null;
  last_active_at: string | null;
};

export type SwarmAgentNode = {
  id: string;
  name: string;
  role: string;
  level: string;
  status: "active" | "idle" | "working" | "archived";
  trustScore: number;
  currentTask?: string | null;
  children: SwarmAgentNode[];
  specialty?: string | null;
  emoji?: string | null;
  recentTasks?: Array<{ task: string; status: string; completedAt?: string }>;
  instances?: AgentInstance[];
  activeCount?: number;
};

export type SwarmHierarchy = {
  root: SwarmAgentNode;
  fetchedAt: number;
};

export type AgentDetail = {
  id: string;
  name: string;
  role: string;
  level: string;
  trustScore: number;
  status: string;
  currentTask?: string | null;
  specialty?: string | null;
  recentHistory: Array<{ task: string; status: string; cost?: number; completedAt?: string }>;
  assignedCards: Array<{ name: string; progress: number; list: string }>;
  totalCost: number;
  tasksCompleted: number;
  tasksFailed: number;
};

export type SwarmState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  swarmLoading: boolean;
  swarmSnapshot: SwarmSnapshot | null;
  swarmHierarchy: SwarmHierarchy | null;
  swarmError: string | null;
  selectedAgent: AgentDetail | null;
  selectedAgentLoading: boolean;
};

export async function loadSwarmData(state: SwarmState) {
  if (!state.client || !state.connected) return;
  if (state.swarmLoading) return;

  state.swarmLoading = true;
  state.swarmError = null;

  try {
    const [snapshot, hierarchy] = await Promise.all([
      state.client.request("swarm.list", {}),
      state.client.request("swarm.hierarchy", {}),
    ]);
    state.swarmSnapshot = snapshot as SwarmSnapshot;
    state.swarmHierarchy = hierarchy as SwarmHierarchy;
  } catch (err) {
    state.swarmError = String(err);
  } finally {
    state.swarmLoading = false;
  }
}

export async function loadAgentDetail(state: SwarmState, agentId: string) {
  if (!state.client || !state.connected) return;
  state.selectedAgentLoading = true;
  try {
    const detail = await state.client.request("swarm.agentDetail", { agentId });
    state.selectedAgent = detail as AgentDetail;
  } catch (err) {
    console.error("[swarm] loadAgentDetail error:", err);
    state.selectedAgent = null;
  } finally {
    state.selectedAgentLoading = false;
  }
}
