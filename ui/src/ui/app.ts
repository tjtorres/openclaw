import { LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { EventLogEntry } from "./app-events.ts";
import type { AppViewState } from "./app-view-state.ts";
import type { DevicePairingList } from "./controllers/devices.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import type { IssueStatus } from "./controllers/issues.ts";
import type { IssuesListResult } from "./controllers/issues.ts";
import type { SkillMessage } from "./controllers/skills.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import type { CardMetrics, TaskQueueCardDetail, TaskQueueSnapshot } from "./task-queue-types.ts";
import type { ResolvedTheme, ThemeMode } from "./theme.ts";
import type {
  AgentsListResult,
  AgentsFilesListResult,
  AgentIdentityResult,
  ConfigSnapshot,
  ConfigUiHints,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  HealthSnapshot,
  LogEntry,
  LogLevel,
  PresenceEntry,
  ChannelsStatusSnapshot,
  SessionsListResult,
  SkillStatusReport,
  StatusSummary,
  NostrProfile,
} from "./types.ts";
import type { ActivityFeedData } from "./views/activity-feed.ts";
import type { NostrProfileFormState } from "./views/channels.nostr-profile-form.ts";
import type { DayDetailData, MetricsData, ModelDetailData } from "./views/metrics.ts";
import type { WorkStatusData } from "./views/overview.ts";
import type { SprintsListData } from "./views/sprints.ts";
import {
  handleChannelConfigReload as handleChannelConfigReloadInternal,
  handleChannelConfigSave as handleChannelConfigSaveInternal,
  handleNostrProfileCancel as handleNostrProfileCancelInternal,
  handleNostrProfileEdit as handleNostrProfileEditInternal,
  handleNostrProfileFieldChange as handleNostrProfileFieldChangeInternal,
  handleNostrProfileImport as handleNostrProfileImportInternal,
  handleNostrProfileSave as handleNostrProfileSaveInternal,
  handleNostrProfileToggleAdvanced as handleNostrProfileToggleAdvancedInternal,
  handleWhatsAppLogout as handleWhatsAppLogoutInternal,
  handleWhatsAppStart as handleWhatsAppStartInternal,
  handleWhatsAppWait as handleWhatsAppWaitInternal,
} from "./app-channels.ts";
import {
  handleAbortChat as handleAbortChatInternal,
  handleSendChat as handleSendChatInternal,
  removeQueuedMessage as removeQueuedMessageInternal,
} from "./app-chat.ts";
import { DEFAULT_CRON_FORM, DEFAULT_LOG_LEVEL_FILTERS } from "./app-defaults.ts";
import { connectGateway as connectGatewayInternal } from "./app-gateway.ts";
import {
  handleConnected,
  handleDisconnected,
  handleFirstUpdated,
  handleUpdated,
} from "./app-lifecycle.ts";
import { renderApp } from "./app-render.ts";
import {
  exportLogs as exportLogsInternal,
  handleChatScroll as handleChatScrollInternal,
  handleLogsScroll as handleLogsScrollInternal,
  resetChatScroll as resetChatScrollInternal,
  scheduleChatScroll as scheduleChatScrollInternal,
} from "./app-scroll.ts";
import {
  applySettings as applySettingsInternal,
  loadCron as loadCronInternal,
  loadOverview as loadOverviewInternal,
  setTab as setTabInternal,
  setTheme as setThemeInternal,
  onPopState as onPopStateInternal,
} from "./app-settings.ts";
import {
  resetToolStream as resetToolStreamInternal,
  type ToolStreamEntry,
} from "./app-tool-stream.ts";
import { resolveInjectedAssistantIdentity } from "./assistant-identity.ts";
import { loadAssistantIdentity as loadAssistantIdentityInternal } from "./controllers/assistant-identity.ts";
import {
  loadIssues as loadIssuesInternal,
  resolveIssue as resolveIssueInternal,
  dismissIssue as dismissIssueInternal,
  reopenIssue as reopenIssueInternal,
} from "./controllers/issues.ts";
import {
  loadSprints as loadSprintsInternal,
  createSprint as createSprintInternal,
  completeSprint as completeSprintInternal,
  cancelSprint as cancelSprintInternal,
  completeSprintCard as completeSprintCardInternal,
} from "./controllers/sprints.ts";
import {
  loadTaskQueue as loadTaskQueueInternal,
  loadCardDetail as loadCardDetailInternal,
  moveCard as moveCardInternal,
  approveCard as approveCardInternal,
  addComment as addCommentInternal,
  toggleCheckItem as toggleCheckItemInternal,
  estimateCost as estimateCostInternal,
  loadCostEstimates as loadCostEstimatesInternal,
  loadCostSummary as loadCostSummaryInternal,
} from "./controllers/task-queue.ts";
import { loadSettings, type UiSettings } from "./storage.ts";
import { type ChatAttachment, type ChatQueueItem, type CronFormState } from "./ui-types.ts";

declare global {
  interface Window {
    __OPENCLAW_CONTROL_UI_BASE_PATH__?: string;
  }
}

const injectedAssistantIdentity = resolveInjectedAssistantIdentity();

function resolveOnboardingMode(): boolean {
  if (!window.location.search) {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("onboarding");
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

@customElement("openclaw-app")
export class OpenClawApp extends LitElement {
  @state() settings: UiSettings = loadSettings();
  @state() password = "";
  @state() tab: Tab = "chat";
  @state() onboarding = resolveOnboardingMode();
  @state() connected = false;
  @state() theme: ThemeMode = this.settings.theme ?? "system";
  @state() themeResolved: ResolvedTheme = "dark";
  @state() hello: GatewayHelloOk | null = null;
  @state() lastError: string | null = null;
  @state() eventLog: EventLogEntry[] = [];
  private eventLogBuffer: EventLogEntry[] = [];
  private toolStreamSyncTimer: number | null = null;
  private sidebarCloseTimer: number | null = null;

  @state() assistantName = injectedAssistantIdentity.name;
  @state() assistantAvatar = injectedAssistantIdentity.avatar;
  @state() assistantAgentId = injectedAssistantIdentity.agentId ?? null;

  @state() sessionKey = this.settings.sessionKey;
  @state() chatLoading = false;
  @state() chatSending = false;
  @state() chatMessage = "";
  @state() chatMessages: unknown[] = [];
  @state() chatToolMessages: unknown[] = [];
  @state() chatStream: string | null = null;
  @state() chatStreamStartedAt: number | null = null;
  @state() chatRunId: string | null = null;
  @state() compactionStatus: import("./app-tool-stream.ts").CompactionStatus | null = null;
  @state() chatAvatarUrl: string | null = null;
  @state() chatThinkingLevel: string | null = null;
  @state() chatQueue: ChatQueueItem[] = [];
  @state() chatAttachments: ChatAttachment[] = [];
  // Sidebar state for tool output viewing
  @state() sidebarOpen = false;
  @state() sidebarContent: string | null = null;
  @state() sidebarError: string | null = null;
  @state() splitRatio = this.settings.splitRatio;

  @state() nodesLoading = false;
  @state() nodes: Array<Record<string, unknown>> = [];
  @state() devicesLoading = false;
  @state() devicesError: string | null = null;
  @state() devicesList: DevicePairingList | null = null;
  @state() execApprovalsLoading = false;
  @state() execApprovalsSaving = false;
  @state() execApprovalsDirty = false;
  @state() execApprovalsSnapshot: ExecApprovalsSnapshot | null = null;
  @state() execApprovalsForm: ExecApprovalsFile | null = null;
  @state() execApprovalsSelectedAgent: string | null = null;
  @state() execApprovalsTarget: "gateway" | "node" = "gateway";
  @state() execApprovalsTargetNodeId: string | null = null;
  @state() execApprovalQueue: ExecApprovalRequest[] = [];
  @state() execApprovalBusy = false;
  @state() execApprovalError: string | null = null;
  @state() pendingGatewayUrl: string | null = null;

  @state() configLoading = false;
  @state() configRaw = "{\n}\n";
  @state() configRawOriginal = "";
  @state() configValid: boolean | null = null;
  @state() configIssues: unknown[] = [];
  @state() configSaving = false;
  @state() configApplying = false;
  @state() updateRunning = false;
  @state() applySessionKey = this.settings.lastActiveSessionKey;
  @state() configSnapshot: ConfigSnapshot | null = null;
  @state() configSchema: unknown = null;
  @state() configSchemaVersion: string | null = null;
  @state() configSchemaLoading = false;
  @state() configUiHints: ConfigUiHints = {};
  @state() configForm: Record<string, unknown> | null = null;
  @state() configFormOriginal: Record<string, unknown> | null = null;
  @state() configFormDirty = false;
  @state() configFormMode: "form" | "raw" = "form";
  @state() configSearchQuery = "";
  @state() configActiveSection: string | null = null;
  @state() configActiveSubsection: string | null = null;

  @state() channelsLoading = false;
  @state() channelsSnapshot: ChannelsStatusSnapshot | null = null;
  @state() channelsError: string | null = null;
  @state() channelsLastSuccess: number | null = null;
  @state() whatsappLoginMessage: string | null = null;
  @state() whatsappLoginQrDataUrl: string | null = null;
  @state() whatsappLoginConnected: boolean | null = null;
  @state() whatsappBusy = false;
  @state() nostrProfileFormState: NostrProfileFormState | null = null;
  @state() nostrProfileAccountId: string | null = null;

  @state() presenceLoading = false;
  @state() presenceEntries: PresenceEntry[] = [];
  @state() presenceError: string | null = null;
  @state() presenceStatus: string | null = null;

  @state() agentsLoading = false;
  @state() agentsList: AgentsListResult | null = null;
  @state() agentsError: string | null = null;
  @state() agentsSelectedId: string | null = null;
  @state() agentsPanel: "overview" | "files" | "tools" | "skills" | "channels" | "cron" =
    "overview";
  @state() agentFilesLoading = false;
  @state() agentFilesError: string | null = null;
  @state() agentFilesList: AgentsFilesListResult | null = null;
  @state() agentFileContents: Record<string, string> = {};
  @state() agentFileDrafts: Record<string, string> = {};
  @state() agentFileActive: string | null = null;
  @state() agentFileSaving = false;
  @state() agentIdentityLoading = false;
  @state() agentIdentityError: string | null = null;
  @state() agentIdentityById: Record<string, AgentIdentityResult> = {};
  @state() agentSkillsLoading = false;
  @state() agentSkillsError: string | null = null;
  @state() agentSkillsReport: SkillStatusReport | null = null;
  @state() agentSkillsAgentId: string | null = null;

  @state() sessionsLoading = false;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() sessionsError: string | null = null;
  @state() sessionsFilterActive = "";
  @state() sessionsFilterLimit = "120";
  @state() sessionsIncludeGlobal = true;
  @state() sessionsIncludeUnknown = false;

  @state() cronLoading = false;
  @state() cronJobs: CronJob[] = [];
  @state() cronStatus: CronStatus | null = null;
  @state() cronError: string | null = null;
  @state() cronForm: CronFormState = { ...DEFAULT_CRON_FORM };
  @state() cronRunsJobId: string | null = null;
  @state() cronRuns: CronRunLogEntry[] = [];
  @state() cronBusy = false;

  @state() swarmLoading = false;
  @state() swarmHierarchy: any = null;
  @state() swarmError: string | null = null;
  @state() swarmSnapshot: any = null;
  @state() selectedAgent: import("./controllers/swarm.ts").AgentDetail | null = null;
  @state() selectedAgentLoading = false;
  @state() drillDownAgentId: string | null = null;
  @state() drillDownInstances: import("./controllers/swarm.ts").DrillDownInstance[] = [];
  @state() drillDownInstancesLoading = false;
  @state() drillDownInstancesError: string | null = null;
  @state() drillDownSelectedInstanceId: string | null = null;
  @state() drillDownLogs: string | null = null;
  @state() drillDownLogsLoading = false;

  // Audit state
  @state() auditLoading = false;
  @state() auditError: string | null = null;
  @state() auditInstances: import("./views/audit.ts").AuditInstance[] = [];
  @state() auditEntries: import("./views/audit.ts").AuditEntry[] = [];
  @state() auditEntriesTotal = 0;
  @state() auditRawLogs: string | null = null;
  @state() auditSummary: import("./views/audit.ts").AuditSummary | null = null;
  @state() auditSelectedInstanceId: string | null = null;
  @state() auditViewMode: import("./views/audit.ts").AuditViewMode = "actions";
  @state() auditFilterAgent: string | null = null;

  @state() taskQueueLoading = false;
  @state() taskQueueSnapshot: TaskQueueSnapshot | null = null;
  @state() taskQueueError: string | null = null;
  @state() taskQueueSelectedCardId: string | null = null;
  @state() taskQueueCardDetail: TaskQueueCardDetail | null = null;
  @state() taskQueueCardDetailLoading = false;
  @state() taskQueueCardMetrics: CardMetrics | null = null;
  @state() taskQueueCardMetricsLoading = false;
  @state() costEstimates: Map<string, import("./task-queue-types.ts").CostEstimate> = new Map();
  @state() costComparisons: Map<string, import("./task-queue-types.ts").CostComparison> = new Map();
  @state() costSummary: import("./task-queue-types.ts").CostSummary | null = null;
  @state() modelRecommendations: Map<string, import("./task-queue-types.ts").ModelRecommendation> =
    new Map();
  @state() activityLoading = false;
  @state() activityData: ActivityFeedData | null = null;
  @state() activityError: string | null = null;
  @state() agentActivityStatus: "idle" | "working" = "idle";
  @state() agentActivityLastEvent: number = 0;
  @state() agentActivitySession: string | null = null;
  private activityPollTimer: number | null = null;
  @state() workStatus: WorkStatusData | null = null;
  private workStatusPollTimer: number | null = null;
  @state() permissionsData: import("./views/overview.ts").PermissionsSummary | null = null;
  @state() permissionsAudit: import("./views/overview.ts").PermissionsAuditEntry[] = [];
  @state() todayCost: number | null = null;
  @state() swarmStatusData: import("./views/overview.ts").SwarmStatusData | null = null;
  @state() notificationsData: import("./views/notifications.ts").NotificationsData | null = null;
  @state() notificationsLoading = false;
  @state() notificationsError: string | null = null;
  private notificationsPollTimer: number | null = null;
  private _badgePollTimer: number | null = null;
  @state() metricsLoading = false;
  @state() metricsData: MetricsData | null = null;
  @state() metricsError: string | null = null;
  @state() metricsDays: number | null = 14;
  @state() metricsSelectedModel: string | null = null;
  @state() metricsModelDetail: ModelDetailData | null = null;
  @state() metricsModelDetailLoading = false;
  @state() metricsSelectedDay: string | null = null;
  @state() metricsDayDetail: DayDetailData | null = null;
  @state() epochCosts: import("./views/metrics.ts").EpochCostData | null = null;
  @state() costAccuracy: import("./views/metrics.ts").CostAccuracyData | null = null;
  @state() metricsDayDetailLoading = false;
  @state() sprintsLoading = false;
  @state() sprintsData: SprintsListData | null = null;
  @state() sprintsError: string | null = null;
  @state() sprintsShowCreateForm = false;
  @state() issuesLoading = false;
  @state() issuesData: IssuesListResult | null = null;
  @state() issuesError: string | null = null;
  @state() issuesFilter: IssueStatus | "all" = "open";
  @state() issuesBusy = false;

  @state() skillsLoading = false;
  @state() skillsReport: SkillStatusReport | null = null;
  @state() skillsError: string | null = null;
  @state() skillsFilter = "";
  @state() skillEdits: Record<string, string> = {};
  @state() skillsBusyKey: string | null = null;
  @state() skillMessages: Record<string, SkillMessage> = {};

  @state() pwaInstallPrompt: Event | null = null;
  @state() pwaInstallDismissed = false;

  @state() debugLoading = false;
  @state() debugStatus: StatusSummary | null = null;
  @state() debugHealth: HealthSnapshot | null = null;
  @state() debugModels: unknown[] = [];
  @state() debugHeartbeat: unknown = null;
  @state() debugCallMethod = "";
  @state() debugCallParams = "{}";
  @state() debugCallResult: string | null = null;
  @state() debugCallError: string | null = null;

  @state() logsLoading = false;
  @state() logsError: string | null = null;
  @state() logsFile: string | null = null;
  @state() logsEntries: LogEntry[] = [];
  @state() logsFilterText = "";
  @state() logsLevelFilters: Record<LogLevel, boolean> = {
    ...DEFAULT_LOG_LEVEL_FILTERS,
  };
  @state() logsAutoFollow = true;
  @state() logsTruncated = false;
  @state() logsCursor: number | null = null;
  @state() logsLastFetchAt: number | null = null;
  @state() logsLimit = 500;
  @state() logsMaxBytes = 250_000;
  @state() logsAtBottom = true;

  client: GatewayBrowserClient | null = null;
  private chatScrollFrame: number | null = null;
  private chatScrollTimeout: number | null = null;
  private chatHasAutoScrolled = false;
  private chatUserNearBottom = true;
  @state() chatNewMessagesBelow = false;
  private nodesPollInterval: number | null = null;
  private logsPollInterval: number | null = null;
  private debugPollInterval: number | null = null;
  private logsScrollFrame: number | null = null;
  private toolStreamById = new Map<string, ToolStreamEntry>();
  private toolStreamOrder: string[] = [];
  refreshSessionsAfterChat = new Set<string>();
  basePath = "";
  private popStateHandler = () =>
    onPopStateInternal(this as unknown as Parameters<typeof onPopStateInternal>[0]);
  private themeMedia: MediaQueryList | null = null;
  private themeMediaHandler: ((event: MediaQueryListEvent) => void) | null = null;
  private topbarObserver: ResizeObserver | null = null;

  createRenderRoot() {
    return this;
  }

  private _handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.taskQueueSelectedCardId) {
      this.closeTaskQueueDetail();
    }
  };

  private _handleInstallPrompt = (e: Event) => {
    e.preventDefault();
    this.pwaInstallPrompt = e;
  };

  async installPwa() {
    const prompt = this.pwaInstallPrompt as any;
    if (!prompt?.prompt) return;
    prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === "accepted") {
      this.pwaInstallPrompt = null;
      this.pwaInstallDismissed = true;
    }
  }

  dismissPwaPrompt() {
    this.pwaInstallDismissed = true;
  }

  connectedCallback() {
    super.connectedCallback();
    handleConnected(this as unknown as Parameters<typeof handleConnected>[0]);
    document.addEventListener("keydown", this._handleKeydown);
    window.addEventListener("beforeinstallprompt", this._handleInstallPrompt);
    // Global badge poll — keeps notification count + permissions fresh across all tabs
    this._badgePollTimer = window.setInterval(() => {
      if (this.connected && this.tab !== "notifications") {
        void this.loadNotifications();
      }
      if (this.connected) {
        void this.loadPermissions();
      }
    }, 60_000);
  }

  protected firstUpdated() {
    handleFirstUpdated(this as unknown as Parameters<typeof handleFirstUpdated>[0]);
  }

  disconnectedCallback() {
    document.removeEventListener("keydown", this._handleKeydown);
    window.removeEventListener("beforeinstallprompt", this._handleInstallPrompt);
    if (this._badgePollTimer != null) {
      window.clearInterval(this._badgePollTimer);
      this._badgePollTimer = null;
    }
    handleDisconnected(this as unknown as Parameters<typeof handleDisconnected>[0]);
    super.disconnectedCallback();
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    handleUpdated(this as unknown as Parameters<typeof handleUpdated>[0], changed);
  }

  connect() {
    connectGatewayInternal(this as unknown as Parameters<typeof connectGatewayInternal>[0]);
  }

  handleChatScroll(event: Event) {
    handleChatScrollInternal(
      this as unknown as Parameters<typeof handleChatScrollInternal>[0],
      event,
    );
  }

  handleLogsScroll(event: Event) {
    handleLogsScrollInternal(
      this as unknown as Parameters<typeof handleLogsScrollInternal>[0],
      event,
    );
  }

  exportLogs(lines: string[], label: string) {
    exportLogsInternal(lines, label);
  }

  resetToolStream() {
    resetToolStreamInternal(this as unknown as Parameters<typeof resetToolStreamInternal>[0]);
  }

  resetChatScroll() {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
  }

  scrollToBottom() {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
    scheduleChatScrollInternal(
      this as unknown as Parameters<typeof scheduleChatScrollInternal>[0],
      true,
    );
  }

  async loadAssistantIdentity() {
    await loadAssistantIdentityInternal(this);
  }

  applySettings(next: UiSettings) {
    applySettingsInternal(this as unknown as Parameters<typeof applySettingsInternal>[0], next);
  }

  setTab(next: Tab) {
    setTabInternal(this as unknown as Parameters<typeof setTabInternal>[0], next);
  }

  setTheme(next: ThemeMode, context?: Parameters<typeof setThemeInternal>[2]) {
    setThemeInternal(this as unknown as Parameters<typeof setThemeInternal>[0], next, context);
  }

  async loadOverview() {
    await loadOverviewInternal(this as unknown as Parameters<typeof loadOverviewInternal>[0]);
  }

  async loadCron() {
    await loadCronInternal(this as unknown as Parameters<typeof loadCronInternal>[0]);
  }

  async loadSwarmHierarchy() {
    if (!this.client || !this.connected) return;
    this.swarmLoading = true;
    this.swarmError = null;
    try {
      const [hierarchy, snapshot] = await Promise.all([
        this.client.request("swarm.hierarchy", {}),
        this.client.request("swarm.list", {}).catch(() => null),
      ]);
      this.swarmHierarchy = hierarchy;
      this.swarmSnapshot = snapshot;
    } catch (err: any) {
      this.swarmError = err?.message ?? String(err);
    } finally {
      this.swarmLoading = false;
    }
  }

  async loadAgentDetail(agentId: string) {
    if (!this.client || !this.connected) return;
    this.selectedAgentLoading = true;
    try {
      this.selectedAgent = (await this.client.request("swarm.agentDetail", {
        agentId,
      })) as import("./controllers/swarm.ts").AgentDetail;
    } catch {
      this.selectedAgent = null;
    } finally {
      this.selectedAgentLoading = false;
    }
  }

  async openDrillDown(agentId: string) {
    if (!this.client || !this.connected) return;
    this.drillDownAgentId = agentId;
    this.drillDownInstances = [];
    this.drillDownInstancesLoading = true;
    this.drillDownInstancesError = null;
    this.drillDownSelectedInstanceId = null;
    this.drillDownLogs = null;
    try {
      const res = (await this.client.request("audit.instances", {
        agentId,
        limit: 50,
      })) as { instances: import("./controllers/swarm.ts").DrillDownInstance[]; total: number };
      this.drillDownInstances = res.instances;
    } catch (err) {
      this.drillDownInstancesError = String(err);
    } finally {
      this.drillDownInstancesLoading = false;
    }
  }

  async selectDrillDownInstance(instanceId: string) {
    if (!this.client || !this.connected) return;
    this.drillDownSelectedInstanceId = instanceId;
    this.drillDownLogs = null;
    this.drillDownLogsLoading = true;
    try {
      const res = (await this.client.request("audit.logs", {
        instanceId,
      })) as { logs: string };
      this.drillDownLogs = res.logs;
    } catch (err) {
      this.drillDownLogs = `Error loading logs: ${err}`;
    } finally {
      this.drillDownLogsLoading = false;
    }
  }

  closeDrillDown() {
    this.drillDownAgentId = null;
    this.drillDownInstances = [];
    this.drillDownInstancesLoading = false;
    this.drillDownInstancesError = null;
    this.drillDownSelectedInstanceId = null;
    this.drillDownLogs = null;
    this.drillDownLogsLoading = false;
  }

  async loadAuditData() {
    if (!this.client || !this.connected) return;
    if (this.auditLoading) return;
    this.auditLoading = true;
    this.auditError = null;
    try {
      const [instancesRes, entriesRes] = await Promise.all([
        this.client.request("audit.instances", {
          agentId: this.auditFilterAgent ?? undefined,
          limit: 100,
        }) as Promise<{ instances: import("./views/audit.ts").AuditInstance[]; total: number }>,
        this.client.request("audit.list", {
          instanceId: this.auditSelectedInstanceId ?? undefined,
          agentId: this.auditFilterAgent ?? undefined,
          limit: 100,
        }) as Promise<{ entries: import("./views/audit.ts").AuditEntry[]; total: number }>,
      ]);
      this.auditInstances = instancesRes.instances;
      this.auditEntries = entriesRes.entries;
      this.auditEntriesTotal = entriesRes.total;

      // Load mode-specific data
      if (this.auditViewMode === "logs") {
        const logsRes = (await this.client.request("audit.logs", {
          instanceId: this.auditSelectedInstanceId ?? undefined,
        })) as { logs: string };
        this.auditRawLogs = logsRes.logs;
      } else if (this.auditViewMode === "summary" && this.auditSelectedInstanceId) {
        const summaryRes = (await this.client.request("audit.summary", {
          instanceId: this.auditSelectedInstanceId,
        })) as import("./views/audit.ts").AuditSummary;
        this.auditSummary = summaryRes;
      }
    } catch (err: any) {
      this.auditError = err?.message ?? String(err);
    } finally {
      this.auditLoading = false;
    }
  }

  async loadTaskQueue() {
    await loadTaskQueueInternal(this as unknown as Parameters<typeof loadTaskQueueInternal>[0]);
    // Load cost estimates for visible cards (non-blocking)
    loadCostEstimatesInternal(
      this as unknown as Parameters<typeof loadCostEstimatesInternal>[0],
    ).catch(() => {});
    loadCostSummaryInternal(this as unknown as Parameters<typeof loadCostSummaryInternal>[0]).catch(
      () => {},
    );
  }
  async estimateCardCost(cardId: string, description: string) {
    await estimateCostInternal(
      this as unknown as Parameters<typeof estimateCostInternal>[0],
      cardId,
      description,
    );
    this.requestUpdate();
  }
  async selectTaskQueueCard(cardId: string) {
    await loadCardDetailInternal(
      this as unknown as Parameters<typeof loadCardDetailInternal>[0],
      cardId,
    );
  }
  closeTaskQueueDetail() {
    this.taskQueueSelectedCardId = null;
    this.taskQueueCardDetail = null;
    this.taskQueueCardMetrics = null;
    this.taskQueueCardMetricsLoading = false;
  }
  async moveTaskQueueCard(cardId: string, listId: string) {
    await moveCardInternal(
      this as unknown as Parameters<typeof moveCardInternal>[0],
      cardId,
      listId,
    );
    this.taskQueueSelectedCardId = null;
    this.taskQueueCardDetail = null;
    this.taskQueueCardMetrics = null;
  }
  async approveTaskQueueCard(cardId: string) {
    await approveCardInternal(this as unknown as Parameters<typeof approveCardInternal>[0], cardId);
    this.taskQueueSelectedCardId = null;
    this.taskQueueCardDetail = null;
    this.taskQueueCardMetrics = null;
  }
  async toggleTaskQueueCheckItem(cardId: string, checkItemId: string, complete: boolean) {
    await toggleCheckItemInternal(
      this as unknown as Parameters<typeof toggleCheckItemInternal>[0],
      cardId,
      checkItemId,
      complete,
    );
  }
  async addTaskQueueComment(cardId: string, text: string) {
    await addCommentInternal(
      this as unknown as Parameters<typeof addCommentInternal>[0],
      cardId,
      text,
    );
  }

  async loadActivity() {
    if (!this.client || !this.connected) return;
    this.activityLoading = true;
    try {
      const res = await this.client.request<ActivityFeedData>("activity.feed", { limit: 30 });
      this.activityData = res;
      this.activityError = null;
    } catch (err) {
      this.activityError = String(err);
    } finally {
      this.activityLoading = false;
    }
  }

  startActivityPolling() {
    this.stopActivityPolling();
    this.activityPollTimer = window.setInterval(() => {
      if (this.connected && !this.activityLoading) {
        void this.loadActivity();
      }
    }, 10000); // every 10s
  }

  stopActivityPolling() {
    if (this.activityPollTimer != null) {
      window.clearInterval(this.activityPollTimer);
      this.activityPollTimer = null;
    }
  }

  async loadWorkStatus() {
    if (!this.client || !this.connected) return;
    try {
      const res = await this.client.request<WorkStatusData>("activity.workStatus", {});
      this.workStatus = res;
    } catch {
      // Silently fail — overview still works without this
    }
  }

  startWorkStatusPolling() {
    this.stopWorkStatusPolling();
    void this.loadWorkStatus();
    this.workStatusPollTimer = window.setInterval(() => {
      if (this.connected) void this.loadWorkStatus();
    }, 15000); // every 15s
  }

  stopWorkStatusPolling() {
    if (this.workStatusPollTimer != null) {
      window.clearInterval(this.workStatusPollTimer);
      this.workStatusPollTimer = null;
    }
  }

  async loadPermissions() {
    if (!this.client || !this.connected) return;
    try {
      this.permissionsData = await this.client.request<
        import("./views/overview.ts").PermissionsSummary
      >("permissions.summary", {});
      // Load audit entries + today's cost (non-blocking)
      this.client
        .request<{ entries: import("./views/overview.ts").PermissionsAuditEntry[] }>(
          "permissions.audit",
          { limit: 10 },
        )
        .then((r) => {
          this.permissionsAudit = r.entries;
        })
        .catch(() => {});
      this.client
        .request<{ todayCost: number }>("metrics.overview", {})
        .then((r: any) => {
          if (r?.todayCost != null) this.todayCost = r.todayCost;
          else if (r?.costToday != null) this.todayCost = r.costToday;
        })
        .catch(() => {});
    } catch {
      // Not available — OK
    }
  }

  async loadSwarmStatus() {
    if (!this.client || !this.connected) return;
    try {
      this.swarmStatusData = await this.client.request<
        import("./views/overview.ts").SwarmStatusData
      >("swarm.status", {});
    } catch {
      // Not available — OK
    }
  }

  async loadNotifications() {
    if (!this.client || !this.connected) return;
    this.notificationsLoading = true;
    try {
      const res = await this.client.request<import("./views/notifications.ts").NotificationsData>(
        "notifications.list",
        {},
      );
      this.notificationsData = res;
      this.notificationsError = null;
    } catch (err) {
      this.notificationsError = String(err);
    } finally {
      this.notificationsLoading = false;
    }
  }

  startNotificationsPolling() {
    this.stopNotificationsPolling();
    void this.loadNotifications();
    this.notificationsPollTimer = window.setInterval(() => {
      if (this.connected) void this.loadNotifications();
    }, 30000);
  }

  stopNotificationsPolling() {
    if (this.notificationsPollTimer != null) {
      window.clearInterval(this.notificationsPollTimer);
      this.notificationsPollTimer = null;
    }
  }

  async setupPushNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      // Get VAPID public key
      if (!this.client || !this.connected) return;
      const { publicKey } = await this.client.request<{ publicKey: string }>(
        "push.vapidPublicKey",
        {},
      );
      if (!publicKey) return;

      // Check existing subscription
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        // Request permission and subscribe
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return;
        const urlBase64ToUint8Array = (base64String: string) => {
          const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
          const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
          const raw = atob(base64);
          const arr = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
          return arr;
        };
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      // Send subscription to server
      await this.client.request("push.subscribe", {
        subscription: {
          endpoint: sub.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!))),
            auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")!))),
          },
        },
      });

      // Listen for service worker messages (action clicks)
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "notification-action") {
          void this.handleNotificationAction(event.data.rpcMethod, event.data.rpcParams);
        } else if (event.data?.type === "navigate") {
          const cardId = event.data.cardId;
          if (cardId) {
            // Navigate to task queue and select the specific card
            this.tab = "task-queue" as never;
            void this.loadTaskQueue().then(() => {
              if (typeof this.selectTaskQueueCard === "function") {
                this.selectTaskQueueCard(cardId);
              }
            });
          } else {
            this.tab = (event.data.tab || "notifications") as never;
          }
        }
      });
    } catch (err) {
      console.log("[push] Setup failed:", err);
    }
  }

  async handleNotificationAction(action: string, params: Record<string, unknown>) {
    if (action === "navigate") {
      const cardId = params.cardId as string;
      if (cardId) {
        // Navigate to task queue and select the specific card
        this.tab = "task-queue" as never;
        void this.loadTaskQueue().then(() => {
          if (typeof this.selectTaskQueueCard === "function") {
            this.selectTaskQueueCard(cardId);
          }
        });
        return;
      }
      const tab = params.tab as string;
      if (tab) {
        const { setTab } = await import("./app-settings.ts");
        setTab(this as never, tab as never);
      }
      return;
    }
    if (action === "dismiss" && params.notificationId) {
      if (this.client && this.connected) {
        await this.client.request("notifications.dismiss", {
          notificationId: params.notificationId,
        });
        void this.loadNotifications();
      }
      return;
    }
    if (action === "dismissAll") {
      if (this.client && this.connected) {
        await this.client.request("notifications.dismissAll", {});
        void this.loadNotifications();
      }
      return;
    }
    // Execute RPC action (e.g., taskQueue.approveCard)
    if (this.client && this.connected) {
      try {
        await this.client.request(action, params);
        // Auto-dismiss the notification after action
        if (params.cardId) {
          // Dismiss all notification IDs for this card
          for (const prefix of ["proposal-", "blocked-"]) {
            await this.client
              .request("notifications.dismiss", { notificationId: `${prefix}${params.cardId}` })
              .catch(() => {});
          }
        }
        // Refresh notifications after action
        void this.loadNotifications();
        // Also refresh task queue if it was an approval
        if (action.includes("approve") || action.includes("move")) {
          void this.loadTaskQueue();
        }
      } catch (err) {
        console.error("Notification action failed:", err);
      }
    }
  }

  async loadMetrics() {
    if (!this.client || !this.connected || this.metricsLoading) return;
    this.metricsLoading = true;
    this.metricsError = null;
    try {
      const params: Record<string, unknown> = {};
      if (this.metricsDays) params.days = this.metricsDays;
      const res = await this.client.request<MetricsData>("metrics.overview", params);
      this.metricsData = res;
      // Also load epoch costs + accuracy (non-blocking)
      this.client
        .request<import("./views/metrics.ts").EpochCostData>("costs.epochs", {})
        .then((r) => {
          this.epochCosts = r;
        })
        .catch(() => {});
      this.client
        .request<import("./views/metrics.ts").CostAccuracyData>("costs.summary", {})
        .then((r) => {
          this.costAccuracy = r;
        })
        .catch(() => {});
    } catch (err) {
      this.metricsError = String(err);
    } finally {
      this.metricsLoading = false;
    }
  }

  setMetricsDays(days: number | null) {
    this.metricsDays = days;
    this.metricsSelectedModel = null;
    this.metricsModelDetail = null;
    this.metricsSelectedDay = null;
    this.metricsDayDetail = null;
    void this.loadMetrics();
  }

  async selectMetricsModel(model: string) {
    if (this.metricsSelectedModel === model) {
      this.metricsSelectedModel = null;
      this.metricsModelDetail = null;
      return;
    }
    this.metricsSelectedModel = model;
    this.metricsSelectedDay = null;
    this.metricsDayDetail = null;
    this.metricsModelDetailLoading = true;
    this.metricsModelDetail = null;
    try {
      const params: Record<string, unknown> = { model };
      if (this.metricsDays) params.days = this.metricsDays;
      const res = await this.client!.request<ModelDetailData>("metrics.modelDetail", params);
      this.metricsModelDetail = res;
    } catch (err) {
      this.metricsError = `Model detail: ${String(err)}`;
    } finally {
      this.metricsModelDetailLoading = false;
    }
  }

  async selectMetricsDay(day: string) {
    if (this.metricsSelectedDay === day) {
      this.metricsSelectedDay = null;
      this.metricsDayDetail = null;
      return;
    }
    this.metricsSelectedDay = day;
    this.metricsSelectedModel = null;
    this.metricsModelDetail = null;
    this.metricsDayDetailLoading = true;
    this.metricsDayDetail = null;
    try {
      const res = await this.client!.request<DayDetailData>("metrics.dayDetail", { day });
      this.metricsDayDetail = res;
    } catch (err) {
      this.metricsError = `Day detail: ${String(err)}`;
    } finally {
      this.metricsDayDetailLoading = false;
    }
  }

  closeMetricsDetail() {
    this.metricsSelectedModel = null;
    this.metricsModelDetail = null;
    this.metricsSelectedDay = null;
    this.metricsDayDetail = null;
  }

  async loadSprints() {
    await loadSprintsInternal(this as unknown as Parameters<typeof loadSprintsInternal>[0]);
  }
  async createSprint(name: string, goal: string, endDate: string, pullFromBoard = false) {
    await createSprintInternal(
      this as unknown as Parameters<typeof createSprintInternal>[0],
      name,
      goal,
      endDate,
      pullFromBoard,
    );
  }
  async completeSprint(sprintId: string) {
    await completeSprintInternal(
      this as unknown as Parameters<typeof completeSprintInternal>[0],
      sprintId,
    );
  }
  async cancelSprint(sprintId: string) {
    await cancelSprintInternal(
      this as unknown as Parameters<typeof cancelSprintInternal>[0],
      sprintId,
    );
  }
  async completeSprintCard(sprintId: string, cardId: string) {
    await completeSprintCardInternal(
      this as unknown as Parameters<typeof completeSprintCardInternal>[0],
      sprintId,
      cardId,
    );
  }
  toggleSprintCreateForm() {
    this.sprintsShowCreateForm = !this.sprintsShowCreateForm;
  }

  async loadIssues() {
    await loadIssuesInternal(this as unknown as Parameters<typeof loadIssuesInternal>[0]);
  }

  setIssuesFilter(filter: IssueStatus | "all") {
    this.issuesFilter = filter;
    void this.loadIssues();
  }

  async resolveIssue(id: string) {
    await resolveIssueInternal(this as unknown as Parameters<typeof resolveIssueInternal>[0], id);
  }

  async dismissIssue(id: string) {
    await dismissIssueInternal(this as unknown as Parameters<typeof dismissIssueInternal>[0], id);
  }

  async reopenIssue(id: string) {
    await reopenIssueInternal(this as unknown as Parameters<typeof reopenIssueInternal>[0], id);
  }

  async handleAbortChat() {
    await handleAbortChatInternal(this as unknown as Parameters<typeof handleAbortChatInternal>[0]);
  }

  removeQueuedMessage(id: string) {
    removeQueuedMessageInternal(
      this as unknown as Parameters<typeof removeQueuedMessageInternal>[0],
      id,
    );
  }

  async handleSendChat(
    messageOverride?: string,
    opts?: Parameters<typeof handleSendChatInternal>[2],
  ) {
    await handleSendChatInternal(
      this as unknown as Parameters<typeof handleSendChatInternal>[0],
      messageOverride,
      opts,
    );
  }

  async handleWhatsAppStart(force: boolean) {
    await handleWhatsAppStartInternal(this, force);
  }

  async handleWhatsAppWait() {
    await handleWhatsAppWaitInternal(this);
  }

  async handleWhatsAppLogout() {
    await handleWhatsAppLogoutInternal(this);
  }

  async handleChannelConfigSave() {
    await handleChannelConfigSaveInternal(this);
  }

  async handleChannelConfigReload() {
    await handleChannelConfigReloadInternal(this);
  }

  handleNostrProfileEdit(accountId: string, profile: NostrProfile | null) {
    handleNostrProfileEditInternal(this, accountId, profile);
  }

  handleNostrProfileCancel() {
    handleNostrProfileCancelInternal(this);
  }

  handleNostrProfileFieldChange(field: keyof NostrProfile, value: string) {
    handleNostrProfileFieldChangeInternal(this, field, value);
  }

  async handleNostrProfileSave() {
    await handleNostrProfileSaveInternal(this);
  }

  async handleNostrProfileImport() {
    await handleNostrProfileImportInternal(this);
  }

  handleNostrProfileToggleAdvanced() {
    handleNostrProfileToggleAdvancedInternal(this);
  }

  async handleExecApprovalDecision(decision: "allow-once" | "allow-always" | "deny") {
    const active = this.execApprovalQueue[0];
    if (!active || !this.client || this.execApprovalBusy) {
      return;
    }
    this.execApprovalBusy = true;
    this.execApprovalError = null;
    try {
      await this.client.request("exec.approval.resolve", {
        id: active.id,
        decision,
      });
      this.execApprovalQueue = this.execApprovalQueue.filter((entry) => entry.id !== active.id);
    } catch (err) {
      this.execApprovalError = `Exec approval failed: ${String(err)}`;
    } finally {
      this.execApprovalBusy = false;
    }
  }

  handleGatewayUrlConfirm() {
    const nextGatewayUrl = this.pendingGatewayUrl;
    if (!nextGatewayUrl) {
      return;
    }
    this.pendingGatewayUrl = null;
    applySettingsInternal(this as unknown as Parameters<typeof applySettingsInternal>[0], {
      ...this.settings,
      gatewayUrl: nextGatewayUrl,
    });
    this.connect();
  }

  handleGatewayUrlCancel() {
    this.pendingGatewayUrl = null;
  }

  // Sidebar handlers for tool output viewing
  handleOpenSidebar(content: string) {
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
      this.sidebarCloseTimer = null;
    }
    this.sidebarContent = content;
    this.sidebarError = null;
    this.sidebarOpen = true;
  }

  handleCloseSidebar() {
    this.sidebarOpen = false;
    // Clear content after transition
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
    }
    this.sidebarCloseTimer = window.setTimeout(() => {
      if (this.sidebarOpen) {
        return;
      }
      this.sidebarContent = null;
      this.sidebarError = null;
      this.sidebarCloseTimer = null;
    }, 200);
  }

  handleSplitRatioChange(ratio: number) {
    const newRatio = Math.max(0.4, Math.min(0.7, ratio));
    this.splitRatio = newRatio;
    this.applySettings({ ...this.settings, splitRatio: newRatio });
  }

  render() {
    return renderApp(this as unknown as AppViewState);
  }
}
