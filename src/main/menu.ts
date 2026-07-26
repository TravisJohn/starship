import { ipcMain, Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import type { ActiveSessionPanel, MenuAction, MenuSessionState } from "../shared/ipc";

const PANEL_LABELS: Record<ActiveSessionPanel, string> = {
  terminal: "Terminal",
  fileMap: "File Map",
  intent: "Intent",
  timeline: "Timeline",
  decisionMap: "Decision Map"
};

/**
 * Native File/Edit/View/Window app menu, replacing the floating panel-toggle
 * and exit buttons that used to sit in the Build Room header. The renderer
 * is the source of truth for session state (whether a session is active,
 * which panel is showing) - it pushes that here via setSessionState any time
 * it changes, and this module rebuilds the menu template around it. Clicks
 * flow back the same way every other main->renderer push does: a
 * "menu:action" event the renderer already listens for.
 */
export const registerAppMenu = (
  getMainWindow: () => BrowserWindow | null
): { setSessionState: (state: MenuSessionState) => void } => {
  let sessionState: MenuSessionState = {
    active: false,
    projectName: null,
    panel: "terminal"
  };

  const sendAction = (action: MenuAction): void => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("menu:action", action);
    }
  };

  const buildTemplate = (): MenuItemConstructorOptions[] => {
    const sessionEnabled = sessionState.active;

    const panelItems: MenuItemConstructorOptions[] = (
      Object.keys(PANEL_LABELS) as ActiveSessionPanel[]
    ).map((panel) => ({
      label: PANEL_LABELS[panel],
      type: "radio",
      checked: sessionEnabled && sessionState.panel === panel,
      enabled: sessionEnabled,
      click: () => sendAction({ type: "setPanel", panel })
    }));

    return [
      {
        label: "File",
        submenu: [
          {
            label: "Back to Dashboard",
            enabled: sessionEnabled,
            click: () => sendAction({ type: "backToDashboard" })
          },
          {
            label: "Close Session",
            enabled: sessionEnabled,
            click: () => sendAction({ type: "closeSession" })
          },
          {
            label: "Exit && Summarize",
            enabled: sessionEnabled,
            click: () => sendAction({ type: "exitAndSummarize" })
          },
          { type: "separator" },
          { label: "Quit", role: "quit" }
        ]
      },
      {
        label: "View",
        submenu: [
          ...panelItems,
          { type: "separator" },
          { label: "Reload", role: "reload" }
        ]
      },
      {
        label: "Window",
        submenu: [
          { label: "Minimize", role: "minimize" },
          { label: "Close", role: "close" }
        ]
      }
    ];
  };

  const rebuildMenu = (): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()));
  };

  rebuildMenu();

  ipcMain.handle("menu:setSessionState", (_event, request: MenuSessionState) => {
    sessionState = request;
    rebuildMenu();
  });

  return {
    setSessionState: (state: MenuSessionState) => {
      sessionState = state;
      rebuildMenu();
    }
  };
};
