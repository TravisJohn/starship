import { clipboard, ipcMain } from "electron";

/**
 * Thin IPC wrapper around Electron's clipboard module - the renderer has
 * contextIsolation/nodeIntegration off (see index.ts), so it can't reach
 * this directly, and the web Clipboard API's readText() would need a
 * permission prompt Starship never sets up. Used by Terminal.tsx to give
 * the pty copy/paste, since xterm.js doesn't wire that up itself.
 */
export const registerClipboardHandlers = (): void => {
  ipcMain.handle("clipboard:readText", () => clipboard.readText());

  ipcMain.handle("clipboard:writeText", (_event, text: string) => {
    clipboard.writeText(text);
  });
};
