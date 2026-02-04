import { html, nothing } from "lit";
import { formatTime, tzAbbrev } from "../time-format.js";

export type MetricsData = {
  today: { cost: number; events: number };
  yesterday: { cost: number };
  weekAvg: { cost: number };
  allTime: {
    cost: number;
    events: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  };
  byModel: Array<{
    model: string;
    events: number;
    cost: number;
    input_tokens: number;
    output_tokens: number;
    cache_tokens: number;
  }>;
  hourly: Array<{ hour: string; cost: number; events: number }>;
  daily: Array<{ day: string; cost: number; events: number }>;
  topSessions: Array<{
    session_key: string;
    events: number;
    cost: number;
    first_event: string;
    last_event: string;
  }>;
  days: number | null;
  fetchedAt: number;
};

export type ModelDetailData = {
  model: string;
  summary: Record<string, unknown>;
  daily: Array<{ day: string; cost: number; events: number }>;
  hourly: Array<{ hour: string; cost: number; events: number }>;
  bySessions: Array<{ session_key: string; events: number; cost: number }>;
};

export type DayDetailData = {
  day: string;
  summary: Record<string, unknown>;
  byModel: Array<{
    model: string;
    cost: number;
    events: number;
    input_tokens: number;
    output_tokens: number;
  }>;
  byHour: Array<{ hour: string; cost: number; events: number }>;
  bySessions: Array<{ session_key: string; events: number; cost: number }>;
};

export type MetricsProps = {
  loading: boolean;
  data: MetricsData | null;
  error: string | null;
  days: number | null;
  modelDetail: ModelDetailData | null;
  modelDetailLoading: boolean;
  dayDetail: DayDetailData | null;
  dayDetailLoading: boolean;
  selectedModel: string | null;
  selectedDay: string | null;
  onRefresh: () => void;
  onDaysChange: (days: number | null) => void;
  onSelectModel: (model: string) => void;
  onSelectDay: (day: string) => void;
  onCloseDetail: () => void;
  onNavigateSession: (sessionKey: string) => void;
  epochCosts: EpochCostData | null;
  costAccuracy: CostAccuracyData | null;
};

export type CostAccuracyData = {
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

export type EpochCostEntry = {
  epoch: string;
  color: string;
  count: number;
  completed: number;
  estimated_total: number;
  actual_total: number;
  cards: Array<{
    card_id: string;
    name: string;
    complexity: string;
    estimated: number;
    actual: number;
    status: string;
  }>;
};

export type EpochCostData = {
  epochs: EpochCostEntry[];
  total_estimated: number;
  total_actual: number;
  total_cards: number;
};

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function costColor(cost: number, avg: number): string {
  if (cost > avg * 1.5) return "#da3633";
  if (cost > avg) return "#d29922";
  return "#238636";
}

function renderSparkline(data: Array<{ cost: number }>, width = 200, height = 40) {
  if (data.length < 2) return nothing;
  const max = Math.max(...data.map((d) => d.cost), 0.01);
  const step = width / (data.length - 1);
  const points = data
    .map((d, i) => `${i * step},${height - (d.cost / max) * (height - 4)}`)
    .join(" ");
  const fill = `0,${height} ${points} ${(data.length - 1) * step},${height}`;
  return html`
    <svg width="${width}" height="${height}" style="display:block;">
      <polygon points="${fill}" fill="rgba(31,111,235,0.15)" />
      <polyline points="${points}" fill="none" stroke="#1f6feb" stroke-width="1.5" />
    </svg>
  `;
}

function renderModelTable(
  models: MetricsData["byModel"],
  totalCost: number,
  onSelect: (model: string) => void,
  selectedModel: string | null,
) {
  const maxCost = Math.max(...models.map((m) => m.cost), 0.01);
  return html`
    <div class="m-table">
      ${models.map(
        (m) => html`
          <div class="m-model-row ${selectedModel === m.model ? "m-model-selected" : ""}"
            @click=${() => onSelect(m.model)}
            title="Click for details"
          >
            <div class="m-model-name">${m.model}</div>
            <div class="m-model-bar">
              <div style="width:${Math.max(2, (m.cost / maxCost) * 100)}%;height:16px;background:#1f6feb;border-radius:3px;transition:width 0.3s"></div>
            </div>
            <div class="m-model-cost">${formatCost(m.cost)}</div>
            <div class="m-model-pct">${totalCost > 0 ? Math.round((m.cost / totalCost) * 100) : 0}%</div>
            <div class="m-model-events">${m.events.toLocaleString()} calls</div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderDailyChart(
  daily: MetricsData["daily"],
  weekAvg: number,
  onSelect: (day: string) => void,
  selectedDay: string | null,
) {
  const maxCost = Math.max(...daily.map((d) => d.cost), 0.01);
  return html`
    <div class="m-daily-chart">
      ${daily.map((d) => {
        const pct = (d.cost / maxCost) * 100;
        const color = costColor(d.cost, weekAvg);
        const label = d.day.slice(5);
        const isSelected = selectedDay === d.day;
        return html`
          <div class="m-daily-bar-wrap ${isSelected ? "m-daily-selected" : ""}"
            @click=${() => onSelect(d.day)}
          >
            <div class="m-daily-tooltip">${formatCost(d.cost)}<br/>${d.events} events</div>
            <div class="m-daily-bar" style="height:${Math.max(2, pct)}%;background:${color}"></div>
            <div class="m-daily-label">${label}</div>
          </div>
        `;
      })}
    </div>
  `;
}

function renderModelDetail(detail: ModelDetailData, loading: boolean) {
  if (loading)
    return html`
      <div class="muted" style="padding: 12px">Loading model detail…</div>
    `;
  const s = detail.summary as Record<string, number>;
  const maxDaily = Math.max(...detail.daily.map((d) => d.cost), 0.01);
  return html`
    <div class="m-detail-section">
      <div class="m-detail-header">
        <span class="m-detail-model">${detail.model}</span>
        <span class="m-detail-stat">${formatCost(s.cost ?? 0)} total</span>
        <span class="m-detail-stat">${(s.events ?? 0).toLocaleString()} events</span>
        <span class="m-detail-stat">${formatCost(s.avg_cost_per_event ?? 0)}/call avg</span>
      </div>
      <div class="m-detail-label">Daily trend</div>
      <div class="m-detail-mini-chart">
        ${detail.daily.map(
          (d) => html`
          <div class="m-mini-bar-wrap" title="${d.day}: ${formatCost(d.cost)}">
            <div class="m-mini-bar" style="height:${Math.max(2, (d.cost / maxDaily) * 100)}%"></div>
            <div class="m-mini-label">${d.day.slice(8)}</div>
          </div>
        `,
        )}
      </div>
      ${
        detail.bySessions.length > 0
          ? html`
        <div class="m-detail-label" style="margin-top:12px">Top sessions</div>
        ${detail.bySessions.map(
          (s) => html`
          <div class="m-detail-session-row">
            <span class="m-detail-session-key">${s.session_key}</span>
            <span style="font-weight:600">${formatCost(s.cost)}</span>
            <span style="opacity:0.4;font-size:11px">${s.events} calls</span>
          </div>
        `,
        )}
      `
          : nothing
      }
      ${renderSparkline(detail.hourly, 400, 40)}
    </div>
  `;
}

function renderDayDetail(
  detail: DayDetailData,
  loading: boolean,
  onNavigateSession: (key: string) => void,
) {
  if (loading)
    return html`
      <div class="muted" style="padding: 12px">Loading day detail…</div>
    `;
  const s = detail.summary as Record<string, number>;
  const maxModel = Math.max(...detail.byModel.map((m) => m.cost), 0.01);
  return html`
    <div class="m-detail-section">
      <div class="m-detail-header">
        <span class="m-detail-model">${detail.day}</span>
        <span class="m-detail-stat">${formatCost(s.cost ?? 0)} total</span>
        <span class="m-detail-stat">${(s.events ?? 0).toLocaleString()} events</span>
        <span class="m-detail-stat">${formatTokens(Number(s.input_tokens ?? 0))} in / ${formatTokens(Number(s.output_tokens ?? 0))} out</span>
      </div>
      <div class="m-detail-label">By model</div>
      <div class="m-table" style="margin-bottom:12px">
        ${detail.byModel.map(
          (m) => html`
          <div class="m-model-row" style="cursor:default">
            <div class="m-model-name">${m.model}</div>
            <div class="m-model-bar">
              <div style="width:${Math.max(2, (m.cost / maxModel) * 100)}%;height:14px;background:#1f6feb;border-radius:3px"></div>
            </div>
            <div class="m-model-cost">${formatCost(m.cost)}</div>
            <div class="m-model-pct">${s.cost ? Math.round((m.cost / s.cost) * 100) : 0}%</div>
            <div class="m-model-events">${m.events} calls</div>
          </div>
        `,
        )}
      </div>
      ${
        detail.bySessions.length > 0
          ? html`
        <div class="m-detail-label">Top sessions</div>
        ${detail.bySessions.map(
          (sess) => html`
          <div class="m-detail-session-row" @click=${() => onNavigateSession(sess.session_key)}
            title="Click to open session" style="cursor:pointer">
            <span class="m-detail-session-key">${sess.session_key}</span>
            <span style="font-weight:600">${formatCost(sess.cost)}</span>
            <span style="opacity:0.4;font-size:11px">${sess.events} calls</span>
          </div>
        `,
        )}
      `
          : nothing
      }
      <div class="m-detail-label" style="margin-top:12px">Hourly</div>
      ${renderSparkline(detail.byHour, 400, 40)}
    </div>
  `;
}

export function renderMetrics(props: MetricsProps) {
  if (props.loading && !props.data) {
    return html`
      <section class="card">
        <div class="card-title">Metrics</div>
        <div class="muted" style="margin-top: 12px">Loading…</div>
      </section>
    `;
  }
  if (props.error && !props.data) {
    return html`<section class="card">
      <div class="card-title">Metrics</div>
      <div style="color:#da3633;margin-top:12px;">${props.error}</div>
      <button class="btn" style="margin-top:8px;" @click=${props.onRefresh}>Retry</button>
    </section>`;
  }
  if (!props.data) {
    return html`<section class="card">
      <div class="card-title">Metrics</div>
      <button class="btn" style="margin-top:12px;" @click=${props.onRefresh}>Load</button>
    </section>`;
  }

  const d = props.data;
  const todayColor = costColor(d.today.cost, d.weekAvg.cost);
  const todayVsAvg =
    d.weekAvg.cost > 0 ? ((d.today.cost / d.weekAvg.cost - 1) * 100).toFixed(0) : "0";
  const todayDir = Number(todayVsAvg) > 0 ? "↑" : Number(todayVsAvg) < 0 ? "↓" : "→";

  const daysPills: Array<{ value: number | null; label: string }> = [
    { value: 7, label: "7d" },
    { value: 14, label: "14d" },
    { value: 30, label: "30d" },
    { value: null, label: "All" },
  ];

  // Is there a detail panel open?
  const hasDetail = props.selectedModel || props.selectedDay;

  return html`
    <style>
      .m-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 12px; }
      .m-stat-card {
        background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
        padding: 16px; text-align: center;
      }
      .m-stat-value { font-size: 28px; font-weight: 700; line-height: 1.2; }
      .m-stat-label { font-size: 11px; opacity: 0.5; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
      .m-stat-sub { font-size: 12px; margin-top: 4px; }

      .m-section { margin-top: 20px; }
      .m-section-header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 12px;
      }
      .m-section-title {
        font-size: 13px; font-weight: 600; opacity: 0.6;
        text-transform: uppercase; letter-spacing: 0.5px;
      }

      /* Date range pills */
      .m-pills { display: flex; gap: 4px; }
      .m-pill {
        padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 500;
        border: 1px solid var(--border); background: var(--panel); color: var(--text);
        cursor: pointer; transition: all 0.15s;
      }
      .m-pill:hover { border-color: var(--border-strong); }
      .m-pill.active {
        background: var(--bg-accent, rgba(31,111,235,0.12));
        border-color: var(--accent, #1f6feb);
        color: var(--accent, #1f6feb);
      }

      /* Model table */
      .m-model-row {
        display: grid; grid-template-columns: 160px 1fr 70px 40px 90px;
        align-items: center; gap: 8px; padding: 6px 0;
        border-bottom: 1px solid var(--border);
        font-size: 13px; cursor: pointer; transition: background 0.1s;
      }
      .m-model-row:hover { background: var(--bg-hover, rgba(255,255,255,0.03)); }
      .m-model-selected { background: var(--bg-accent, rgba(31,111,235,0.08)) !important; }
      .m-model-name { font-weight: 500; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
      .m-model-cost { text-align: right; font-weight: 600; }
      .m-model-pct { text-align: right; opacity: 0.5; font-size: 12px; }
      .m-model-events { text-align: right; opacity: 0.4; font-size: 11px; }

      /* Daily chart with tooltips */
      .m-daily-chart {
        display: flex; align-items: flex-end; gap: 4px; height: 120px;
        padding: 0 4px; border-bottom: 1px solid var(--border);
      }
      .m-daily-bar-wrap {
        flex: 1; display: flex; flex-direction: column; align-items: center;
        height: 100%; justify-content: flex-end; cursor: pointer; position: relative;
      }
      .m-daily-bar-wrap:hover .m-daily-tooltip { opacity: 1; transform: translateX(-50%) translateY(-4px); }
      .m-daily-bar-wrap:hover .m-daily-bar { filter: brightness(1.2); }
      .m-daily-selected .m-daily-bar {
        box-shadow: 0 0 0 2px var(--accent, #1f6feb);
      }
      .m-daily-tooltip {
        position: absolute; top: -8px; left: 50%;
        transform: translateX(-50%); opacity: 0;
        background: var(--panel); border: 1px solid var(--border-strong);
        border-radius: 6px; padding: 4px 8px;
        font-size: 11px; white-space: nowrap; z-index: 10;
        pointer-events: none; transition: all 0.15s;
        text-align: center; line-height: 1.3;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      }
      .m-daily-bar { width: 100%; max-width: 40px; border-radius: 3px 3px 0 0; transition: all 0.3s; min-height: 2px; }
      .m-daily-label { font-size: 10px; opacity: 0.4; margin-top: 4px; }

      /* Session rows */
      .m-session-row {
        display: grid; grid-template-columns: 1fr 70px 60px;
        align-items: center; gap: 8px; padding: 6px 0;
        border-bottom: 1px solid var(--border); font-size: 13px;
        cursor: pointer; transition: background 0.1s;
      }
      .m-session-row:hover { background: var(--bg-hover, rgba(255,255,255,0.03)); }
      .m-session-key { font-size: 12px; overflow: hidden; text-overflow: ellipsis; opacity: 0.8; }

      /* Cost accuracy chart */
      .m-accuracy-chart { margin-top: 12px; }
      .m-accuracy-row {
        display: grid; grid-template-columns: 120px 1fr 45px;
        gap: 8px; align-items: center; padding: 4px 0; font-size: 11px;
      }
      .m-accuracy-name {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.7;
      }
      .m-accuracy-bars {
        position: relative; height: 12px; background: var(--border); border-radius: 3px; overflow: hidden;
      }
      .m-accuracy-est {
        position: absolute; top: 0; left: 0; height: 100%;
        background: rgba(255,255,255,0.15); border-radius: 3px;
      }
      .m-accuracy-act {
        position: absolute; top: 2px; left: 0; height: calc(100% - 4px);
        border-radius: 2px;
      }
      .m-accuracy-ratio { text-align: right; font-weight: 600; }

      @media (max-width: 600px) {
        .m-accuracy-row { grid-template-columns: 80px 1fr 40px; }
      }

      /* Epoch costs */
      .m-epoch-grid { display: flex; flex-direction: column; gap: 6px; }
      .m-epoch-row {
        display: grid; grid-template-columns: 10px 100px 1fr 70px 60px;
        align-items: center; gap: 8px; font-size: 12px;
      }
      .m-epoch-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
      .m-epoch-name { font-weight: 500; text-transform: capitalize; }
      .m-epoch-bar-wrap {
        height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;
      }
      .m-epoch-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
      .m-epoch-cost { text-align: right; font-weight: 600; }
      .m-epoch-count { text-align: right; opacity: 0.4; font-size: 11px; }

      @media (max-width: 600px) {
        .m-epoch-row { grid-template-columns: 8px 80px 1fr 60px; }
        .m-epoch-count { display: none; }
      }

      .m-refresh-bar { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
      .m-sparkline-wrap { display: flex; align-items: center; gap: 12px; }

      /* Detail panel */
      .m-detail-overlay {
        margin-top: 16px; padding: 16px;
        background: var(--panel); border: 1px solid var(--border);
        border-radius: 10px; position: relative;
      }
      .m-detail-close {
        position: absolute; top: 8px; right: 8px;
        background: none; border: none; cursor: pointer;
        font-size: 18px; opacity: 0.5; color: var(--text);
        padding: 4px 8px; border-radius: 4px;
      }
      .m-detail-close:hover { opacity: 1; background: var(--bg-hover); }
      .m-detail-section { }
      .m-detail-header {
        display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .m-detail-model { font-size: 16px; font-weight: 700; }
      .m-detail-stat { font-size: 13px; opacity: 0.6; }
      .m-detail-label {
        font-size: 11px; font-weight: 600; opacity: 0.4;
        text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
      }
      .m-detail-mini-chart {
        display: flex; align-items: flex-end; gap: 3px; height: 60px;
      }
      .m-mini-bar-wrap {
        flex: 1; display: flex; flex-direction: column; align-items: center;
        height: 100%; justify-content: flex-end;
      }
      .m-mini-bar {
        width: 100%; max-width: 20px; background: #1f6feb;
        border-radius: 2px 2px 0 0; min-height: 2px;
      }
      .m-mini-label { font-size: 9px; opacity: 0.3; margin-top: 2px; }
      .m-detail-session-row {
        display: grid; grid-template-columns: 1fr auto auto;
        gap: 8px; padding: 4px 0; font-size: 13px;
        border-bottom: 1px solid var(--border);
      }
      .m-detail-session-key { font-size: 12px; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; }
    </style>

    <!-- Date range pills -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <div class="m-pills">
        ${daysPills.map(
          (p) => html`
          <button class="m-pill ${props.days === p.value ? "active" : ""}"
            @click=${() => props.onDaysChange(p.value)}>${p.label}</button>
        `,
        )}
      </div>
    </div>

    <!-- Top stats -->
    <div class="m-grid">
      <div class="m-stat-card">
        <div class="m-stat-value" style="color:${todayColor}">${formatCost(d.today.cost)}</div>
        <div class="m-stat-label">Today</div>
        <div class="m-stat-sub" style="color:${todayColor}">${todayDir} ${Math.abs(Number(todayVsAvg))}% vs avg</div>
      </div>
      <div class="m-stat-card">
        <div class="m-stat-value">${formatCost(d.yesterday.cost)}</div>
        <div class="m-stat-label">Yesterday</div>
      </div>
      <div class="m-stat-card">
        <div class="m-stat-value">${formatCost(d.weekAvg.cost)}</div>
        <div class="m-stat-label">7-Day Avg</div>
      </div>
      <div class="m-stat-card">
        <div class="m-stat-value">${formatCost(d.allTime.cost)}</div>
        <div class="m-stat-label">${d.days ? `${d.days}d Total` : "All Time"}</div>
        <div class="m-stat-sub" style="opacity:0.5">${d.allTime.events.toLocaleString()} events</div>
      </div>
      <div class="m-stat-card">
        <div class="m-stat-value">${formatTokens(d.allTime.inputTokens + d.allTime.outputTokens)}</div>
        <div class="m-stat-label">Total Tokens</div>
        <div class="m-stat-sub" style="opacity:0.5">${formatTokens(d.allTime.cacheTokens)} cache</div>
      </div>
    </div>

    <!-- 48h Sparkline -->
    <div class="m-section">
      <div class="m-section-title">Cost — Last 48 Hours</div>
      <div class="m-sparkline-wrap">
        ${renderSparkline(d.hourly, 600, 60)}
      </div>
    </div>

    <!-- Daily chart -->
    <div class="m-section">
      <div class="m-section-header">
        <div class="m-section-title">Daily Cost</div>
        <div style="font-size:11px;opacity:0.4">Click a bar for details</div>
      </div>
      ${renderDailyChart(d.daily, d.weekAvg.cost, props.onSelectDay, props.selectedDay)}
    </div>

    <!-- Day detail panel -->
    ${
      props.selectedDay && props.dayDetail
        ? html`
      <div class="m-detail-overlay">
        <button class="m-detail-close" @click=${props.onCloseDetail}>✕</button>
        ${renderDayDetail(props.dayDetail, props.dayDetailLoading, props.onNavigateSession)}
      </div>
    `
        : props.selectedDay && props.dayDetailLoading
          ? html`
      <div class="m-detail-overlay">
        <button class="m-detail-close" @click=${props.onCloseDetail}>✕</button>
        <div class="muted" style="padding:12px">Loading day detail…</div>
      </div>
    `
          : nothing
    }

    <!-- Model breakdown -->
    <div class="m-section">
      <div class="m-section-header">
        <div class="m-section-title">Cost by Model</div>
        <div style="font-size:11px;opacity:0.4">Click a model for details</div>
      </div>
      ${renderModelTable(d.byModel, d.allTime.cost, props.onSelectModel, props.selectedModel)}
    </div>

    <!-- Model detail panel -->
    ${
      props.selectedModel && props.modelDetail
        ? html`
      <div class="m-detail-overlay">
        <button class="m-detail-close" @click=${props.onCloseDetail}>✕</button>
        ${renderModelDetail(props.modelDetail, props.modelDetailLoading)}
      </div>
    `
        : props.selectedModel && props.modelDetailLoading
          ? html`
      <div class="m-detail-overlay">
        <button class="m-detail-close" @click=${props.onCloseDetail}>✕</button>
        <div class="muted" style="padding:12px">Loading model detail…</div>
      </div>
    `
          : nothing
    }

    <!-- Top sessions -->
    ${
      d.topSessions.length > 0
        ? html`
        <div class="m-section">
          <div class="m-section-title">Top Sessions (24h)</div>
          ${d.topSessions.map(
            (s) => html`
              <div class="m-session-row" @click=${() => props.onNavigateSession(s.session_key)}
                title="Click to view session">
                <div class="m-session-key">${s.session_key}</div>
                <div style="text-align:right;font-weight:600;">${formatCost(s.cost)}</div>
                <div style="text-align:right;opacity:0.4;font-size:11px;">${s.events} calls</div>
              </div>
            `,
          )}
        </div>`
        : nothing
    }

    <!-- Cost estimation accuracy -->
    ${props.costAccuracy && props.costAccuracy.completed > 0 ? (() => {
      const ca = props.costAccuracy;
      const accPct = ca.avg_accuracy_ratio > 0 ? Math.round((1 - Math.abs(1 - ca.avg_accuracy_ratio)) * 100) : 0;
      const accColor = accPct >= 80 ? "#66bb6a" : accPct >= 60 ? "#ffa726" : "#ef5350";
      const variance = ca.total_actual_usd - ca.total_estimated_usd;
      const varianceDir = variance > 0 ? "over" : "under";
      return html`
        <div class="m-section">
          <div class="m-section-header">
            <div class="m-section-title">Cost Estimation Accuracy</div>
            <div style="font-size:11px;opacity:0.4">${ca.completed} completed tasks</div>
          </div>
          <div class="m-grid" style="grid-template-columns: repeat(4, 1fr)">
            <div class="m-stat-card">
              <div class="m-stat-value" style="color:${accColor}">${accPct}%</div>
              <div class="m-stat-label">Accuracy</div>
            </div>
            <div class="m-stat-card">
              <div class="m-stat-value">${formatCost(ca.total_estimated_usd)}</div>
              <div class="m-stat-label">Estimated</div>
            </div>
            <div class="m-stat-card">
              <div class="m-stat-value">${formatCost(ca.total_actual_usd)}</div>
              <div class="m-stat-label">Actual</div>
            </div>
            <div class="m-stat-card">
              <div class="m-stat-value" style="color:${variance > 0 ? '#ef5350' : '#66bb6a'}">${variance > 0 ? '+' : ''}${formatCost(variance)}</div>
              <div class="m-stat-label">Variance (${varianceDir})</div>
            </div>
          </div>
          ${ca.recent.filter((r) => r.status === "completed" && r.estimated > 0 && r.actual > 0).length > 0 ? html`
            <div class="m-accuracy-chart">
              ${ca.recent.filter((r) => r.status === "completed" && r.estimated > 0 && r.actual > 0).map((r) => {
                const ratio = r.actual / r.estimated;
                const rColor = ratio <= 1.1 ? "#66bb6a" : ratio <= 1.5 ? "#ffa726" : "#ef5350";
                const estBar = 50; // estimated is always 50% baseline
                const actBar = Math.min(100, Math.round(ratio * 50));
                return html`
                  <div class="m-accuracy-row">
                    <span class="m-accuracy-name" title="${r.name}">${r.name}</span>
                    <span class="m-accuracy-bars">
                      <span class="m-accuracy-est" style="width:${estBar}%"></span>
                      <span class="m-accuracy-act" style="width:${actBar}%;background:${rColor}"></span>
                    </span>
                    <span class="m-accuracy-ratio" style="color:${rColor}">${(ratio * 100).toFixed(0)}%</span>
                  </div>
                `;
              })}
              <div style="display:flex;gap:12px;font-size:10px;opacity:0.4;margin-top:4px">
                <span>▬ estimated</span>
                <span style="color:#66bb6a">▬ actual (≤110%)</span>
                <span style="color:#ffa726">▬ actual (110-150%)</span>
                <span style="color:#ef5350">▬ actual (>150%)</span>
              </div>
            </div>
          ` : nothing}
          ${ca.calibration.last_calibrated ? html`
            <div style="font-size:11px;opacity:0.4;margin-top:8px">
              Calibrated: ${formatTime(new Date(ca.calibration.last_calibrated).getTime())}
              · ${ca.calibration.total_samples ?? 0} samples
            </div>
          ` : html`
            <div style="font-size:11px;opacity:0.4;margin-top:8px">
              Not yet calibrated — need more completed tasks with cost tracking
            </div>
          `}
        </div>
      `;
    })() : nothing}

    <!-- Epoch cost breakdown -->
    ${props.epochCosts && props.epochCosts.epochs.length > 0 ? html`
      <div class="m-section">
        <div class="m-section-header">
          <div class="m-section-title">Cost by Epoch</div>
          <div style="font-size:11px;opacity:0.4">${props.epochCosts.total_cards} tracked cards</div>
        </div>
        <div class="m-epoch-grid">
          ${props.epochCosts.epochs.map((e) => {
            const total = e.actual_total || e.estimated_total;
            const maxCost = Math.max(...props.epochCosts!.epochs.map((x) => x.actual_total || x.estimated_total), 1);
            const barPct = Math.round((total / maxCost) * 100);
            return html`
              <div class="m-epoch-row">
                <span class="m-epoch-dot" style="background:${e.color}"></span>
                <span class="m-epoch-name">${e.epoch}</span>
                <span class="m-epoch-bar-wrap">
                  <span class="m-epoch-bar" style="width:${barPct}%;background:${e.color}"></span>
                </span>
                <span class="m-epoch-cost">${formatCost(total)}</span>
                <span class="m-epoch-count">${e.count} cards</span>
              </div>
            `;
          })}
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:11px;opacity:0.4">
          <span>Total estimated: ${formatCost(props.epochCosts.total_estimated)}</span>
          <span>Total actual: ${formatCost(props.epochCosts.total_actual)}</span>
        </div>
      </div>
    ` : nothing}

    <div class="m-refresh-bar">
      <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
        ${props.loading ? "↻" : "↻ Refresh"}
      </button>
      <span class="muted" style="font-size:11px;">
        ${formatTime(d.fetchedAt)}
      </span>
    </div>
  `;
}
