import { html, nothing } from "lit";

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
  fetchedAt: number;
};

export type MetricsProps = {
  loading: boolean;
  data: MetricsData | null;
  error: string | null;
  onRefresh: () => void;
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

function renderBar(value: number, max: number, color: string, height = 24) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return html`<div
    style="width:${pct}%;height:${height}px;background:${color};border-radius:3px;transition:width 0.3s"
  ></div>`;
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

function renderModelTable(models: MetricsData["byModel"], totalCost: number) {
  const maxCost = Math.max(...models.map((m) => m.cost), 0.01);
  return html`
    <div class="m-table">
      ${models.map(
        (m) => html`
          <div class="m-model-row">
            <div class="m-model-name">${m.model}</div>
            <div class="m-model-bar">${renderBar(m.cost, maxCost, "#1f6feb", 16)}</div>
            <div class="m-model-cost">${formatCost(m.cost)}</div>
            <div class="m-model-pct">${totalCost > 0 ? Math.round((m.cost / totalCost) * 100) : 0}%</div>
            <div class="m-model-events">${m.events.toLocaleString()} calls</div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderDailyChart(daily: MetricsData["daily"], weekAvg: number) {
  const maxCost = Math.max(...daily.map((d) => d.cost), 0.01);
  return html`
    <div class="m-daily-chart">
      ${daily.map((d) => {
        const pct = (d.cost / maxCost) * 100;
        const color = costColor(d.cost, weekAvg);
        const label = d.day.slice(5); // MM-DD
        return html`
          <div class="m-daily-bar-wrap" title="${d.day}: ${formatCost(d.cost)} (${d.events} events)">
            <div class="m-daily-bar" style="height:${Math.max(2, pct)}%;background:${color}"></div>
            <div class="m-daily-label">${label}</div>
          </div>
        `;
      })}
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
      .m-section-title {
        font-size: 13px; font-weight: 600; opacity: 0.6;
        text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;
      }

      .m-model-row {
        display: grid; grid-template-columns: 160px 1fr 70px 40px 90px;
        align-items: center; gap: 8px; padding: 6px 0;
        border-bottom: 1px solid var(--border);
        font-size: 13px;
      }
      .m-model-name { font-weight: 500; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
      .m-model-cost { text-align: right; font-weight: 600; }
      .m-model-pct { text-align: right; opacity: 0.5; font-size: 12px; }
      .m-model-events { text-align: right; opacity: 0.4; font-size: 11px; }

      .m-daily-chart {
        display: flex; align-items: flex-end; gap: 4px; height: 120px;
        padding: 0 4px; border-bottom: 1px solid var(--border);
      }
      .m-daily-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; cursor: default; }
      .m-daily-bar { width: 100%; max-width: 40px; border-radius: 3px 3px 0 0; transition: height 0.3s; min-height: 2px; }
      .m-daily-label { font-size: 10px; opacity: 0.4; margin-top: 4px; }

      .m-session-row {
        display: grid; grid-template-columns: 1fr 70px 60px;
        align-items: center; gap: 8px; padding: 6px 0;
        border-bottom: 1px solid var(--border); font-size: 13px;
      }
      .m-session-key { font-size: 12px; overflow: hidden; text-overflow: ellipsis; opacity: 0.8; }

      .m-refresh-bar { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
      .m-sparkline-wrap { display: flex; align-items: center; gap: 12px; }
    </style>

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
        <div class="m-stat-label">All Time</div>
        <div class="m-stat-sub" style="opacity:0.5">${d.allTime.events.toLocaleString()} events</div>
      </div>
      <div class="m-stat-card">
        <div class="m-stat-value">${formatTokens(d.allTime.inputTokens + d.allTime.outputTokens)}</div>
        <div class="m-stat-label">Total Tokens</div>
        <div class="m-stat-sub" style="opacity:0.5">
          ${formatTokens(d.allTime.cacheTokens)} cache
        </div>
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
      <div class="m-section-title">Daily Cost — Last 14 Days</div>
      ${renderDailyChart(d.daily, d.weekAvg.cost)}
    </div>

    <!-- Model breakdown -->
    <div class="m-section">
      <div class="m-section-title">Cost by Model</div>
      ${renderModelTable(d.byModel, d.allTime.cost)}
    </div>

    <!-- Top sessions -->
    ${
      d.topSessions.length > 0
        ? html`
          <div class="m-section">
            <div class="m-section-title">Top Sessions (24h)</div>
            ${d.topSessions.map(
              (s) => html`
                <div class="m-session-row">
                  <div class="m-session-key">${s.session_key}</div>
                  <div style="text-align:right;font-weight:600;">${formatCost(s.cost)}</div>
                  <div style="text-align:right;opacity:0.4;font-size:11px;">${s.events} calls</div>
                </div>
              `,
            )}
          </div>
        `
        : nothing
    }

    <div class="m-refresh-bar">
      <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
        ${props.loading ? "↻" : "↻ Refresh"}
      </button>
      <span class="muted" style="font-size:11px;">
        ${new Date(d.fetchedAt).toLocaleTimeString()}
      </span>
    </div>
  `;
}
