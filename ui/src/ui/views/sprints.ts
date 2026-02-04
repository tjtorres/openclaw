import { html, nothing } from "lit";

// --- Types ---

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

export type SprintsListData = {
  sprints: SprintData[];
  active: SprintData | null;
  velocity: VelocityEntry[];
  fetchedAt: number;
};

export type SprintsProps = {
  loading: boolean;
  data: SprintsListData | null;
  error: string | null;
  showCreateForm: boolean;
  onRefresh: () => void;
  onCreate: (name: string, goal: string, endDate: string, pullFromBoard: boolean) => void;
  onComplete: (sprintId: string) => void;
  onCancel: (sprintId: string) => void;
  onToggleCreateForm: () => void;
  onCompleteCard: (sprintId: string, cardId: string) => void;
};

// --- Helpers ---

function daysLeft(endDate: string): number {
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// --- Burndown Chart (SVG) ---

function renderBurndown(burndown: BurndownPoint[]) {
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

  // Ideal line (straight from total to 0)
  const idealStart = `${xScale(0)},${yScale(total)}`;
  const idealEnd = `${xScale(n - 1)},${yScale(0)}`;

  // Actual burndown path
  const actualPath = burndown
    .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(i)},${yScale(p.remaining)}`)
    .join(" ");

  // Y-axis labels
  const yLabels = [0, Math.round(total / 2), total];

  return html`
    <svg viewBox="0 0 ${W} ${H}" class="sp-chart" preserveAspectRatio="xMidYMid meet">
      <!-- Grid -->
      ${yLabels.map(
        (v) => html`
        <line x1="${pad.left}" y1="${yScale(v)}" x2="${W - pad.right}" y2="${yScale(v)}"
          stroke="var(--border)" stroke-width="0.5" stroke-dasharray="3,3" />
        <text x="${pad.left - 6}" y="${yScale(v) + 4}" text-anchor="end"
          fill="var(--text)" opacity="0.4" font-size="10">${v}</text>
      `,
      )}

      <!-- Ideal line -->
      <line x1="${idealStart.split(",")[0]}" y1="${idealStart.split(",")[1]}"
        x2="${idealEnd.split(",")[0]}" y2="${idealEnd.split(",")[1]}"
        stroke="var(--border-strong)" stroke-width="1.5" stroke-dasharray="6,4" opacity="0.5" />

      <!-- Actual burndown -->
      <path d="${actualPath}" fill="none" stroke="#58a6ff" stroke-width="2.5" stroke-linecap="round" />

      <!-- Points -->
      ${burndown.map(
        (p, i) => html`
        <circle cx="${xScale(i)}" cy="${yScale(p.remaining)}" r="3"
          fill="${p.remaining === 0 ? "#238636" : "#58a6ff"}" />
      `,
      )}

      <!-- X-axis dates (first, middle, last) -->
      ${[0, Math.floor(n / 2), n - 1]
        .filter((i, idx, arr) => arr.indexOf(i) === idx)
        .map(
          (i) => html`
        <text x="${xScale(i)}" y="${H - 4}" text-anchor="middle"
          fill="var(--text)" opacity="0.4" font-size="9">
          ${fmtDate(burndown[i]!.date)}
        </text>
      `,
        )}
    </svg>
  `;
}

// --- Sprint card list ---

function renderSprintCards(sprint: SprintData, props: SprintsProps) {
  const sorted = [...sprint.cards].sort((a, b) => {
    // Incomplete first, then by name
    if (a.completedAt && !b.completedAt) return 1;
    if (!a.completedAt && b.completedAt) return -1;
    return a.cardName.localeCompare(b.cardName);
  });

  return html`
    <div class="sp-cards">
      ${sorted.map(
        (c) => html`
        <div class="sp-card-row ${c.completedAt ? "sp-card-done" : ""}">
          <span class="sp-card-check" @click=${() => {
            if (!c.completedAt) props.onCompleteCard(sprint.id, c.cardId);
          }}>
            ${c.completedAt ? "✅" : "⬜"}
          </span>
          <span class="sp-card-name">${c.cardName}</span>
          ${c.completedAt
            ? html`<span class="sp-card-date">${fmtDate(c.completedAt)}</span>`
            : nothing}
        </div>
      `,
      )}
      ${sprint.cards.length === 0 ? html`<div class="sp-empty">No cards in sprint</div>` : nothing}
    </div>
  `;
}

// --- Create sprint form ---

function renderCreateForm(props: SprintsProps) {
  if (!props.showCreateForm) return nothing;

  const today = new Date().toISOString().split("T")[0];
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

  return html`
    <div class="sp-create-form">
      <div class="sp-form-title">New Sprint</div>
      <input id="sp-name" type="text" placeholder="Sprint name" class="sp-input" value="Sprint ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}" />
      <input id="sp-goal" type="text" placeholder="Sprint goal (optional)" class="sp-input" />
      <div class="sp-form-row">
        <label class="sp-form-label">End date</label>
        <input id="sp-end" type="date" class="sp-input" value="${twoWeeks}" min="${today}" />
      </div>
      <label class="sp-form-row" style="cursor:pointer;font-size:13px;gap:8px;">
        <input id="sp-pull" type="checkbox" checked style="accent-color:#238636" />
        Pull Approved + In Progress cards from Task Queue board
      </label>
      <div class="sp-form-actions">
        <button class="sp-btn sp-btn-primary" @click=${() => {
          const name = (document.getElementById("sp-name") as HTMLInputElement)?.value?.trim();
          const goal = (document.getElementById("sp-goal") as HTMLInputElement)?.value?.trim() ?? "";
          const end = (document.getElementById("sp-end") as HTMLInputElement)?.value ?? twoWeeks;
          const pull = (document.getElementById("sp-pull") as HTMLInputElement)?.checked ?? false;
          if (name) props.onCreate(name, goal, end, pull);
        }}>Create Sprint</button>
        <button class="sp-btn" @click=${props.onToggleCreateForm}>Cancel</button>
      </div>
    </div>
  `;
}

// --- Velocity mini-chart ---

function renderVelocity(velocity: VelocityEntry[]) {
  if (velocity.length === 0) return nothing;

  const maxCards = Math.max(...velocity.map((v) => v.total), 1);

  return html`
    <div class="sp-section">
      <div class="sp-section-title">📈 Velocity (last ${velocity.length} sprints)</div>
      <div class="sp-velocity">
        ${velocity.map(
          (v) => html`
          <div class="sp-vel-bar-group">
            <div class="sp-vel-bar-bg" style="height:${Math.round((v.total / maxCards) * 60)}px">
              <div class="sp-vel-bar-fill" style="height:${Math.round((v.completed / maxCards) * 60)}px"></div>
            </div>
            <div class="sp-vel-label">${v.completed}/${v.total}</div>
            <div class="sp-vel-name">${v.name}</div>
          </div>
        `,
        )}
      </div>
    </div>
  `;
}

// --- Main render ---

export function renderSprints(props: SprintsProps) {
  if (props.loading && !props.data) {
    return html`<section class="card"><div class="card-title">Sprints</div><div class="muted" style="margin-top:12px">Loading…</div></section>`;
  }
  if (props.error && !props.data) {
    return html`<section class="card"><div class="card-title">Sprints</div><div style="color:#da3633;margin-top:12px">${props.error}</div></section>`;
  }

  const data = props.data;
  const active = data?.active ?? null;
  const past = (data?.sprints ?? []).filter((s) => s.status !== "active").slice(-5).reverse();

  return html`
    <style>
      .sp-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
      .sp-header-title { font-size: 18px; font-weight: 700; flex: 1; }

      .sp-active {
        background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
        overflow: hidden; margin-bottom: 20px;
      }
      .sp-active-header {
        padding: 16px 20px; display: flex; align-items: center; gap: 12px;
        border-bottom: 1px solid var(--border);
      }
      .sp-active-title { font-size: 16px; font-weight: 700; flex: 1; }
      .sp-active-badge {
        font-size: 11px; font-weight: 600; padding: 3px 10px;
        border-radius: 12px; background: #1f6feb22; color: #58a6ff;
      }
      .sp-active-goal {
        padding: 8px 20px; font-size: 13px; opacity: 0.6; font-style: italic;
        border-bottom: 1px solid var(--border);
      }

      .sp-stats {
        display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
        padding: 14px 20px;
      }
      .sp-stat { text-align: center; }
      .sp-stat-val { font-size: 20px; font-weight: 700; }
      .sp-stat-label { font-size: 10px; text-transform: uppercase; opacity: 0.4; letter-spacing: 0.5px; }

      .sp-progress { padding: 0 20px 14px; }
      .sp-progress-bar { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
      .sp-progress-fill { height: 100%; border-radius: 4px; transition: width 0.5s; }

      .sp-chart-section { padding: 14px 20px; border-top: 1px solid var(--border); }
      .sp-chart { width: 100%; height: auto; max-height: 180px; }

      .sp-section { padding: 14px 20px; border-top: 1px solid var(--border); }
      .sp-section-title {
        font-size: 11px; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.5px; opacity: 0.4; margin-bottom: 10px;
      }

      .sp-cards { }
      .sp-card-row {
        display: flex; align-items: center; gap: 8px; padding: 6px 0;
        font-size: 13px; border-bottom: 1px solid var(--bg-hover);
      }
      .sp-card-row:last-child { border-bottom: none; }
      .sp-card-done { opacity: 0.4; }
      .sp-card-done .sp-card-name { text-decoration: line-through; }
      .sp-card-check { cursor: pointer; font-size: 12px; }
      .sp-card-name { flex: 1; }
      .sp-card-date { font-size: 11px; opacity: 0.4; }
      .sp-empty { font-size: 13px; opacity: 0.4; padding: 8px 0; }

      .sp-actions { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; gap: 8px; }
      .sp-btn {
        background: var(--border); color: var(--text);
        border: 1px solid var(--border-strong); border-radius: 6px;
        padding: 6px 16px; font-size: 13px; cursor: pointer;
      }
      .sp-btn:hover { background: var(--border-strong); }
      .sp-btn-primary { background: #238636; color: #fff; border-color: #238636; }
      .sp-btn-primary:hover { background: #2ea043; }
      .sp-btn-danger { background: #da3633; color: #fff; border-color: #da3633; }
      .sp-btn-danger:hover { background: #e5534b; }

      .sp-create-form {
        background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
        padding: 20px; margin-bottom: 20px;
      }
      .sp-form-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
      .sp-input {
        width: 100%; box-sizing: border-box; background: var(--bg-muted); color: var(--text);
        border: 1px solid var(--border-strong); border-radius: 6px;
        padding: 8px 10px; font-size: 13px; margin-bottom: 8px; font-family: inherit;
      }
      .sp-input:focus { border-color: #58a6ff; outline: none; }
      .sp-form-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .sp-form-label { font-size: 12px; opacity: 0.6; min-width: 60px; }
      .sp-form-actions { display: flex; gap: 8px; margin-top: 4px; }

      .sp-past { margin-top: 20px; }
      .sp-past-card {
        background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
        padding: 14px 16px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px;
      }
      .sp-past-name { flex: 1; font-size: 14px; font-weight: 600; }
      .sp-past-stat { font-size: 12px; opacity: 0.5; }
      .sp-past-badge {
        font-size: 10px; padding: 2px 8px; border-radius: 10px;
      }
      .sp-past-completed { background: #23863622; color: #238636; }
      .sp-past-cancelled { background: #da363322; color: #da3633; }

      .sp-velocity { display: flex; gap: 16px; align-items: flex-end; }
      .sp-vel-bar-group { text-align: center; flex: 1; }
      .sp-vel-bar-bg {
        width: 100%; background: var(--border); border-radius: 4px;
        overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end;
      }
      .sp-vel-bar-fill { background: #238636; border-radius: 4px; }
      .sp-vel-label { font-size: 11px; font-weight: 600; margin-top: 4px; }
      .sp-vel-name { font-size: 9px; opacity: 0.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .sp-no-sprint {
        text-align: center; padding: 40px 20px;
        background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
      }
      .sp-no-sprint-icon { font-size: 40px; margin-bottom: 12px; }
      .sp-no-sprint-text { font-size: 14px; opacity: 0.5; margin-bottom: 16px; }
    </style>

    <section class="card">
      <div class="sp-header">
        <div class="sp-header-title">🏃 Sprints</div>
        <button class="sp-btn" @click=${props.onRefresh}>↻</button>
        ${!active ? html`
          <button class="sp-btn sp-btn-primary" @click=${props.onToggleCreateForm}>+ New Sprint</button>
        ` : nothing}
      </div>

      ${renderCreateForm(props)}

      ${active ? html`
        <div class="sp-active">
          <div class="sp-active-header">
            <div class="sp-active-title">${active.name}</div>
            <div class="sp-active-badge">
              ${daysLeft(active.endDate)} days left
            </div>
          </div>
          ${active.goal ? html`<div class="sp-active-goal">"${active.goal}"</div>` : nothing}

          <div class="sp-stats">
            <div class="sp-stat">
              <div class="sp-stat-val">${active.completedCount}/${active.cardCount}</div>
              <div class="sp-stat-label">Cards</div>
            </div>
            <div class="sp-stat">
              <div class="sp-stat-val">${pct(active.completedCount, active.cardCount)}%</div>
              <div class="sp-stat-label">Complete</div>
            </div>
            <div class="sp-stat">
              <div class="sp-stat-val">${daysLeft(active.endDate)}</div>
              <div class="sp-stat-label">Days Left</div>
            </div>
            <div class="sp-stat">
              <div class="sp-stat-val">${fmtDate(active.startDate)} – ${fmtDate(active.endDate)}</div>
              <div class="sp-stat-label">Dates</div>
            </div>
          </div>

          <div class="sp-progress">
            <div class="sp-progress-bar">
              <div class="sp-progress-fill" style="width:${pct(active.completedCount, active.cardCount)}%;background:${pct(active.completedCount, active.cardCount) === 100 ? "#238636" : "#1f6feb"}"></div>
            </div>
          </div>

          ${active.burndown && active.burndown.length >= 2 ? html`
            <div class="sp-chart-section">
              <div class="sp-section-title">📉 Burndown</div>
              ${renderBurndown(active.burndown)}
            </div>
          ` : nothing}

          <div class="sp-section">
            <div class="sp-section-title">📋 Cards (${active.completedCount}/${active.cardCount})</div>
            ${renderSprintCards(active, props)}
          </div>

          <div class="sp-actions">
            <button class="sp-btn sp-btn-primary" @click=${() => props.onComplete(active.id)}>
              ✓ Complete Sprint
            </button>
            <button class="sp-btn sp-btn-danger" @click=${() => props.onCancel(active.id)}>
              ✕ Cancel
            </button>
          </div>
        </div>
      ` : !props.showCreateForm ? html`
        <div class="sp-no-sprint">
          <div class="sp-no-sprint-icon">🏃</div>
          <div class="sp-no-sprint-text">No active sprint. Create one to start tracking progress.</div>
          <button class="sp-btn sp-btn-primary" @click=${props.onToggleCreateForm}>+ New Sprint</button>
        </div>
      ` : nothing}

      ${renderVelocity(data?.velocity ?? [])}

      ${past.length > 0 ? html`
        <div class="sp-past">
          <div class="sp-section-title" style="padding:0 0 10px;">📦 Past Sprints</div>
          ${past.map(s => html`
            <div class="sp-past-card">
              <div class="sp-past-name">${s.name}</div>
              <div class="sp-past-stat">${s.completedCount}/${s.cardCount} cards</div>
              <span class="sp-past-badge ${s.status === "completed" ? "sp-past-completed" : "sp-past-cancelled"}">
                ${s.status}
              </span>
            </div>
          `)}
        </div>
      ` : nothing}
    </section>
  `;
}
