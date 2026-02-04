import { html, nothing } from "lit";
import type { GatewayHelloOk } from "../gateway.ts";
import type { UiSettings } from "../storage.ts";
import { formatAgo, formatDurationMs } from "../format.ts";
import { formatNextRun } from "../presenter.ts";

export type PermissionsSummary = {
  level: number;
  levelName: string;
  levelLabel: string;
  role: string;
  approvedEpochs: string[];
  budgetPerDay: number;
  budgetPerSprint: number;
  autoRun: boolean;
  granted: string[];
  denied: string[];
  totalGranted: number;
  totalDenied: number;
  configured: boolean;
};

export type SwarmWorkerInfo = {
  id: string;
  name: string;
  status: "running" | "done" | "failed";
  elapsedMs: number;
};

export type SwarmStatusData = {
  activeSwarms: Array<{
    swarmId: string;
    workers: SwarmWorkerInfo[];
    totalTasks: number;
    completedTasks: number;
    runningTasks: number;
    failedTasks: number;
  }>;
  hasActive: boolean;
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function renderSwarmWidget(data: SwarmStatusData | null) {
  if (!data || !data.hasActive) return nothing;

  return html`
    <div class="card" style="padding: 14px 18px">
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 10px">
        🐝 Active Swarm Workers
      </div>
      ${data.activeSwarms.map((swarm) => html`
        <div style="margin-bottom: 8px">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px">
            ${swarm.swarmId} — ${swarm.completedTasks}/${swarm.totalTasks} done
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px">
            ${swarm.workers.map((w) => {
              const isRunning = w.status === "running";
              const isDone = w.status === "done";
              const isFailed = w.status === "failed";
              return html`
                <div style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--bg-hover, rgba(255,255,255,0.03)); border-radius: 6px">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isDone ? '#66bb6a' : isFailed ? '#ef5350' : '#66bb6a'}; ${isRunning ? 'animation: pulse 1.5s infinite' : ''};"></span>
                  <span style="font-size: 13px; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${w.name}</span>
                  <span style="font-size: 11px; color: var(--text-muted)">${formatElapsed(w.elapsedMs)}</span>
                  <span style="font-size: 11px; padding: 1px 6px; border-radius: 4px; background: ${isDone ? 'rgba(102,187,106,0.2)' : isFailed ? 'rgba(239,83,80,0.2)' : 'rgba(66,165,245,0.2)'}; color: ${isDone ? '#66bb6a' : isFailed ? '#ef5350' : '#42a5f5'}">${w.status}</span>
                </div>
              `;
            })}
          </div>
        </div>
      `)}
    </div>
    <style>
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    </style>
  `;
}

const LEVEL_COLORS: Record<number, string> = {
  1: "#78909c",
  2: "#42a5f5",
  3: "#66bb6a",
  4: "#ffa726",
  5: "#ab47bc",
};

// Callback stored via closure — set by the parent
let _onToggleAutoRun: ((enabled: boolean) => void) | null = null;
export function setAutoRunToggleHandler(handler: (enabled: boolean) => void) {
  _onToggleAutoRun = handler;
}

function renderPermissionsWidget(perms: PermissionsSummary | null) {
  if (!perms || !perms.configured) {
    return html`<div class="card" style="padding: 12px 16px">
      <div class="ov-widget-title">Autonomy</div>
      <div class="muted">Not configured</div>
    </div>`;
  }

  const levelColor = LEVEL_COLORS[perms.level] || "#78909c";
  const pct = Math.round((perms.totalGranted / (perms.totalGranted + perms.totalDenied)) * 100);

  return html`
    <style>
      .ov-widget-title {
        font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
        color: var(--text-muted);
      }
      .ov-perms-header {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 10px; gap: 8px; flex-wrap: wrap;
      }
      .ov-perms-controls {
        display: flex; align-items: center; gap: 8px; flex-shrink: 0;
      }
      .ov-perms-toggle {
        font-size: 11px; padding: 3px 10px; border-radius: 10px;
        cursor: pointer; font-weight: 600; transition: all 0.15s;
      }
      .ov-perms-level {
        color: white; padding: 2px 10px; border-radius: 10px;
        font-size: 12px; font-weight: 600;
      }
      .ov-perms-stats {
        display: grid; grid-template-columns: repeat(3, 1fr);
        gap: 12px; margin-bottom: 10px;
      }
      .ov-perms-stat-label { font-size: 11px; color: var(--text-muted); }
      .ov-perms-stat-value { font-size: 14px; font-weight: 600; text-transform: capitalize; }
      .ov-perms-bar {
        height: 4px; background: var(--bg-hover, rgba(255,255,255,0.08));
        border-radius: 2px; overflow: hidden;
      }
      .ov-perms-bar-fill { height: 100%; border-radius: 2px; }
      .ov-perms-epochs {
        margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap;
      }
      .ov-perms-epoch {
        font-size: 11px; padding: 1px 8px; border-radius: 8px;
        background: rgba(255,255,255,0.06); color: var(--text-muted);
      }
      @media (max-width: 600px) {
        .ov-perms-stats { grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .ov-perms-stat-value { font-size: 13px; }
        .ov-perms-header { flex-direction: column; align-items: flex-start; }
      }
      @media (max-width: 400px) {
        .ov-perms-stats { grid-template-columns: 1fr 1fr; }
      }
    </style>
    <div class="card" style="padding: 14px 18px">
      <div class="ov-perms-header">
        <div class="ov-widget-title">Autonomy & Permissions</div>
        <div class="ov-perms-controls">
          <button
            class="ov-perms-toggle"
            style="border: 1px solid ${perms.autoRun ? '#43a047' : 'var(--border, #555)'}; background: ${perms.autoRun ? 'rgba(67,160,71,0.15)' : 'transparent'}; color: ${perms.autoRun ? '#66bb6a' : 'var(--text-muted)'}"
            @click=${() => _onToggleAutoRun?.(!perms.autoRun)}
            title="${perms.autoRun ? 'Auto-run ON: agent self-approves within permission level' : 'Auto-run OFF: agent needs explicit approval'}"
          >${perms.autoRun ? '⚡ Auto' : '🔒 Manual'}</button>
          <span class="ov-perms-level" style="background: ${levelColor}">${perms.levelLabel}</span>
        </div>
      </div>
      <div class="ov-perms-stats">
        <div>
          <div class="ov-perms-stat-label">Role</div>
          <div class="ov-perms-stat-value">${perms.role}</div>
        </div>
        <div>
          <div class="ov-perms-stat-label">Budget</div>
          <div class="ov-perms-stat-value">$${perms.budgetPerDay}/day</div>
        </div>
        <div>
          <div class="ov-perms-stat-label">Capabilities</div>
          <div class="ov-perms-stat-value">${perms.totalGranted}/${perms.totalGranted + perms.totalDenied}</div>
        </div>
      </div>
      <div class="ov-perms-bar">
        <div class="ov-perms-bar-fill" style="width: ${pct}%; background: ${levelColor}"></div>
      </div>
      ${perms.approvedEpochs.length > 0 ? html`
        <div class="ov-perms-epochs">
          ${perms.approvedEpochs.map((e) => html`<span class="ov-perms-epoch">${e}</span>`)}
        </div>
      ` : nothing}
    </div>
  `;
}
import { renderActivityFeed, type ActivityFeedData } from "./activity-feed.ts";

export type WorkStatusData = {
  currentTask: {
    cardId: string;
    cardName: string;
    startedAt: string;
  } | null;
  progress: {
    total: number;
    done: number;
    pct: number;
    items: Array<{ name: string; done: boolean }>;
  } | null;
  recentStatus: Array<{
    ts: string;
    icon: string;
    message: string;
    category: string;
    cardId: string | null;
  }>;
  summary: string;
  isIdle: boolean;
  fetchedAt: number;
};

export type OverviewProps = {
  connected: boolean;
  hello: GatewayHelloOk | null;
  settings: UiSettings;
  password: string;
  lastError: string | null;
  presenceCount: number;
  sessionsCount: number | null;
  cronEnabled: boolean | null;
  cronNext: number | null;
  lastChannelsRefresh: number | null;
  activityLoading: boolean;
  activityData: ActivityFeedData | null;
  activityError: string | null;
  agentStatus: "idle" | "working";
  agentLastEvent: number;
  agentSession: string | null;
  workStatus: WorkStatusData | null;
  permissions: PermissionsSummary | null;
  swarmStatus: SwarmStatusData | null;
  onSettingsChange: (next: UiSettings) => void;
  onPasswordChange: (next: string) => void;
  onSessionKeyChange: (next: string) => void;
  onConnect: () => void;
  onRefresh: () => void;
};

function renderWorkStatus(ws: WorkStatusData | null) {
  if (!ws) return nothing;

  const statusIndicator = ws.isIdle
    ? html`<span style="color: var(--text-muted)">⏸ Idle</span>`
    : html`<span style="color: var(--accent, #4caf50)">● Active</span>`;

  const progressBar = ws.progress
    ? html`
        <div style="margin-top: 8px">
          <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px">
            <span>${ws.progress.done}/${ws.progress.total} items</span>
            <span>${ws.progress.pct}%</span>
          </div>
          <div style="height: 6px; background: var(--bg-hover); border-radius: 3px; overflow: hidden">
            <div style="height: 100%; width: ${ws.progress.pct}%; background: var(--accent, #4caf50); border-radius: 3px; transition: width 0.3s"></div>
          </div>
        </div>
      `
    : nothing;

  const checklistItems = ws.progress?.items
    ? html`
        <div style="margin-top: 8px; font-size: 12px; max-height: 120px; overflow-y: auto">
          ${ws.progress.items.map(
            (item) => html`
              <div style="padding: 2px 0; display: flex; gap: 6px; align-items: baseline">
                <span style="flex-shrink: 0">${item.done ? "✅" : "⬜"}</span>
                <span style="${item.done ? "text-decoration: line-through; opacity: 0.5" : ""}">${item.name}</span>
              </div>
            `,
          )}
        </div>
      `
    : nothing;

  const statusFeed = ws.recentStatus.length > 0
    ? html`
        <div style="margin-top: 12px; border-top: 1px solid var(--border); padding-top: 8px">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 6px">Live Feed</div>
          ${ws.recentStatus.slice(0, 6).map(
            (s) => html`
              <div style="padding: 3px 0; font-size: 12px; display: flex; gap: 6px; align-items: baseline">
                <span style="flex-shrink: 0">${s.icon}</span>
                <span style="flex: 1; word-break: break-word">${s.message}</span>
                <span style="flex-shrink: 0; color: var(--text-muted); font-size: 11px">${formatAgo(new Date(s.ts).getTime())}</span>
              </div>
            `,
          )}
        </div>
      `
    : nothing;

  return html`
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center">
        <div class="card-title">Agent Work Status</div>
        ${statusIndicator}
      </div>
      <div style="margin-top: 6px; font-size: 14px; line-height: 1.4">
        ${ws.summary}
      </div>
      ${ws.currentTask
        ? html`
            <div style="margin-top: 6px; font-size: 12px; color: var(--text-muted)">
              Task: <strong>${ws.currentTask.cardName}</strong>
              · Started ${formatAgo(new Date(ws.currentTask.startedAt).getTime())}
            </div>
          `
        : nothing}
      ${progressBar}
      ${checklistItems}
      ${statusFeed}
    </div>
  `;
}

export function renderOverview(props: OverviewProps) {
  const snapshot = props.hello?.snapshot as
    | { uptimeMs?: number; policy?: { tickIntervalMs?: number } }
    | undefined;
  const uptime = snapshot?.uptimeMs ? formatDurationMs(snapshot.uptimeMs) : "n/a";
  const tick = snapshot?.policy?.tickIntervalMs ? `${snapshot.policy.tickIntervalMs}ms` : "n/a";
  const authHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const lower = props.lastError.toLowerCase();
    const authFailed = lower.includes("unauthorized") || lower.includes("connect failed");
    if (!authFailed) {
      return null;
    }
    const hasToken = Boolean(props.settings.token.trim());
    const hasPassword = Boolean(props.password.trim());
    if (!hasToken && !hasPassword) {
      return html`
        <div class="muted" style="margin-top: 8px">
          This gateway requires auth. Add a token or password, then click Connect.
          <div style="margin-top: 6px">
            <span class="mono">openclaw dashboard --no-open</span> → tokenized URL<br />
            <span class="mono">openclaw doctor --generate-gateway-token</span> → set token
          </div>
          <div style="margin-top: 6px">
            <a
              class="session-link"
              href="https://docs.openclaw.ai/web/dashboard"
              target="_blank"
              rel="noreferrer"
              title="Control UI auth docs (opens in new tab)"
              >Docs: Control UI auth</a
            >
          </div>
        </div>
      `;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        Auth failed. Re-copy a tokenized URL with
        <span class="mono">openclaw dashboard --no-open</span>, or update the token, then click Connect.
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/dashboard"
            target="_blank"
            rel="noreferrer"
            title="Control UI auth docs (opens in new tab)"
            >Docs: Control UI auth</a
          >
        </div>
      </div>
    `;
  })();
  const insecureContextHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const isSecureContext = typeof window !== "undefined" ? window.isSecureContext : true;
    if (isSecureContext) {
      return null;
    }
    const lower = props.lastError.toLowerCase();
    if (!lower.includes("secure context") && !lower.includes("device identity required")) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        This page is HTTP, so the browser blocks device identity. Use HTTPS (Tailscale Serve) or open
        <span class="mono">http://127.0.0.1:18789</span> on the gateway host.
        <div style="margin-top: 6px">
          If you must stay on HTTP, set
          <span class="mono">gateway.controlUi.allowInsecureAuth: true</span> (token-only).
        </div>
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/gateway/tailscale"
            target="_blank"
            rel="noreferrer"
            title="Tailscale Serve docs (opens in new tab)"
            >Docs: Tailscale Serve</a
          >
          <span class="muted"> · </span>
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/control-ui#insecure-http"
            target="_blank"
            rel="noreferrer"
            title="Insecure HTTP docs (opens in new tab)"
            >Docs: Insecure HTTP</a
          >
        </div>
      </div>
    `;
  })();

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">Gateway Access</div>
        <div class="card-sub">Where the dashboard connects and how it authenticates.</div>
        <div class="form-grid" style="margin-top: 16px;">
          <label class="field">
            <span>WebSocket URL</span>
            <input
              .value=${props.settings.gatewayUrl}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSettingsChange({ ...props.settings, gatewayUrl: v });
              }}
              placeholder="ws://100.x.y.z:18789"
            />
          </label>
          <label class="field">
            <span>Gateway Token</span>
            <input
              .value=${props.settings.token}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSettingsChange({ ...props.settings, token: v });
              }}
              placeholder="OPENCLAW_GATEWAY_TOKEN"
            />
          </label>
          <label class="field">
            <span>Password (not stored)</span>
            <input
              type="password"
              .value=${props.password}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onPasswordChange(v);
              }}
              placeholder="system or shared password"
            />
          </label>
          <label class="field">
            <span>Default Session Key</span>
            <input
              .value=${props.settings.sessionKey}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSessionKeyChange(v);
              }}
            />
          </label>
        </div>
        <div class="row" style="margin-top: 14px;">
          <button class="btn" @click=${() => props.onConnect()}>Connect</button>
          <button class="btn" @click=${() => props.onRefresh()}>Refresh</button>
          <span class="muted">Click Connect to apply connection changes.</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Snapshot</div>
        <div class="card-sub">Latest gateway handshake information.</div>
        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">Status</div>
            <div class="stat-value ${props.connected ? "ok" : "warn"}">
              ${props.connected ? "Connected" : "Disconnected"}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">Uptime</div>
            <div class="stat-value">${uptime}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Tick Interval</div>
            <div class="stat-value">${tick}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Last Channels Refresh</div>
            <div class="stat-value">
              ${props.lastChannelsRefresh ? formatAgo(props.lastChannelsRefresh) : "n/a"}
            </div>
          </div>
        </div>
        ${
          props.lastError
            ? html`<div class="callout danger" style="margin-top: 14px;">
              <div>${props.lastError}</div>
              ${authHint ?? ""}
              ${insecureContextHint ?? ""}
            </div>`
            : html`
                <div class="callout" style="margin-top: 14px">
                  Use Channels to link WhatsApp, Telegram, Discord, Signal, or iMessage.
                </div>
              `
        }
      </div>
    </section>

    <section class="grid grid-cols-3" style="margin-top: 18px;">
      <div class="card stat-card">
        <div class="stat-label">Instances</div>
        <div class="stat-value">${props.presenceCount}</div>
        <div class="muted">Presence beacons in the last 5 minutes.</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Sessions</div>
        <div class="stat-value">${props.sessionsCount ?? "n/a"}</div>
        <div class="muted">Recent session keys tracked by the gateway.</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Cron</div>
        <div class="stat-value">
          ${props.cronEnabled == null ? "n/a" : props.cronEnabled ? "Enabled" : "Disabled"}
        </div>
        <div class="muted">Next wake ${formatNextRun(props.cronNext)}</div>
      </div>
    </section>

    <section style="margin-top: 18px;">
      ${renderPermissionsWidget(props.permissions)}
    </section>

    ${props.swarmStatus?.hasActive ? html`
      <section style="margin-top: 18px;">
        ${renderSwarmWidget(props.swarmStatus)}
      </section>
    ` : nothing}

    <section style="margin-top: 18px;">
      ${renderWorkStatus(props.workStatus)}
    </section>

    <section style="margin-top: 18px;">
      ${renderActivityFeed({
        loading: props.activityLoading,
        data: props.activityData,
        error: props.activityError,
        agentStatus: props.agentStatus,
        agentLastEvent: props.agentLastEvent,
        agentSession: props.agentSession,
      })}
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">Notes</div>
      <div class="card-sub">Quick reminders for remote control setups.</div>
      <div class="note-grid" style="margin-top: 14px;">
        <div>
          <div class="note-title">Tailscale serve</div>
          <div class="muted">
            Prefer serve mode to keep the gateway on loopback with tailnet auth.
          </div>
        </div>
        <div>
          <div class="note-title">Session hygiene</div>
          <div class="muted">Use /new or sessions.patch to reset context.</div>
        </div>
        <div>
          <div class="note-title">Cron reminders</div>
          <div class="muted">Use isolated sessions for recurring runs.</div>
        </div>
      </div>
    </section>
  `;
}
