import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("starship", {
  ready: true
});
