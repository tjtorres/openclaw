import { html, nothing } from "lit";
import type { TaskQueueCard, TaskQueueSnapshot } from "../task-queue-types.ts";

export type TaskQueueProps = {
  loading: boolean;
  snapshot: TaskQueueSnapshot | null;
  error: string | null;
  onRefresh: () => void;
};

const COLUMN_ORDER = ["Proposed", "Approved", "Queued", "In Progress", "Blocked", "Done"];

/** Deterministic badge color from label text. */
function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function renderCard(card: TaskQueueCard) {
  return html`
    <div class="tq-card">
      <div class="tq-card-title">
        ${card.url
          ? html`<a href=${card.url} target="_blank" rel="noreferrer">${card.name}</a>`
          : card.name}
      </div>
      ${card.labels.length > 0
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
        : nothing}
    </div>
  `;
}

function renderColumn(name: string, cards: TaskQueueCard[]) {
  return html`
    <div class="tq-column">
      <div class="tq-column-header">
        <span class="tq-column-title">${name}</span>
        <span class="tq-column-count">${cards.length}</span>
      </div>
      <div class="tq-column-body">
        ${cards.length === 0
          ? html`<div class="muted" style="padding:8px;text-align:center;">No cards</div>`
          : cards.map((card) => renderCard(card))}
      </div>
    </div>
  `;
}

export function renderTaskQueue(props: TaskQueueProps) {
  if (props.loading && !props.snapshot) {
    return html`
      <section class="card">
        <div class="card-title">Task Queue</div>
        <div class="muted" style="margin-top:12px;">Loading&hellip;</div>
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
    if (list) {
      list.push(card);
    } else {
      cardsByList.set(key, [card]);
    }
  }

  // Show columns in canonical order, then any extras not in COLUMN_ORDER
  const orderedColumns: string[] = [];
  for (const col of COLUMN_ORDER) {
    if (cardsByList.has(col)) {
      orderedColumns.push(col);
    }
  }
  for (const col of cardsByList.keys()) {
    if (!orderedColumns.includes(col)) {
      orderedColumns.push(col);
    }
  }

  // If no cards at all, still show the canonical columns empty
  if (orderedColumns.length === 0) {
    for (const col of COLUMN_ORDER) {
      orderedColumns.push(col);
    }
  }

  const fetchedLabel = new Date(snap.fetchedAt).toLocaleTimeString();

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
        min-width: 220px;
        max-width: 280px;
        flex: 1 0 220px;
        background: var(--bg-secondary, #1a1a2e);
        border-radius: 8px;
        display: flex;
        flex-direction: column;
      }
      .tq-column-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border, #333);
      }
      .tq-column-title {
        font-weight: 600;
        font-size: 13px;
      }
      .tq-column-count {
        font-size: 12px;
        opacity: 0.6;
      }
      .tq-column-body {
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow-y: auto;
        flex: 1;
      }
      .tq-card {
        background: var(--bg-primary, #0f0f23);
        border: 1px solid var(--border, #333);
        border-radius: 6px;
        padding: 10px;
      }
      .tq-card-title {
        font-size: 13px;
        line-height: 1.4;
      }
      .tq-card-title a {
        color: inherit;
        text-decoration: none;
      }
      .tq-card-title a:hover {
        text-decoration: underline;
      }
      .tq-labels {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 6px;
      }
      .tq-label {
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 3px;
        color: #fff;
      }
    </style>

    <section class="card">
      <div class="card-title">
        ${snap.board.name}
        ${snap.board.url
          ? html` <a
              href=${snap.board.url}
              target="_blank"
              rel="noreferrer"
              style="font-size:12px;margin-left:8px;"
              >Open board</a
            >`
          : nothing}
      </div>
      <div class="card-sub">
        ${snap.cards.length} card${snap.cards.length === 1 ? "" : "s"} across
        ${orderedColumns.length} column${orderedColumns.length === 1 ? "" : "s"}
      </div>
      <div class="row" style="margin-top:12px;">
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? "Refreshing\u2026" : "Refresh"}
        </button>
        <span class="muted" style="margin-left:8px;">Fetched ${fetchedLabel}</span>
        ${props.error ? html`<span class="muted" style="margin-left:8px;">${props.error}</span>` : nothing}
      </div>
    </section>

    <section style="margin-top:18px;">
      <div class="tq-board">
        ${orderedColumns.map((col) => renderColumn(col, cardsByList.get(col) ?? []))}
      </div>
    </section>
  `;
}
