import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  ActivityLogEntry,
  MenuAction,
  ObservationSnapshot,
  PtyDataEvent,
  PtyExitEvent,
  StarshipApi
} from "../shared/ipc";

const api: StarshipApi = {
  pty: {
    spawn: (request) => ipcRenderer.invoke("pty:spawn", request),
    write: (request) => ipcRenderer.invoke("pty:write", request),
    resize: (request) => ipcRenderer.invoke("pty:resize", request),
    kill: (request) => ipcRenderer.invoke("pty:kill", request),
    onData: (handler) => {
      const listener = (_event: IpcRendererEvent, payload: PtyDataEvent): void => {
        handler(payload);
      };
      ipcRenderer.on("pty:data", listener);
      return () => {
        ipcRenderer.off("pty:data", listener);
      };
    },
    onExit: (handler) => {
      const listener = (_event: IpcRendererEvent, payload: PtyExitEvent): void => {
        handler(payload);
      };
      ipcRenderer.on("pty:exit", listener);
      return () => {
        ipcRenderer.off("pty:exit", listener);
      };
    }
  },
  dashboard: {
    getState: () => ipcRenderer.invoke("dashboard:getState"),
    locateRoot: () => ipcRenderer.invoke("dashboard:locateRoot"),
    rescan: () => ipcRenderer.invoke("dashboard:rescan"),
    setIgnored: (request) => ipcRenderer.invoke("dashboard:setIgnored", request),
    refreshProject: (request) => ipcRenderer.invoke("dashboard:refreshProject", request),
    launch: (request) => ipcRenderer.invoke("dashboard:launch", request)
  },
  assets: {
    getLoadingMedia: () => ipcRenderer.invoke("assets:getLoadingMedia")
  },
  project: {
    getPhases: (request) => ipcRenderer.invoke("project:getPhases", request),
    getInitialPlan: (request) => ipcRenderer.invoke("project:getInitialPlan", request)
  },
  briefing: {
    generate: (request) => ipcRenderer.invoke("briefing:generate", request),
    getLatest: (request) => ipcRenderer.invoke("briefing:getLatest", request),
    listHistory: (request) => ipcRenderer.invoke("briefing:listHistory", request)
  },
  fileMap: {
    generate: (request) => ipcRenderer.invoke("fileMap:generate", request),
    download: (request) => ipcRenderer.invoke("fileMap:download", request)
  },
  gitTree: {
    generate: (request) => ipcRenderer.invoke("gitTree:generate", request),
    download: (request) => ipcRenderer.invoke("gitTree:download", request)
  },
  decisionMap: {
    generate: (request) => ipcRenderer.invoke("decisionMap:generate", request),
    download: (request) => ipcRenderer.invoke("decisionMap:download", request)
  },
  narrativeJourney: {
    generate: (request) => ipcRenderer.invoke("narrativeJourney:generate", request),
    download: (request) => ipcRenderer.invoke("narrativeJourney:download", request)
  },
  projectLog: {
    summarize: (request) => ipcRenderer.invoke("projectLog:summarize", request)
  },
  intent: {
    getLedger: (request) => ipcRenderer.invoke("intent:getLedger", request),
    saveLedger: (request) => ipcRenderer.invoke("intent:saveLedger", request),
    annotate: (request) => ipcRenderer.invoke("intent:annotate", request)
  },
  notes: {
    list: (request) => ipcRenderer.invoke("notes:list", request),
    add: (request) => ipcRenderer.invoke("notes:add", request),
    update: (request) => ipcRenderer.invoke("notes:update", request),
    setStatus: (request) => ipcRenderer.invoke("notes:setStatus", request),
    delete: (request) => ipcRenderer.invoke("notes:delete", request)
  },
  inception: {
    renderTemplates: (request) =>
      ipcRenderer.invoke("inception:renderTemplates", request),
    draftDocuments: (request) =>
      ipcRenderer.invoke("inception:draftDocuments", request),
    createProject: (request) =>
      ipcRenderer.invoke("inception:createProject", request),
    discuss: (request) => ipcRenderer.invoke("inception:discuss", request)
  },
  observation: {
    onSnapshot: (handler) => {
      const listener = (_event: IpcRendererEvent, payload: ObservationSnapshot): void => {
        handler(payload);
      };
      ipcRenderer.on("observation:snapshot", listener);
      return () => {
        ipcRenderer.off("observation:snapshot", listener);
      };
    }
  },
  activity: {
    append: (request) => ipcRenderer.invoke("activity:append", request),
    list: (request) => ipcRenderer.invoke("activity:list", request),
    onAppended: (handler) => {
      const listener = (_event: IpcRendererEvent, payload: ActivityLogEntry): void => {
        handler(payload);
      };
      ipcRenderer.on("activity:appended", listener);
      return () => {
        ipcRenderer.off("activity:appended", listener);
      };
    }
  },
  clipboard: {
    readText: () => ipcRenderer.invoke("clipboard:readText"),
    writeText: (text) => ipcRenderer.invoke("clipboard:writeText", text)
  },
  decisions: {
    export: (request) => ipcRenderer.invoke("decisions:export", request)
  },
  menu: {
    setSessionState: (request) => ipcRenderer.invoke("menu:setSessionState", request),
    onAction: (handler) => {
      const listener = (_event: IpcRendererEvent, payload: MenuAction): void => {
        handler(payload);
      };
      ipcRenderer.on("menu:action", listener);
      return () => {
        ipcRenderer.off("menu:action", listener);
      };
    }
  }
};

contextBridge.exposeInMainWorld("starship", api);
