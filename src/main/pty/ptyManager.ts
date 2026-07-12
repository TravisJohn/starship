import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import os from "node:os";
import * as pty from "node-pty";
import type {
  PtyKillRequest,
  PtyResizeRequest,
  PtySpawnRequest,
  PtySpawnResponse,
  PtyWriteRequest
} from "../../shared/ipc";

type PtySession = {
  terminal: pty.IPty;
  owner: WebContents;
};

export class PtyManager {
  private readonly sessions = new Map<string, PtySession>();

  registerIpcHandlers(): void {
    ipcMain.handle("pty:spawn", (event, request: PtySpawnRequest) =>
      this.spawn(event, request)
    );
    ipcMain.handle("pty:write", (_event, request: PtyWriteRequest) => {
      this.write(request);
    });
    ipcMain.handle("pty:resize", (_event, request: PtyResizeRequest) => {
      this.resize(request);
    });
    ipcMain.handle("pty:kill", (_event, request: PtyKillRequest) => {
      this.kill(request.sessionId);
    });
  }

  killAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.kill(sessionId);
    }
  }

  private spawn(
    event: IpcMainInvokeEvent,
    request: PtySpawnRequest
  ): PtySpawnResponse {
    if (this.sessions.has(request.sessionId)) {
      throw new Error(`PTY session already exists: ${request.sessionId}`);
    }

    const terminal = pty.spawn(request.command, request.args, {
      name: "xterm-256color",
      cols: Math.max(2, request.cols),
      rows: Math.max(1, request.rows),
      cwd: request.cwd.trim() === "" ? process.cwd() : request.cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor"
      },
      useConpty: os.platform() === "win32"
    });

    const session: PtySession = {
      terminal,
      owner: event.sender
    };
    this.sessions.set(request.sessionId, session);

    terminal.onData((data) => {
      if (!session.owner.isDestroyed()) {
        session.owner.send("pty:data", {
          sessionId: request.sessionId,
          data
        });
      }
    });

    terminal.onExit(({ exitCode, signal }) => {
      this.sessions.delete(request.sessionId);
      if (!session.owner.isDestroyed()) {
        session.owner.send("pty:exit", {
          sessionId: request.sessionId,
          exitCode,
          signal
        });
      }
    });

    return {
      sessionId: request.sessionId
    };
  }

  private write(request: PtyWriteRequest): void {
    this.sessions.get(request.sessionId)?.terminal.write(request.data);
  }

  private resize(request: PtyResizeRequest): void {
    const cols = Math.max(2, request.cols);
    const rows = Math.max(1, request.rows);
    this.sessions.get(request.sessionId)?.terminal.resize(cols, rows);
  }

  private kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    this.sessions.delete(sessionId);
    session.terminal.kill();
  }
}
