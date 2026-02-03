import { html, nothing } from "lit";
import type {
  TaskQueueCard,
  TaskQueueCardDetail,
  TaskQueueList,
  TaskQueueSnapshot,
} from "../task-queue-types.ts";

export type TaskQueueProps = {
  loading: boolean;
  snapshot: TaskQueueSnapshot | null;
  error: string | null;
  selectedCardId: string | null;
  cardDetail: TaskQueueCardDetail | null;
  cardDetailLoading: boolean;
  onRefresh: () => void;
  onSelectCard: (cardId: string) => void;
  onCloseDetail: () => void;
  onMoveCard: (cardId: string, listId: string) => void;
  onApproveCard: (cardId: string) => void;
  onToggleCheckItem: (cardId: string, checkItemId: string, complete: boolean) => void;
  onAddComment: (cardId: string, text: string) => void;
};

const COLUMN_ORDER = ["Proposed", "Approved", "Queued", "In Progress", "Blocked", "Done"];

function labelColor(label: string): string {
  const colorMap: Record<string, string> = {
    Approved: "#2da44e",
    New: "#d4a72c",
    Blocked: "#cf222e",
  };
  if (colorMap[label]) return colorMap[label];
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function columnColor(name: string): string {
  const map: Record<string, string> = {
    Proposed: "#3d3d5c",
    Approved: "#2d4a3d",
    Queued: "#3d3d5c",
    "In Progress": "#3d4a5c",
    Blocked: "#5c3d3d",
    Done: "#2d3d2d",
  };
  return map[name] ?? "#1a1a2e";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function renderCard(card: TaskQueueCard, isSelected: boolean, onSelect: (id: string) => void) {
  return html`
    <div
      class="tq-card ${isSelected ? "tq-card-selected" : ""}"
      @click=${() => onSelect(card.id)}
    >
      <div class="tq-card-title">${card.name}</div>
      <div class="tq-card-meta">
        ${
          card.hasChecklists
            ? html`
                <span title="Has checklists">☑</span>
              `
            : nothing
        }
        <span class="tq-card-time">${timeAgo(card.dateLastActivity)}</span>
      </div>
      ${
        card.labels.length > 0
          ? html`
            <div class="tq-labels">
              ${card.labels.map(
                (label) =>
                  html`<span class="tq-label" style="background:${labelColor(label)}"
                    >${label}</span
                  >`,
              )}
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function renderColumn(
  name: string,
  cards: TaskQueueCard[],
  selectedCardId: string | null,
  onSelect: (id: string) => void,
  collapseDone: boolean,
) {
  const isDone = name === "Done";
  const displayCards = isDone && collapseDone ? cards.slice(0, 5) : cards;
  const hiddenCount = isDone && collapseDone ? Math.max(0, cards.length - 5) : 0;

  return html`
    <div class="tq-column" style="background:${columnColor(name)}">
      <div class="tq-column-header">
        <span class="tq-column-title">${name}</span>
        <span class="tq-column-count">${cards.length}</span>
      </div>
      <div class="tq-column-body">
        ${
          displayCards.length === 0
            ? html`
                <div class="muted" style="padding: 8px; text-align: center">No cards</div>
              `
            : displayCards.map((card) => renderCard(card, card.id === selectedCardId, onSelect))
        }
        ${
          hiddenCount > 0
            ? html`<div class="muted" style="padding:8px;text-align:center;font-size:12px;">
              +${hiddenCount} more
            </div>`
            : nothing
        }
      </div>
    </div>
  `;
}

function renderCardDetail(props: TaskQueueProps, card: TaskQueueCard, lists: TaskQueueList[]) {
  const detail = props.cardDetail;
  const loading = props.cardDetailLoading;

  return html`
    <div class="tq-detail-overlay" @click=${props.onCloseDetail}>
      <div class="tq-detail-panel" @click=${(e: Event) => e.stopPropagation()}>
        <div class="tq-detail-header">
          <div class="tq-detail-title">${card.name}</div>
          <button class="tq-detail-close" @click=${props.onCloseDetail}>✕</button>
        </div>

        <div class="tq-detail-meta">
          <span class="tq-label" style="background:${columnColor(card.listName ?? "")};border:1px solid #555">
            ${card.listName ?? "Unknown"}
          </span>
          ${card.labels.map(
            (l) => html`<span class="tq-label" style="background:${labelColor(l)}">${l}</span>`,
          )}
          ${
            card.url
              ? html`<a href=${card.url} target="_blank" rel="noreferrer" class="tq-detail-link">
                Open in Trello ↗
              </a>`
              : nothing
          }
        </div>

        <!-- Actions -->
        <div class="tq-detail-actions">
          ${
            card.listName === "Proposed"
              ? html`<button
                class="btn tq-btn-approve"
                @click=${() => props.onApproveCard(card.id)}
              >
                ✓ Approve
              </button>`
              : nothing
          }
          <select
            class="tq-move-select"
            @change=${(e: Event) => {
              const target = e.target as HTMLSelectElement;
              if (target.value) {
                props.onMoveCard(card.id, target.value);
                target.value = "";
              }
            }}
          >
            <option value="">Move to…</option>
            ${lists
              .filter((l) => l.id !== card.listId && !l.closed)
              .map((l) => html`<option value=${l.id}>${l.name}</option>`)}
          </select>
        </div>

        <!-- Description -->
        ${
          card.desc
            ? html`
              <div class="tq-detail-section">
                <div class="tq-detail-section-title">Description</div>
                <div class="tq-detail-desc">${card.desc}</div>
              </div>
            `
            : nothing
        }

        ${
          loading
            ? html`
                <div class="muted" style="padding: 12px">Loading details…</div>
              `
            : nothing
        }

        <!-- Checklists -->
        ${
          detail?.checklists?.map(
            (cl) => html`
            <div class="tq-detail-section">
              <div class="tq-detail-section-title">${cl.name}</div>
              ${cl.items.map(
                (item) => html`
                  <label class="tq-check-item">
                    <input
                      type="checkbox"
                      ?checked=${item.complete}
                      @change=${() => props.onToggleCheckItem(card.id, item.id, !item.complete)}
                    />
                    <span class="${item.complete ? "tq-check-done" : ""}">${item.name}</span>
                  </label>
                `,
              )}
              ${
                cl.items.length > 0
                  ? html`<div class="tq-check-progress">
                    ${cl.items.filter((i) => i.complete).length}/${cl.items.length} complete
                  </div>`
                  : nothing
              }
            </div>
          `,
          ) ?? nothing
        }

        <!-- Comments -->
        ${
          detail?.comments && detail.comments.length > 0
            ? html`
              <div class="tq-detail-section">
                <div class="tq-detail-section-title">
                  Comments (${detail.comments.length})
                </div>
                ${detail.comments.map(
                  (c) => html`
                    <div class="tq-comment">
                      <div class="tq-comment-header">
                        <strong>${c.author}</strong>
                        <span class="muted">${timeAgo(c.date)}</span>
                      </div>
                      <div class="tq-comment-body">${c.text}</div>
                    </div>
                  `,
                )}
              </div>
            `
            : nothing
        }

        <!-- Add comment -->
        <div class="tq-detail-section">
          <div class="tq-detail-section-title">Add Comment</div>
          <div class="tq-add-comment">
            <textarea
              id="tq-comment-input"
              rows="2"
              placeholder="Write a comment…"
              class="tq-comment-textarea"
            ></textarea>
            <button
              class="btn"
              @click=${() => {
                const textarea = document.getElementById("tq-comment-input") as HTMLTextAreaElement;
                if (textarea?.value.trim()) {
                  props.onAddComment(card.id, textarea.value.trim());
                  textarea.value = "";
                }
              }}
            >
              Post
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderTaskQueue(props: TaskQueueProps) {
  if (props.loading && !props.snapshot) {
    return html`
      <section class="card">
        <div class="card-title">Task Queue</div>
        <div class="muted" style="margin-top: 12px">Loading…</div>
      </section>
    `;
  }

  if (props.error && !props.snapshot) {
    return html`
      <section class="card">
        <div class="card-title">Task Queue</div>
        <div class="muted" style="margin-top:12px;">${props.error}</div>
        <div class="row" style="margin-top:12px;">
          <button class="btn" @click=${props.onRefresh}>Retry</button>
        </div>
      </section>
    `;
  }

  if (!props.snapshot) {
    return html`
      <section class="card">
        <div class="card-title">Task Queue</div>
        <div class="muted" style="margin-top:12px;">No data loaded.</div>
        <div class="row" style="margin-top:12px;">
          <button class="btn" @click=${props.onRefresh}>Load</button>
        </div>
      </section>
    `;
  }

  const snap = props.snapshot;
  const cardsByList = new Map<string, TaskQueueCard[]>();
  for (const card of snap.cards) {
    const key = card.listName ?? "Unknown";
    const list = cardsByList.get(key);
    if (list) list.push(card);
    else cardsByList.set(key, [card]);
  }

  const orderedColumns: string[] = [];
  for (const col of COLUMN_ORDER) {
    if (cardsByList.has(col) || COLUMN_ORDER.includes(col)) {
      orderedColumns.push(col);
    }
  }
  for (const col of cardsByList.keys()) {
    if (!orderedColumns.includes(col)) orderedColumns.push(col);
  }

  const fetchedLabel = new Date(snap.fetchedAt).toLocaleTimeString();
  const activeCards = snap.cards.filter((c) => c.listName !== "Done").length;
  const selectedCard = props.selectedCardId
    ? snap.cards.find((c) => c.id === props.selectedCardId)
    : null;

  return html`
    <style>
      .tq-board {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        padding-bottom: 8px;
        min-height: 200px;
      }
      .tq-column {
        min-width: 200px;
        max-width: 260px;
        flex: 1 0 200px;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
      }
      .tq-column-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      .tq-column-title { font-weight: 600; font-size: 13px; }
      .tq-column-count { font-size: 12px; opacity: 0.6; }
      .tq-column-body {
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow-y: auto;
        flex: 1;
        max-height: 500px;
      }
      .tq-card {
        background: var(--bg-primary, #0f0f23);
        border: 1px solid var(--border, #333);
        border-radius: 6px;
        padding: 10px;
        cursor: pointer;
        transition: border-color 0.15s, transform 0.1s;
      }
      .tq-card:hover {
        border-color: #666;
        transform: translateY(-1px);
      }
      .tq-card-selected {
        border-color: #58a6ff;
        box-shadow: 0 0 0 1px #58a6ff;
      }
      .tq-card-title { font-size: 13px; line-height: 1.4; }
      .tq-card-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
        font-size: 11px;
        opacity: 0.5;
      }
      .tq-labels { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
      .tq-label {
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 3px;
        color: #fff;
      }

      /* Detail panel */
      .tq-detail-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 100;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding-top: 60px;
        overflow-y: auto;
      }
      .tq-detail-panel {
        background: var(--bg-primary, #0f0f23);
        border: 1px solid var(--border, #444);
        border-radius: 12px;
        width: 95%;
        max-width: 640px;
        max-height: 80vh;
        overflow-y: auto;
        padding: 20px;
      }
      .tq-detail-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
      }
      .tq-detail-title { font-size: 18px; font-weight: 600; flex: 1; }
      .tq-detail-close {
        background: none;
        border: none;
        color: inherit;
        font-size: 18px;
        cursor: pointer;
        padding: 4px 8px;
        opacity: 0.6;
      }
      .tq-detail-close:hover { opacity: 1; }
      .tq-detail-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        margin-top: 10px;
      }
      .tq-detail-link {
        font-size: 12px;
        color: #58a6ff;
        margin-left: auto;
      }
      .tq-detail-actions {
        display: flex;
        gap: 8px;
        margin-top: 14px;
        padding-bottom: 14px;
        border-bottom: 1px solid var(--border, #333);
      }
      .tq-btn-approve {
        background: #2da44e !important;
        color: #fff !important;
        border: none;
        font-weight: 600;
      }
      .tq-move-select {
        background: var(--bg-secondary, #1a1a2e);
        color: inherit;
        border: 1px solid var(--border, #444);
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 13px;
      }
      .tq-detail-section {
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
      }
      .tq-detail-section-title {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        opacity: 0.6;
        margin-bottom: 8px;
      }
      .tq-detail-desc {
        font-size: 14px;
        line-height: 1.6;
        white-space: pre-wrap;
        opacity: 0.85;
      }
      .tq-check-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 4px 0;
        font-size: 13px;
        cursor: pointer;
      }
      .tq-check-item input { margin-top: 2px; cursor: pointer; }
      .tq-check-done { text-decoration: line-through; opacity: 0.5; }
      .tq-check-progress {
        font-size: 11px;
        opacity: 0.5;
        margin-top: 6px;
      }
      .tq-comment {
        padding: 8px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      }
      .tq-comment-header {
        display: flex;
        gap: 8px;
        align-items: center;
        font-size: 12px;
        margin-bottom: 4px;
      }
      .tq-comment-body {
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
        opacity: 0.85;
      }
      .tq-add-comment { display: flex; flex-direction: column; gap: 8px; }
      .tq-comment-textarea {
        background: var(--bg-secondary, #1a1a2e);
        color: inherit;
        border: 1px solid var(--border, #444);
        border-radius: 6px;
        padding: 8px;
        font-family: inherit;
        font-size: 13px;
        resize: vertical;
      }
      .tq-summary-bar {
        display: flex;
        gap: 16px;
        align-items: center;
        flex-wrap: wrap;
      }
      .tq-summary-stat {
        font-size: 13px;
        opacity: 0.7;
      }
      .tq-summary-stat strong {
        opacity: 1;
        font-size: 16px;
      }
    </style>

    <section class="card">
      <div class="card-title">
        ${snap.board.name}
        ${
          snap.board.url
            ? html`<a
              href=${snap.board.url}
              target="_blank"
              rel="noreferrer"
              style="font-size:12px;margin-left:8px;"
              >Open board ↗</a
            >`
            : nothing
        }
      </div>
      <div class="tq-summary-bar" style="margin-top:8px;">
        <span class="tq-summary-stat"><strong>${activeCards}</strong> active</span>
        <span class="tq-summary-stat">
          <strong>${snap.cards.filter((c) => c.listName === "Done").length}</strong> done
        </span>
        <span class="tq-summary-stat">
          <strong>${snap.cards.length}</strong> total
        </span>
        <span style="margin-left:auto;display:flex;align-items:center;gap:8px;">
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "↻" : "↻ Refresh"}
          </button>
          <span class="muted" style="font-size:11px;">${fetchedLabel}</span>
        </span>
      </div>
      ${
        props.error
          ? html`<div style="color:#cf222e;font-size:13px;margin-top:6px;">${props.error}</div>`
          : nothing
      }
    </section>

    <section style="margin-top:12px;">
      <div class="tq-board">
        ${orderedColumns.map((col) =>
          renderColumn(
            col,
            cardsByList.get(col) ?? [],
            props.selectedCardId,
            props.onSelectCard,
            true,
          ),
        )}
      </div>
    </section>

    ${selectedCard ? renderCardDetail(props, selectedCard, snap.lists) : nothing}
  `;
}
