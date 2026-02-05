/**
 * Agency Goals Kanban View for OpenClaw
 *
 * Shows top-level agent runs as goals in a kanban board.
 * Goals can spawn child runs, which appear as subtasks.
 *
 * Copy to: ~/Projects/openclaw/ui/src/ui/views/agency-goals.ts
 */

import { html, nothing } from "lit";

// ============================================================================
// Types
// ============================================================================

export type GoalCard = {
  id: string;
  name: string;
  idList: string;
  labels: string[];
  checkItems: number;
  checkItemsChecked: number;
  hasChecklists: boolean;
  commentCount: number;
  dateLastActivity: string | null;
};

export type GoalList = {
  id: string;
  name: string;
  cards: GoalCard[];
};

export type GoalsSnapshot = {
  lists: GoalList[];
  fetchedAt: number;
};

export type AgencyGoalsProps = {
  loading: boolean;
  error: string | null;
  snapshot: GoalsSnapshot | null;
  selectedCardId: string | null;
  onRefresh: () => void;
  onSelectCard: (cardId: string) => void;
  onCloseDetail: () => void;
  onMoveCard: (cardId: string, listId: string) => void;
};

// ============================================================================
// Configuration
// ============================================================================

const AGENCY_API_URL = (window as any).AGENCY_API_URL || "http://localhost:8765";

const COLUMN_CONFIG: Record<string, { color: string; icon: string }> = {
  Proposed: { color: "#8b5cf6", icon: "💡" },
  Approved: { color: "#238636", icon: "✅" },
  Queued: { color: "#6e7681", icon: "📋" },
  "In Progress": { color: "#1f6feb", icon: "⚡" },
  Blocked: { color: "#da3633", icon: "🚫" },
  Done: { color: "#238636", icon: "✨" },
};

// ============================================================================
// Helpers
// ============================================================================

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function labelColor(label: string): string {
  if (label.startsWith("$")) return "#f59e0b"; // Cost label
  const colors = ["#238636", "#1f6feb", "#8b5cf6", "#da3633", "#d29922"];
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

// ============================================================================
// Components
// ============================================================================

function renderProgressBar(checked: number, total: number) {
  if (total === 0) return nothing;
  const pct = Math.round((checked / total) * 100);
  const color = pct === 100 ? "#238636" : pct > 50 ? "#1f6feb" : "#6e7681";
  return html`
    <div class="goal-progress">
      <div class="goal-progress-bar">
        <div class="goal-progress-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="goal-progress-text">${checked}/${total}</span>
    </div>
  `;
}

function renderCard(card: GoalCard, isSelected: boolean, onSelect: (id: string) => void) {
  return html`
    <div
      class="goal-card ${isSelected ? "goal-card-selected" : ""}"
      @click=${() => onSelect(card.id)}
    >
      <div class="goal-card-title">${card.name}</div>
      ${card.checkItems > 0 ? renderProgressBar(card.checkItemsChecked, card.checkItems) : nothing}
      <div class="goal-card-footer">
        <div class="goal-card-badges">
          ${
            card.commentCount > 0
              ? html`<span class="goal-badge" title="${card.commentCount} comments">💬 ${card.commentCount}</span>`
              : nothing
          }
          ${
            card.hasChecklists && card.checkItems === 0
              ? html`
                  <span class="goal-badge" title="Has subtasks">☑</span>
                `
              : nothing
          }
        </div>
        <span class="goal-card-time">${timeAgo(card.dateLastActivity)}</span>
      </div>
      ${
        card.labels.length > 0
          ? html`
            <div class="goal-labels">
              ${card.labels.map(
                (l) =>
                  html`<span class="goal-label" style="background:${labelColor(l)}">${l}</span>`,
              )}
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function renderColumn(
  list: GoalList,
  selectedCardId: string | null,
  onSelect: (id: string) => void,
) {
  const config = COLUMN_CONFIG[list.name] ?? { color: "#6e7681", icon: "📌" };
  const isDone = list.name === "Done";
  const display = isDone ? list.cards.slice(0, 5) : list.cards;
  const hidden = isDone ? Math.max(0, list.cards.length - 5) : 0;

  return html`
    <div class="goal-column" style="border-top: 3px solid ${config.color};">
      <div class="goal-column-header">
        <span class="goal-column-title">${config.icon} ${list.name}</span>
        <span class="goal-column-count">${list.cards.length}</span>
      </div>
      <div class="goal-column-body">
        ${
          display.length === 0
            ? html`
                <div class="goal-empty">No goals</div>
              `
            : display.map((c) => renderCard(c, c.id === selectedCardId, onSelect))
        }
        ${hidden > 0 ? html`<div class="goal-hidden">+${hidden} more completed</div>` : nothing}
      </div>
    </div>
  `;
}

// ============================================================================
// Main Render
// ============================================================================

export function renderAgencyGoals(props: AgencyGoalsProps) {
  const { snapshot, error, loading, selectedCardId, onSelectCard } = props;

  return html`
    <style>
      .goal-board {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        padding-bottom: 12px;
      }

      .goal-column {
        flex: 0 0 280px;
        background: var(--panel, #0f0f23);
        border-radius: 8px;
        overflow: hidden;
      }

      .goal-column-header {
        padding: 12px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--border, #2d2d4a);
      }

      .goal-column-title {
        font-weight: 600;
        font-size: 0.9rem;
      }

      .goal-column-count {
        font-size: 0.75rem;
        padding: 2px 8px;
        background: var(--bg-hover, #242442);
        border-radius: 10px;
        color: var(--text-muted, #94a3b8);
      }

      .goal-column-body {
        padding: 8px;
        min-height: 100px;
        max-height: calc(100vh - 300px);
        overflow-y: auto;
      }

      .goal-card {
        background: var(--bg-muted, #1a1a2e);
        border: 1px solid var(--border, #2d2d4a);
        border-radius: 6px;
        padding: 10px 12px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: all 0.15s;
      }

      .goal-card:hover {
        background: var(--bg-hover, #242442);
        border-color: var(--border-strong, #3d3d5a);
        transform: translateY(-1px);
      }

      .goal-card-selected {
        border-color: #1f6feb;
        background: var(--bg-hover, #242442);
      }

      .goal-card-title {
        font-size: 0.9rem;
        font-weight: 500;
        margin-bottom: 8px;
        line-height: 1.4;
      }

      .goal-card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 0.75rem;
        color: var(--text-muted, #94a3b8);
      }

      .goal-card-badges {
        display: flex;
        gap: 6px;
      }

      .goal-badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }

      .goal-labels {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        margin-top: 8px;
      }

      .goal-label {
        font-size: 0.65rem;
        padding: 2px 6px;
        border-radius: 3px;
        color: white;
      }

      .goal-progress {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }

      .goal-progress-bar {
        flex: 1;
        height: 4px;
        background: var(--border, #2d2d4a);
        border-radius: 2px;
        overflow: hidden;
      }

      .goal-progress-fill {
        height: 100%;
        border-radius: 2px;
        transition: width 0.3s;
      }

      .goal-progress-text {
        font-size: 0.7rem;
        color: var(--text-muted, #94a3b8);
        min-width: 35px;
      }

      .goal-empty {
        text-align: center;
        padding: 20px;
        color: var(--text-muted, #94a3b8);
        font-size: 0.85rem;
      }

      .goal-hidden {
        text-align: center;
        padding: 8px;
        color: var(--text-muted, #94a3b8);
        font-size: 0.75rem;
      }
    </style>

    <div class="card">
      <div class="card-title">🎯 Goals</div>
      <div class="card-sub">
        Top-level agent runs tracked as goals. Subtasks show as progress.
      </div>
      <div style="margin-top: 12px; display: flex; align-items: center; gap: 12px;">
        <span class="muted">
          ${snapshot ? `Updated ${timeAgo(new Date(snapshot.fetchedAt).toISOString())} ago` : ""}
        </span>
        <button class="btn" ?disabled=${loading} @click=${props.onRefresh}>Refresh</button>
      </div>
      ${error ? html`<div class="pill danger" style="margin-top: 12px">${error}</div>` : nothing}
    </div>

    <div class="goal-board" style="margin-top: 16px;">
      ${
        snapshot
          ? snapshot.lists.map((list) => renderColumn(list, selectedCardId, onSelectCard))
          : html`
              <div class="card" style="flex: 1; text-align: center; padding: 32px">
                <div style="font-size: 3rem; margin-bottom: 12px">🎯</div>
                <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 8px">No Goals Yet</div>
                <div class="muted">Run agents with <code>agency run</code> to create goals.</div>
              </div>
            `
      }
    </div>
  `;
}

// ============================================================================
// Data Fetching
// ============================================================================

export async function fetchGoalsSnapshot(): Promise<GoalsSnapshot | null> {
  try {
    const res = await fetch(`${AGENCY_API_URL}/api/task-queue/snapshot`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn("[Agency] Failed to fetch goals:", e);
  }
  return null;
}
