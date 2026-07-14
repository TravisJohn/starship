import { app, BrowserWindow } from "electron";

import path from "node:path";
import { registerActivityHandlers } from "./activity";
import { registerBrandAssetHandlers, startBrandAssetServer, type BrandAssetServer } from "./brandAssets";
import { registerBriefingHandlers } from "./briefing";
import { registerDashboardHandlers } from "./dashboard";
import { createStarshipDb, registerIntentHandlers, registerNotesHandlers, type StarshipDb } from "./db";
import { registerFileMapHandlers } from "./fileMap";
import { registerInceptionHandlers } from "./inception";
import { registerIntentAnnotationHandlers } from "./intentAnnotation";
import { registerIntentDiscussHandlers } from "./intentDiscuss";
import { ObservationManager } from "./observation/observationManager";
import { registerProjectLogBriefingHandlers } from "./projectLogBriefing";
import { PtyManager } from "./pty/ptyManager";

let mainWindow: BrowserWindow | null = null;
let db: StarshipDb | null = null;
let brandAssets: BrandAssetServer | null = null;
const ptyManager = new PtyManager();
const observationManager = new ObservationManager();

ptyManager.onSpawn((info) => {
  if (!info.projectId || !info.projectName || info.command.toLowerCase() !== "claude") {
    return;
  }
  if (!mainWindow || mainWindow.webContents.isDestroyed()) {
    return;
  }

  const webContents = mainWindow.webContents;
  observationManager.startObserving(
    {
      ptySessionId: info.sessionId,
      projectId: info.projectId,
      projectName: info.projectName,
      projectPath: info.cwd,
      spawnTimeMs: info.spawnTimeMs
    },
    (snapshot) => {
      if (!webContents.isDestroyed()) {
        webContents.send("observation:snapshot", snapshot);
      }
    }
  );
});

ptyManager.onExit((sessionId) => {
  observationManager.stopObserving(sessionId);
});

const createMainWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Starship",
    backgroundColor: "#000000",
    icon: path.join(app.getAppPath(), "brand", "starship.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
};

app.whenReady().then(async () => {
  brandAssets = await startBrandAssetServer();
  db = createStarshipDb();
  registerBrandAssetHandlers(brandAssets);
  registerActivityHandlers(db, () => mainWindow);
  registerBriefingHandlers(db);
  registerDashboardHandlers(db);
  registerFileMapHandlers(db);
  registerIntentHandlers(db);
  registerIntentAnnotationHandlers(db);
  registerIntentDiscussHandlers(db);
  registerNotesHandlers(db);
  registerInceptionHandlers(db);
  registerProjectLogBriefingHandlers(db);
  ptyManager.registerIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  ptyManager.killAll();
  observationManager.stopAll();
  brandAssets?.close();
  db?.close();
});
