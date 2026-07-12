export type ProjectId = string;
export type PtySessionId = string;

export type Project = {
  id: ProjectId;
  name: string;
  path: string;
  createdAt: string;
};

export type PtySpawnRequest = {
  sessionId: PtySessionId;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
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

export type ShelfLaunchRequest = {
  projectId: ProjectId;
};

export type ShelfLaunchResponse = {
  project: Project;
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
  "shelf:addProject": {
    request: void;
    response: Project | null;
  };
  "shelf:listProjects": {
    request: void;
    response: Project[];
  };
  "shelf:launch": {
    request: ShelfLaunchRequest;
    response: ShelfLaunchResponse;
  };
};

export type MainToRendererEventMap = {
  "pty:data": PtyDataEvent;
  "pty:exit": PtyExitEvent;
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
  shelf: {
    addProject: () => Promise<Project | null>;
    listProjects: () => Promise<Project[]>;
    launch: (request: ShelfLaunchRequest) => Promise<ShelfLaunchResponse>;
  };
};
