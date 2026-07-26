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
  sizeBytes: number | null;
  activityHeatmap: { date: string; count: number }[];
  noteStatusCounts: NoteStatusCounts;
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

/**
 * Lifecycle stage of a note's underlying work, in progression order:
 * captured but untouched -> code written -> tests written/passing ->
 * confirmed working in the real app. Mirrors the SDLC stages a change
 * normally passes through rather than a flat done/not-done toggle.
 */
export type NoteStatus = "fresh" | "implemented" | "tested" | "verified";

export const NOTE_STATUS_ORDER: NoteStatus[] = [
  "fresh",
  "implemented",
  "tested",
  "verified"
];

export type NoteStatusCounts = Record<NoteStatus, number>;

export type Note = {
  id: string;
  projectId: ProjectId;
  text: string;
  content: string;
  status: NoteStatus;
  createdAt: string;
  updatedAt: string;
};

export type NotesListRequest = {
  projectId: ProjectId;
};

export type NoteAddRequest = {
  projectId: ProjectId;
  text: string;
  content: string;
};

export type NoteUpdateRequest = {
  noteId: string;
  text: string;
  content: string;
};

export type NoteSetStatusRequest = {
  noteId: string;
  status: NoteStatus;
};

export type NoteDeleteRequest = {
  noteId: string;
};

export type BriefingGenerateRequest = {
  projectId: ProjectId;
  projectPath: string;
};

export type BriefingGetLatestRequest = {
  projectId: ProjectId;
};

/**
 * One entry per past "Exit & Summarize" - the Timeline pane's raw material.
 * Distinct from SessionBriefing (which is just the latest, used for the
 * "since last time" banner): this is append-only history, never overwritten.
 */
export type SessionBriefingHistoryEntry = {
  id: number;
  projectId: ProjectId;
  summary: string;
  createdAt: string;
};

export type BriefingListHistoryRequest = {
  projectId: ProjectId;
};

/**
 * Per-task rationale, exported verbatim (no synthesis/annotation) as a
 * `.jsonl` file for Travis to feed to a separate, smaller model later - a
 * raw decision trace, not a decision-altitude UI surface. Reuses the same
 * TaskCreate-preceding-reasoning capture the Intent annotation pass already
 * builds (intentAnnotation.ts's buildTaskReasoningTimeline).
 */
export type DecisionsExportRequest = {
  projectId: ProjectId;
  projectPath: string;
  projectName: string;
};

export type DecisionsExportResponse = {
  savedPath: string | null;
  count: number;
};

export type FileMapGenerateRequest = {
  projectId: ProjectId;
  projectPath: string;
};

export type FileTreeNode = {
  name: string;
  path: string;
  type: "directory" | "file";
  children?: FileTreeNode[];
  functions?: string[] | null;
};

export type FileMapGenerateResponse = {
  html: string;
  fileCount: number;
  edgeCount: number;
  generatedAt: string;
  tree: FileTreeNode | null;
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

export type LoadingMediaResponse = {
  animationUrl: string;
  posterUrl: string;
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

export type IntentAnnotationRequest = {
  projectId: ProjectId;
  projectPath: string;
  tasks: KanbanTaskDto[];
};

export type TaskAnnotation = {
  taskId: string;
  rationale: string | null;
  servesIntent: "purpose" | "successCriteria" | "acceptedTradeoffs" | "neverDo" | "none";
  note: string;
};

export type IntentAnnotationResult = {
  perTask: TaskAnnotation[];
  overall: { verdict: string; concerns: string };
  generatedAt: string;
};

/**
 * A cumulative, whole-project-history decision graph - every TaskCreate
 * across every session this project has ever had, plus the logical (not
 * just chronological) relationships between them. The graph-shaped sibling
 * of the Timeline's prose narrative and Decisions Export's raw JSONL.
 */
export type DecisionMapNode = {
  id: string;
  label: string;
  servesIntent: TaskAnnotation["servesIntent"];
  sessionIndex: number;
};

export type DecisionMapEdge = {
  from: string;
  to: string;
  reason: string;
};

export type DecisionMapResult = {
  nodes: DecisionMapNode[];
  edges: DecisionMapEdge[];
  generatedAt: string;
};

export type DecisionMapGenerateRequest = {
  projectId: ProjectId;
  projectPath: string;
};

export type DecisionMapGenerateResponse = {
  html: string;
  nodeCount: number;
  edgeCount: number;
  generatedAt: string;
};

export type DecisionMapDownloadRequest = {
  html: string;
  projectName: string;
};

export type DecisionMapDownloadResponse = {
  savedPath: string | null;
};

/**
 * The project's whole history, told as one story rather than a per-session
 * list (that's the Timeline) or a graph (that's the Decision Map). Built
 * from the same briefing_history rows Timeline already reads, woven
 * together in one headless pass.
 */
export type NarrativeJourneyChapter = {
  title: string;
  narrative: string;
};

export type NarrativeJourneyResult = {
  chapters: NarrativeJourneyChapter[];
  generatedAt: string;
};

export type NarrativeJourneyGenerateRequest = {
  projectId: ProjectId;
  projectPath: string;
};

export type NarrativeJourneyGenerateResponse = {
  chapters: NarrativeJourneyChapter[];
  markdown: string;
  generatedAt: string;
};

export type NarrativeJourneyDownloadRequest = {
  markdown: string;
  projectName: string;
};

export type NarrativeJourneyDownloadResponse = {
  savedPath: string | null;
};

export type DiscussMessage = {
  role: "user" | "assistant";
  text: string;
};

export type DiscussFieldRequest = {
  field: string;
  fieldLabel: string;
  currentValue: string;
  history: DiscussMessage[];
  message: string;
  intentContext?: IntentInterview;
};

export type DiscussFieldResponse = {
  reply: string;
  proposedRewrite: string | null;
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

export type ActiveSessionPanel = "terminal" | "fileMap" | "intent" | "timeline" | "decisionMap";

export type MenuSessionState = {
  active: boolean;
  projectName: string | null;
  panel: ActiveSessionPanel;
};

export type MenuAction =
  | { type: "setPanel"; panel: ActiveSessionPanel }
  | { type: "backToDashboard" }
  | { type: "closeSession" }
  | { type: "exitAndSummarize" };

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
  "dashboard:refreshProject": {
    request: { projectId: ProjectId };
    response: MissionProject;
  };
  "dashboard:launch": {
    request: DashboardLaunchRequest;
    response: DashboardLaunchResponse;
  };
  "assets:getLoadingMedia": {
    request: void;
    response: LoadingMediaResponse;
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
  "briefing:listHistory": {
    request: BriefingListHistoryRequest;
    response: SessionBriefingHistoryEntry[];
  };
  "fileMap:generate": {
    request: FileMapGenerateRequest;
    response: FileMapGenerateResponse;
  };
  "fileMap:download": {
    request: FileMapDownloadRequest;
    response: FileMapDownloadResponse;
  };
  "decisionMap:generate": {
    request: DecisionMapGenerateRequest;
    response: DecisionMapGenerateResponse;
  };
  "decisionMap:download": {
    request: DecisionMapDownloadRequest;
    response: DecisionMapDownloadResponse;
  };
  "narrativeJourney:generate": {
    request: NarrativeJourneyGenerateRequest;
    response: NarrativeJourneyGenerateResponse;
  };
  "narrativeJourney:download": {
    request: NarrativeJourneyDownloadRequest;
    response: NarrativeJourneyDownloadResponse;
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
  "intent:annotate": {
    request: IntentAnnotationRequest;
    response: IntentAnnotationResult;
  };
  "notes:list": {
    request: NotesListRequest;
    response: Note[];
  };
  "notes:add": {
    request: NoteAddRequest;
    response: Note;
  };
  "notes:update": {
    request: NoteUpdateRequest;
    response: Note;
  };
  "notes:setStatus": {
    request: NoteSetStatusRequest;
    response: Note;
  };
  "notes:delete": {
    request: NoteDeleteRequest;
    response: void;
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
  "inception:discuss": {
    request: DiscussFieldRequest;
    response: DiscussFieldResponse;
  };
  "clipboard:readText": {
    request: void;
    response: string;
  };
  "clipboard:writeText": {
    request: string;
    response: void;
  };
  "decisions:export": {
    request: DecisionsExportRequest;
    response: DecisionsExportResponse;
  };
  "menu:setSessionState": {
    request: MenuSessionState;
    response: void;
  };
};

export type MainToRendererEventMap = {
  "pty:data": PtyDataEvent;
  "pty:exit": PtyExitEvent;
  "observation:snapshot": ObservationSnapshot;
  "activity:appended": ActivityLogEntry;
  "menu:action": MenuAction;
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
    refreshProject: (request: { projectId: ProjectId }) => Promise<MissionProject>;
    launch: (request: DashboardLaunchRequest) => Promise<DashboardLaunchResponse>;
  };
  assets: {
    getLoadingMedia: () => Promise<LoadingMediaResponse>;
  };
  project: {
    getPhases: (request: ProjectPhasesRequest) => Promise<PrdPhase[]>;
  };
  briefing: {
    generate: (request: BriefingGenerateRequest) => Promise<SessionBriefing>;
    getLatest: (request: BriefingGetLatestRequest) => Promise<SessionBriefing | null>;
    listHistory: (request: BriefingListHistoryRequest) => Promise<SessionBriefingHistoryEntry[]>;
  };
  fileMap: {
    generate: (request: FileMapGenerateRequest) => Promise<FileMapGenerateResponse>;
    download: (request: FileMapDownloadRequest) => Promise<FileMapDownloadResponse>;
  };
  decisionMap: {
    generate: (request: DecisionMapGenerateRequest) => Promise<DecisionMapGenerateResponse>;
    download: (request: DecisionMapDownloadRequest) => Promise<DecisionMapDownloadResponse>;
  };
  narrativeJourney: {
    generate: (request: NarrativeJourneyGenerateRequest) => Promise<NarrativeJourneyGenerateResponse>;
    download: (request: NarrativeJourneyDownloadRequest) => Promise<NarrativeJourneyDownloadResponse>;
  };
  projectLog: {
    summarize: (
      request: ProjectLogSummarizeRequest
    ) => Promise<ProjectLogSummarizeResponse>;
  };
  intent: {
    getLedger: (request: IntentLedgerRequest) => Promise<IntentLedger | null>;
    saveLedger: (request: IntentLedgerInput) => Promise<IntentLedger>;
    annotate: (request: IntentAnnotationRequest) => Promise<IntentAnnotationResult>;
  };
  notes: {
    list: (request: NotesListRequest) => Promise<Note[]>;
    add: (request: NoteAddRequest) => Promise<Note>;
    update: (request: NoteUpdateRequest) => Promise<Note>;
    setStatus: (request: NoteSetStatusRequest) => Promise<Note>;
    delete: (request: NoteDeleteRequest) => Promise<void>;
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
    discuss: (request: DiscussFieldRequest) => Promise<DiscussFieldResponse>;
  };
  observation: {
    onSnapshot: (handler: (snapshot: ObservationSnapshot) => void) => Unsubscribe;
  };
  activity: {
    append: (request: ActivityAppendRequest) => Promise<ActivityLogEntry>;
    list: (request: ActivityListRequest) => Promise<ActivityLogEntry[]>;
    onAppended: (handler: (entry: ActivityLogEntry) => void) => Unsubscribe;
  };
  clipboard: {
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<void>;
  };
  decisions: {
    export: (request: DecisionsExportRequest) => Promise<DecisionsExportResponse>;
  };
  menu: {
    setSessionState: (request: MenuSessionState) => Promise<void>;
    onAction: (handler: (action: MenuAction) => void) => Unsubscribe;
  };
};
