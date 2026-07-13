import { ipcMain, type BrowserWindow } from "electron";
import type {
  ActivityAppendRequest,
  ActivityListRequest,
  ActivityLogEntry
} from "../shared/ipc";
import type { StarshipDb } from "./db";

export const registerActivityHandlers = (
  db: StarshipDb,
  getMainWindow: () => BrowserWindow | null
): void => {
  ipcMain.handle(
    "activity:append",
    (_event, request: ActivityAppendRequest): ActivityLogEntry => {
      const entry = db.logActivity({
        eventType: request.eventType,
        projectId: request.projectId ?? null,
        detail: request.detail
      });

      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send("activity:appended", entry);
      }

      return entry;
    }
  );

  ipcMain.handle(
    "activity:list",
    (_event, request: ActivityListRequest): ActivityLogEntry[] =>
      db.listActivity(request)
  );
};
