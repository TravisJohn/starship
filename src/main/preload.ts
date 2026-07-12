import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
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
  shelf: {
    addProject: () => ipcRenderer.invoke("shelf:addProject"),
    listProjects: () => ipcRenderer.invoke("shelf:listProjects"),
    launch: (request) => ipcRenderer.invoke("shelf:launch", request)
  }
};

contextBridge.exposeInMainWorld("starship", api);
