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
  const map: Record<string, string> = {
    Approved: "#238636",
    New: "#d29922",
    Blocked: "#da3633",
  };
  if (map[label]) return map[label];
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  return `hsl(${((hash % 360) + 360) % 360}, 50%, 40%)`;
}

function columnStyle(name: string): string {
  const map: Record<string, string> = {
    Proposed: "border-top: 3px solid #8b5cf6;",
    Approved: "border-top: 3px solid #238636;",
    Queued: "border-top: 3px solid #6e7681;",
    "In Progress": "border-top: 3px solid #1f6feb;",
    Blocked: "border-top: 3px solid #da3633;",
    Done: "border-top: 3px solid #238636; opacity: 0.7;",
  };
  return map[name] ?? "";
}

function columnIcon(name: string): string {
  const map: Record<string, string> = {
    Proposed: "💡",
    Approved: "✅",
    Queued: "📋",
    "In Progress": "⚡",
    Blocked: "🚫",
    Done: "✨",
  };
  return map[name] ?? "📌";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function renderProgressBar(checked: number, total: number) {
  if (total === 0) return nothing;
  const pct = Math.round((checked / total) * 100);
  const color = pct === 100 ? "#238636" : pct > 50 ? "#1f6feb" : "#6e7681";
  return html`
    <div class="tq-progress">
      <div class="tq-progress-bar">
        <div class="tq-progress-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="tq-progress-text">${checked}/${total}</span>
    </div>
  `;
}

function renderCard(card: TaskQueueCard, isSelected: boolean, onSelect: (id: string) => void) {
  const hasProgress = card.checkItems > 0;
  return html`
    <div class="tq-card ${isSelected ? "tq-card-selected" : ""}" @click=${() => onSelect(card.id)}>
      <div class="tq-card-title">${card.name}</div>
      ${hasProgress ? renderProgressBar(card.checkItemsChecked, card.checkItems) : nothing}
      <div class="tq-card-footer">
        <div class="tq-card-badges">
          ${
            card.commentCount > 0
              ? html`<span class="tq-badge" title="${card.commentCount} comments">💬 ${card.commentCount}</span>`
              : nothing
          }
          ${
            card.hasChecklists && !hasProgress
              ? html`
                  <span class="tq-badge" title="Has checklists">☑</span>
                `
              : nothing
          }
        </div>
        <span class="tq-card-time">${timeAgo(card.dateLastActivity)}</span>
      </div>
      ${
        card.labels.length > 0
          ? html`<div class="tq-labels">
            ${card.labels.map(
              (l) => html`<span class="tq-label" style="background:${labelColor(l)}">${l}</span>`,
            )}
          </div>`
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
) {
  const isDone = name === "Done";
  const display = isDone ? cards.slice(0, 5) : cards;
  const hidden = isDone ? Math.max(0, cards.length - 5) : 0;

  return html`
    <div class="tq-column" style="${columnStyle(name)}">
      <div class="tq-column-header">
        <span class="tq-column-title">${columnIcon(name)} ${name}</span>
        <span class="tq-column-count">${cards.length}</span>
      </div>
      <div class="tq-column-body">
        ${
          display.length === 0
            ? html`
                <div class="tq-empty">No cards</div>
              `
            : display.map((c) => renderCard(c, c.id === selectedCardId, onSelect))
        }
        ${
          hidden > 0
            ? html`<div class="tq-empty" style="font-size:11px;">+${hidden} more</div>`
            : nothing
        }
      </div>
    </div>
  `;
}

function renderCardDetail(props: TaskQueueProps, card: TaskQueueCard, lists: TaskQueueList[]) {
  const detail = props.cardDetail;
  const loading = props.cardDetailLoading;
  const totalCheck = detail?.checklists?.reduce((s, cl) => s + cl.items.length, 0) ?? 0;
  const doneCheck =
    detail?.checklists?.reduce((s, cl) => s + cl.items.filter((i) => i.complete).length, 0) ?? 0;
  const pct = totalCheck > 0 ? Math.round((doneCheck / totalCheck) * 100) : null;

  return html`
    <div class="tq-overlay" @click=${props.onCloseDetail}>
      <div class="tq-panel" @click=${(e: Event) => e.stopPropagation()}>
        <!-- Header -->
        <div class="tq-panel-header">
          <div style="flex:1">
            <div class="tq-panel-title">${card.name}</div>
            <div class="tq-panel-meta">
              <span class="tq-list-badge" style="border-color:${
                columnStyle(card.listName ?? "").includes("#")
                  ? (columnStyle(card.listName ?? "")
                      .split("solid ")[1]
                      ?.replace(";", "") ?? "#555")
                  : "#555"
              }">
                ${columnIcon(card.listName ?? "")} ${card.listName ?? "Unknown"}
              </span>
              ${card.labels.map(
                (l) => html`<span class="tq-label" style="background:${labelColor(l)}">${l}</span>`,
              )}
              ${
                pct !== null
                  ? html`<span class="tq-pct-badge" style="color:${pct === 100 ? "#238636" : "#58a6ff"}">${pct}% complete</span>`
                  : nothing
              }
            </div>
          </div>
          <button class="tq-close" @click=${props.onCloseDetail}>✕</button>
        </div>

        <!-- Actions bar -->
        <div class="tq-actions">
          ${
            card.listName === "Proposed"
              ? html`<button class="tq-btn-approve" @click=${() => props.onApproveCard(card.id)}>
                ✓ Approve
              </button>`
              : nothing
          }
          <select
            class="tq-select"
            @change=${(e: Event) => {
              const t = e.target as HTMLSelectElement;
              if (t.value) {
                props.onMoveCard(card.id, t.value);
                t.value = "";
              }
            }}
          >
            <option value="">Move to…</option>
            ${lists
              .filter((l) => l.id !== card.listId && !l.closed)
              .map((l) => html`<option value=${l.id}>${l.name}</option>`)}
          </select>
          ${
            card.url
              ? html`<a href=${card.url} target="_blank" rel="noreferrer" class="tq-trello-link">
                Open in Trello ↗
              </a>`
              : nothing
          }
        </div>

        ${
          loading
            ? html`
                <div class="tq-loading-bar"></div>
              `
            : nothing
        }

        <!-- Description -->
        ${
          card.desc
            ? html`<div class="tq-section">
              <div class="tq-section-title">Description</div>
              <div class="tq-desc">${card.desc}</div>
            </div>`
            : nothing
        }

        <!-- Overall progress -->
        ${
          pct !== null
            ? html`<div class="tq-section">
              <div class="tq-section-title">Progress</div>
              <div class="tq-big-progress">
                <div class="tq-big-progress-bar">
                  <div
                    class="tq-big-progress-fill"
                    style="width:${pct}%;background:${pct === 100 ? "#238636" : "#1f6feb"}"
                  ></div>
                </div>
                <span class="tq-big-progress-text">${doneCheck}/${totalCheck} (${pct}%)</span>
              </div>
            </div>`
            : nothing
        }

        <!-- Checklists -->
        ${
          detail?.checklists?.map(
            (cl) => html`
            <div class="tq-section">
              <div class="tq-section-title">${cl.name}</div>
              ${cl.items.map(
                (item) => html`
                  <label class="tq-check">
                    <input
                      type="checkbox"
                      ?checked=${item.complete}
                      @change=${() => props.onToggleCheckItem(card.id, item.id, !item.complete)}
                    />
                    <span class="${item.complete ? "tq-check-done" : ""}">${item.name}</span>
                  </label>
                `,
              )}
            </div>
          `,
          ) ?? nothing
        }

        <!-- Comments -->
        ${
          detail?.comments && detail.comments.length > 0
            ? html`<div class="tq-section">
              <div class="tq-section-title">Comments (${detail.comments.length})</div>
              ${detail.comments.map(
                (c) => html`
                  <div class="tq-comment">
                    <div class="tq-comment-head">
                      <strong>${c.author}</strong>
                      <span class="tq-muted">${timeAgo(c.date)}</span>
                    </div>
                    <div class="tq-comment-text">${c.text}</div>
                  </div>
                `,
              )}
            </div>`
            : nothing
        }

        <!-- Add comment -->
        <div class="tq-section">
          <textarea
            id="tq-comment-input"
            rows="2"
            placeholder="Add a comment…"
            class="tq-textarea"
          ></textarea>
          <button
            class="tq-btn-small"
            @click=${() => {
              const ta = document.getElementById("tq-comment-input") as HTMLTextAreaElement;
              if (ta?.value.trim()) {
                props.onAddComment(card.id, ta.value.trim());
                ta.value = "";
              }
            }}
          >
            Post
          </button>
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
    return html`<section class="card">
      <div class="card-title">Task Queue</div>
      <div style="color:#da3633;margin-top:12px;">${props.error}</div>
      <button class="btn" style="margin-top:8px;" @click=${props.onRefresh}>Retry</button>
    </section>`;
  }
  if (!props.snapshot) {
    return html`<section class="card">
      <div class="card-title">Task Queue</div>
      <button class="btn" style="margin-top:12px;" @click=${props.onRefresh}>Load</button>
    </section>`;
  }

  const snap = props.snapshot;
  const byList = new Map<string, TaskQueueCard[]>();
  for (const c of snap.cards) {
    const k = c.listName ?? "Unknown";
    (byList.get(k) ?? (byList.set(k, []), byList.get(k)!)).push(c);
  }
  const cols = [...COLUMN_ORDER.filter((c) => byList.has(c) || COLUMN_ORDER.includes(c))];
  for (const k of byList.keys()) if (!cols.includes(k)) cols.push(k);

  const active = snap.cards.filter((c) => c.listName !== "Done");
  const done = snap.cards.filter((c) => c.listName === "Done");
  const inProgress = snap.cards.filter((c) => c.listName === "In Progress");
  const totalChecks = active.reduce((s, c) => s + c.checkItems, 0);
  const doneChecks = active.reduce((s, c) => s + c.checkItemsChecked, 0);
  const overallPct = totalChecks > 0 ? Math.round((doneChecks / totalChecks) * 100) : null;
  const selected = props.selectedCardId
    ? snap.cards.find((c) => c.id === props.selectedCardId)
    : null;

  return html`
    <style>
      .tq-header { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
      .tq-stats { display: flex; gap: 20px; align-items: center; }
      .tq-stat { text-align: center; }
      .tq-stat-num { font-size: 24px; font-weight: 700; }
      .tq-stat-label { font-size: 11px; opacity: 0.5; text-transform: uppercase; letter-spacing: 0.5px; }
      .tq-stat-active .tq-stat-num { color: #58a6ff; }
      .tq-stat-progress .tq-stat-num { color: #d29922; }
      .tq-stat-done .tq-stat-num { color: #238636; }

      .tq-overall-progress { flex: 1; min-width: 120px; max-width: 300px; }
      .tq-overall-bar { height: 8px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; }
      .tq-overall-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
      .tq-overall-text { font-size: 11px; opacity: 0.5; margin-top: 4px; }

      .tq-board { display: flex; gap: 10px; overflow-x: auto; padding: 4px 0 8px; min-height: 200px; margin-top: 16px; }
      .tq-column {
        min-width: 210px; max-width: 260px; flex: 1 0 210px;
        background: rgba(255,255,255,0.03); border-radius: 10px;
        display: flex; flex-direction: column;
      }
      .tq-column-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      .tq-column-title { font-weight: 600; font-size: 13px; }
      .tq-column-count {
        font-size: 11px; background: rgba(255,255,255,0.08); padding: 2px 7px;
        border-radius: 10px; font-weight: 600;
      }
      .tq-column-body {
        padding: 8px; display: flex; flex-direction: column; gap: 6px;
        overflow-y: auto; flex: 1; max-height: 500px;
      }
      .tq-empty { padding: 12px; text-align: center; opacity: 0.3; font-size: 13px; }

      .tq-card {
        background: var(--bg-primary, #0f0f23); border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px; padding: 10px 12px; cursor: pointer;
        transition: all 0.15s ease;
      }
      .tq-card:hover { border-color: rgba(255,255,255,0.2); transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
      .tq-card-selected { border-color: #58a6ff; box-shadow: 0 0 0 1px #58a6ff; }
      .tq-card-title { font-size: 13px; line-height: 1.4; font-weight: 500; }
      .tq-card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; }
      .tq-card-badges { display: flex; gap: 6px; }
      .tq-badge { font-size: 11px; opacity: 0.5; }
      .tq-card-time { font-size: 10px; opacity: 0.35; }
      .tq-labels { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
      .tq-label { font-size: 10px; padding: 1px 6px; border-radius: 3px; color: #fff; font-weight: 500; }

      .tq-progress { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
      .tq-progress-bar { flex: 1; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; }
      .tq-progress-fill { height: 100%; border-radius: 2px; transition: width 0.3s ease; }
      .tq-progress-text { font-size: 10px; opacity: 0.5; white-space: nowrap; }

      /* Detail panel */
      .tq-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 100;
        display: flex; justify-content: center; align-items: flex-start;
        padding-top: 48px; overflow-y: auto; backdrop-filter: blur(4px);
      }
      .tq-panel {
        background: var(--bg-primary, #0d1117); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 14px; width: 95%; max-width: 640px; max-height: 85vh;
        overflow-y: auto; box-shadow: 0 16px 48px rgba(0,0,0,0.5);
      }
      .tq-panel-header { display: flex; gap: 12px; padding: 20px 20px 12px; }
      .tq-panel-title { font-size: 18px; font-weight: 600; line-height: 1.3; }
      .tq-panel-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
      .tq-list-badge {
        font-size: 12px; padding: 2px 8px; border-radius: 4px;
        border: 1px solid; background: rgba(255,255,255,0.04);
      }
      .tq-pct-badge { font-size: 12px; font-weight: 600; margin-left: 4px; }
      .tq-close {
        background: none; border: none; color: inherit; font-size: 20px;
        cursor: pointer; padding: 4px 8px; opacity: 0.4; border-radius: 6px;
      }
      .tq-close:hover { opacity: 1; background: rgba(255,255,255,0.06); }
      .tq-actions {
        display: flex; gap: 8px; align-items: center; padding: 0 20px 14px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      .tq-btn-approve {
        background: #238636; color: #fff; border: none; padding: 6px 14px;
        border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer;
      }
      .tq-btn-approve:hover { background: #2ea043; }
      .tq-select {
        background: rgba(255,255,255,0.04); color: inherit;
        border: 1px solid rgba(255,255,255,0.12); border-radius: 6px;
        padding: 6px 10px; font-size: 13px;
      }
      .tq-trello-link { font-size: 12px; color: #58a6ff; margin-left: auto; text-decoration: none; }
      .tq-trello-link:hover { text-decoration: underline; }
      .tq-loading-bar {
        height: 2px; background: linear-gradient(90deg, transparent, #58a6ff, transparent);
        animation: tq-shimmer 1.5s infinite;
      }
      @keyframes tq-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }

      .tq-section { padding: 14px 20px; border-top: 1px solid rgba(255,255,255,0.04); }
      .tq-section-title {
        font-size: 11px; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.5px; opacity: 0.4; margin-bottom: 8px;
      }
      .tq-desc { font-size: 14px; line-height: 1.6; white-space: pre-wrap; opacity: 0.8; }

      .tq-big-progress { display: flex; align-items: center; gap: 12px; }
      .tq-big-progress-bar { flex: 1; height: 10px; background: rgba(255,255,255,0.06); border-radius: 5px; overflow: hidden; }
      .tq-big-progress-fill { height: 100%; border-radius: 5px; transition: width 0.5s ease; }
      .tq-big-progress-text { font-size: 13px; font-weight: 600; white-space: nowrap; }

      .tq-check {
        display: flex; align-items: flex-start; gap: 8px; padding: 4px 0;
        font-size: 13px; cursor: pointer;
      }
      .tq-check input { margin-top: 2px; cursor: pointer; accent-color: #238636; }
      .tq-check-done { text-decoration: line-through; opacity: 0.4; }

      .tq-comment { padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.03); }
      .tq-comment-head { display: flex; gap: 8px; align-items: center; font-size: 12px; margin-bottom: 4px; }
      .tq-comment-text { font-size: 13px; line-height: 1.5; white-space: pre-wrap; opacity: 0.8; }
      .tq-muted { opacity: 0.4; }

      .tq-textarea {
        width: 100%; box-sizing: border-box;
        background: rgba(255,255,255,0.04); color: inherit;
        border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
        padding: 10px; font-family: inherit; font-size: 13px; resize: vertical;
      }
      .tq-textarea:focus { border-color: #58a6ff; outline: none; }
      .tq-btn-small {
        margin-top: 8px; background: rgba(255,255,255,0.06); color: inherit;
        border: 1px solid rgba(255,255,255,0.12); border-radius: 6px;
        padding: 6px 16px; font-size: 13px; cursor: pointer;
      }
      .tq-btn-small:hover { background: rgba(255,255,255,0.1); }

      .tq-refresh-bar {
        display: flex; align-items: center; gap: 8px; margin-left: auto;
      }
    </style>

    <section class="card">
      <div class="tq-header">
        <div class="tq-stats">
          <div class="tq-stat tq-stat-active">
            <div class="tq-stat-num">${inProgress.length}</div>
            <div class="tq-stat-label">In Progress</div>
          </div>
          <div class="tq-stat tq-stat-progress">
            <div class="tq-stat-num">${active.length}</div>
            <div class="tq-stat-label">Active</div>
          </div>
          <div class="tq-stat tq-stat-done">
            <div class="tq-stat-num">${done.length}</div>
            <div class="tq-stat-label">Done</div>
          </div>
        </div>

        ${
          overallPct !== null
            ? html`
              <div class="tq-overall-progress">
                <div class="tq-overall-bar">
                  <div
                    class="tq-overall-fill"
                    style="width:${overallPct}%;background:${overallPct === 100 ? "#238636" : "#1f6feb"}"
                  ></div>
                </div>
                <div class="tq-overall-text">
                  Active tasks: ${doneChecks}/${totalChecks} items (${overallPct}%)
                </div>
              </div>
            `
            : nothing
        }

        <div class="tq-refresh-bar">
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "↻" : "↻ Refresh"}
          </button>
          <span class="tq-muted" style="font-size:11px;">
            ${new Date(snap.fetchedAt).toLocaleTimeString()}
          </span>
        </div>
      </div>
      ${
        props.error
          ? html`<div style="color:#da3633;font-size:13px;margin-top:8px;">${props.error}</div>`
          : nothing
      }
    </section>

    <div class="tq-board">
      ${cols.map((col) =>
        renderColumn(col, byList.get(col) ?? [], props.selectedCardId, props.onSelectCard),
      )}
    </div>

    ${selected ? renderCardDetail(props, selected, snap.lists) : nothing}
  `;
}
