export type ProjectId = string;
export type PtySessionId = string;
export type AgentKind = "claude" | "codex" | "antigravity";

export type Project = {
  id: ProjectId;
  name: string;
  path: string;
  createdAt: string;
};

export type MissionProject = Project & {
  ignored: boolean;
  lastActivityAt: string | null;
  prdSummary: string | null;
  projectLogEntry: ProjectLogEntry | null;
};

export type PrdPhase = {
  title: string;
  body: string;
};

export type ProjectLogEntry = {
  date: string;
  title: string;
  body: string;
};

export type ProjectPhasesRequest = {
  projectPath: string;
};

export type MissionDashboardState = {
  rootPath: string | null;
  projects: MissionProject[];
  scanError?: string;
};

export type IntentLedger = {
  projectId: ProjectId;
  purpose: string;
  successCriteria: string;
  acceptedTradeoffs: string;
  neverDo: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionBriefing = {
  projectId: ProjectId;
  summary: string;
  createdAt: string;
  updatedAt: string;
};

export type BriefingGenerateRequest = {
  projectId: ProjectId;
  projectPath: string;
};

export type BriefingGetLatestRequest = {
  projectId: ProjectId;
};

export type FileMapGenerateRequest = {
  projectId: ProjectId;
  projectPath: string;
};

export type FileMapGenerateResponse = {
  html: string;
  fileCount: number;
  edgeCount: number;
  generatedAt: string;
};

export type FileMapDownloadRequest = {
  html: string;
  projectName: string;
};

export type FileMapDownloadResponse = {
  savedPath: string | null;
};

export type ProjectLogSummarizeRequest = {
  title: string;
  body: string;
};

export type ProjectLogSummarizeResponse = {
  summary: string;
};

export type IntentLedgerInput = {
  projectId: ProjectId;
  purpose: string;
  successCriteria: string;
  acceptedTradeoffs: string;
  neverDo: string;
};

export type IntentInterview = {
  purpose: string;
  successCriteria: string;
  acceptedTradeoffs: string;
  neverDo: string;
  learningGoal: string;
};

export type RequirementsInterview = {
  projectName: string;
  parentDirectory: string;
  oneLiner: string;
  firstVersionScope: string;
  audience: string;
  stack: string;
  constraints: string;
  outOfScope: string;
};

export type InceptionInterview = {
  intent: IntentInterview;
  requirements: RequirementsInterview;
};

export type InceptionTemplateRenderRequest = {
  interview: InceptionInterview;
};

export type InceptionTemplateRenderResponse = {
  templateDir: string;
  prd: string;
  claude: string;
  missingPlaceholders: string[];
};

export type InceptionDraftDocumentsRequest = {
  interview: InceptionInterview;
};

export type InceptionDraftDocumentsResponse = {
  templateDir: string;
  prd: string;
  claude: string;
  missingPlaceholders: string[];
  usedFallback: boolean;
  errors: string[];
};

export type InceptionCreateProjectRequest = {
  interview: InceptionInterview;
  prd: string;
  claude: string;
};

export type InceptionCreateProjectResponse = {
  project: Project;
  intentLedger: IntentLedger;
  coldPrompt: string;
};

export type IntentLedgerRequest = {
  projectId: ProjectId;
};

export type PtySpawnRequest = {
  sessionId: PtySessionId;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  /** Present when this pty is a `claude` launch against a known Starship project - lets the main process start observing it. */
  projectId?: ProjectId;
  projectName?: string;
};

export type PtySpawnResponse = {
  sessionId: PtySessionId;
};

export type PtyWriteRequest = {
  sessionId: PtySessionId;
  data: string;
};

export type PtyResizeRequest = {
  sessionId: PtySessionId;
  cols: number;
  rows: number;
};

export type PtyKillRequest = {
  sessionId: PtySessionId;
};

export type PtyDataEvent = {
  sessionId: PtySessionId;
  data: string;
};

export type PtyExitEvent = {
  sessionId: PtySessionId;
  exitCode: number | null;
  signal?: number;
};

export type DashboardSetIgnoredRequest = {
  projectPath: string;
  ignored: boolean;
};

export type DashboardLaunchRequest = {
  projectId: ProjectId;
};

export type DashboardLaunchResponse = {
  project: Project;
};

export type ActivityLogEntry = {
  id: number;
  ts: string;
  eventType: string;
  projectId: string | null;
  detail: unknown;
};

export type ActivityAppendRequest = {
  eventType: string;
  projectId?: string;
  detail?: unknown;
};

export type ActivityListRequest = {
  projectId?: string;
  limit?: number;
};

export type ObservationStatus = "no-session-detected" | "idle" | "building" | "decision-needed";

export type ObservationDecision = {
  toolName: string;
  /** Decision-altitude text naming what's pending - never "waiting for input". */
  summary: string;
};

export type KanbanTaskStatus = "pending" | "in_progress" | "completed";

export type KanbanTaskDto = {
  id: string;
  label: string;
  status: KanbanTaskStatus;
};

export type SubagentEntryDto = {
  id: string;
  description: string;
  subagentType: string | null;
  status: "running" | "finished";
};

export type ObservationSnapshot = {
  ptySessionId: PtySessionId;
  projectId: ProjectId;
  status: ObservationStatus;
  decision?: ObservationDecision;
  kanban: KanbanTaskDto[];
  subagents: SubagentEntryDto[];
};

export type RendererToMainInvokeMap = {
  "pty:spawn": {
    request: PtySpawnRequest;
    response: PtySpawnResponse;
  };
  "pty:write": {
    request: PtyWriteRequest;
    response: void;
  };
  "pty:resize": {
    request: PtyResizeRequest;
    response: void;
  };
  "pty:kill": {
    request: PtyKillRequest;
    response: void;
  };
  "dashboard:getState": {
    request: void;
    response: MissionDashboardState;
  };
  "dashboard:locateRoot": {
    request: void;
    response: MissionDashboardState | null;
  };
  "dashboard:rescan": {
    request: void;
    response: MissionDashboardState;
  };
  "dashboard:setIgnored": {
    request: DashboardSetIgnoredRequest;
    response: MissionProject;
  };
  "dashboard:launch": {
    request: DashboardLaunchRequest;
    response: DashboardLaunchResponse;
  };
  "project:getPhases": {
    request: ProjectPhasesRequest;
    response: PrdPhase[];
  };
  "briefing:generate": {
    request: BriefingGenerateRequest;
    response: SessionBriefing;
  };
  "briefing:getLatest": {
    request: BriefingGetLatestRequest;
    response: SessionBriefing | null;
  };
  "fileMap:generate": {
    request: FileMapGenerateRequest;
    response: FileMapGenerateResponse;
  };
  "fileMap:download": {
    request: FileMapDownloadRequest;
    response: FileMapDownloadResponse;
  };
  "projectLog:summarize": {
    request: ProjectLogSummarizeRequest;
    response: ProjectLogSummarizeResponse;
  };
  "activity:append": {
    request: ActivityAppendRequest;
    response: ActivityLogEntry;
  };
  "activity:list": {
    request: ActivityListRequest;
    response: ActivityLogEntry[];
  };
  "intent:getLedger": {
    request: IntentLedgerRequest;
    response: IntentLedger | null;
  };
  "intent:saveLedger": {
    request: IntentLedgerInput;
    response: IntentLedger;
  };
  "inception:renderTemplates": {
    request: InceptionTemplateRenderRequest;
    response: InceptionTemplateRenderResponse;
  };
  "inception:draftDocuments": {
    request: InceptionDraftDocumentsRequest;
    response: InceptionDraftDocumentsResponse;
  };
  "inception:createProject": {
    request: InceptionCreateProjectRequest;
    response: InceptionCreateProjectResponse;
  };
};

export type MainToRendererEventMap = {
  "pty:data": PtyDataEvent;
  "pty:exit": PtyExitEvent;
  "observation:snapshot": ObservationSnapshot;
  "activity:appended": ActivityLogEntry;
};

export type IpcInvokeChannel = keyof RendererToMainInvokeMap;
export type IpcEventChannel = keyof MainToRendererEventMap;
export type IpcInvokeRequest<TChannel extends IpcInvokeChannel> =
  RendererToMainInvokeMap[TChannel]["request"];
export type IpcInvokeResponse<TChannel extends IpcInvokeChannel> =
  RendererToMainInvokeMap[TChannel]["response"];
export type IpcEventPayload<TChannel extends IpcEventChannel> =
  MainToRendererEventMap[TChannel];

export type Unsubscribe = () => void;

export type StarshipApi = {
  pty: {
    spawn: (request: PtySpawnRequest) => Promise<PtySpawnResponse>;
    write: (request: PtyWriteRequest) => Promise<void>;
    resize: (request: PtyResizeRequest) => Promise<void>;
    kill: (request: PtyKillRequest) => Promise<void>;
    onData: (handler: (event: PtyDataEvent) => void) => Unsubscribe;
    onExit: (handler: (event: PtyExitEvent) => void) => Unsubscribe;
  };
  dashboard: {
    getState: () => Promise<MissionDashboardState>;
    locateRoot: () => Promise<MissionDashboardState | null>;
    rescan: () => Promise<MissionDashboardState>;
    setIgnored: (request: DashboardSetIgnoredRequest) => Promise<MissionProject>;
    launch: (request: DashboardLaunchRequest) => Promise<DashboardLaunchResponse>;
  };
  project: {
    getPhases: (request: ProjectPhasesRequest) => Promise<PrdPhase[]>;
  };
  briefing: {
    generate: (request: BriefingGenerateRequest) => Promise<SessionBriefing>;
    getLatest: (request: BriefingGetLatestRequest) => Promise<SessionBriefing | null>;
  };
  fileMap: {
    generate: (request: FileMapGenerateRequest) => Promise<FileMapGenerateResponse>;
    download: (request: FileMapDownloadRequest) => Promise<FileMapDownloadResponse>;
  };
  projectLog: {
    summarize: (
      request: ProjectLogSummarizeRequest
    ) => Promise<ProjectLogSummarizeResponse>;
  };
  intent: {
    getLedger: (request: IntentLedgerRequest) => Promise<IntentLedger | null>;
    saveLedger: (request: IntentLedgerInput) => Promise<IntentLedger>;
  };
  inception: {
    renderTemplates: (
      request: InceptionTemplateRenderRequest
    ) => Promise<InceptionTemplateRenderResponse>;
    draftDocuments: (
      request: InceptionDraftDocumentsRequest
    ) => Promise<InceptionDraftDocumentsResponse>;
    createProject: (
      request: InceptionCreateProjectRequest
    ) => Promise<InceptionCreateProjectResponse>;
  };
  observation: {
    onSnapshot: (handler: (snapshot: ObservationSnapshot) => void) => Unsubscribe;
  };
  activity: {
    append: (request: ActivityAppendRequest) => Promise<ActivityLogEntry>;
    list: (request: ActivityListRequest) => Promise<ActivityLogEntry[]>;
    onAppended: (handler: (entry: ActivityLogEntry) => void) => Unsubscribe;
  };
};
