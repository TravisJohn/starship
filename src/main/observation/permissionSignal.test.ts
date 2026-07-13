import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn() }
}));

import {
  resolveSignalFilePath,
  resolveSignalsDir,
  tailPermissionSignal,
  type PermissionSignal
} from "./permissionSignal";
import { slugProjectPath } from "./slug";

let signalsDir: string;

const waitFor = async (predicate: () => boolean, timeoutMs = 4000, intervalMs = 25): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

beforeEach(() => {
  signalsDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-permission-signal-"));
  process.env.STARSHIP_SIGNALS_DIR = signalsDir;
});

afterEach(() => {
  delete process.env.STARSHIP_SIGNALS_DIR;
  fs.rmSync(signalsDir, { recursive: true, force: true });
});

describe("resolveSignalsDir / resolveSignalFilePath", () => {
  it("honors the STARSHIP_SIGNALS_DIR override", () => {
    expect(resolveSignalsDir()).toBe(signalsDir);
  });

  it("keys the signal file by the same slug correlate.ts uses", () => {
    const projectPath = "D:\\WEB PROJECTS\\starship";
    expect(resolveSignalFilePath(projectPath)).toBe(
      path.join(signalsDir, `${slugProjectPath(projectPath)}.ndjson`)
    );
  });
});

describe("tailPermissionSignal", () => {
  const projectPath = "C:\\Users\\User\\Projects\\Some Project";
  const signalFile = () => path.join(signalsDir, `${slugProjectPath(projectPath)}.ndjson`);

  it("skips content already on disk from a past session, reporting only new appends", async () => {
    fs.writeFileSync(
      signalFile(),
      JSON.stringify({ toolName: "Bash", toolInput: { command: "stale from last session" } }) + "\n"
    );

    const signals: PermissionSignal[] = [];
    const unsubscribe = tailPermissionSignal(projectPath, (signal) => signals.push(signal));

    // The stale line must not be delivered - give it a moment to (not) arrive.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(signals).toHaveLength(0);

    fs.appendFileSync(
      signalFile(),
      JSON.stringify({ toolName: "Write", toolInput: { file_path: "scratch.txt" } }) + "\n"
    );
    await waitFor(() => signals.length === 1);
    expect(signals).toEqual([{ toolName: "Write", toolInput: { file_path: "scratch.txt" } }]);

    unsubscribe();
  });

  it("treats a brand-new file's first content as live, not stale, when the file didn't exist yet", async () => {
    const signals: PermissionSignal[] = [];
    const unsubscribe = tailPermissionSignal(projectPath, (signal) => signals.push(signal));
    expect(signals).toHaveLength(0);

    // Give chokidar's directory watcher a moment to become ready before the
    // file appears, mirroring tailer.test.ts's own established pattern.
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.mkdirSync(signalsDir, { recursive: true });
    fs.writeFileSync(
      signalFile(),
      JSON.stringify({ toolName: "Bash", toolInput: { command: "dir" } }) + "\n"
    );

    await waitFor(() => signals.length === 1);
    expect(signals).toEqual([{ toolName: "Bash", toolInput: { command: "dir" } }]);
    unsubscribe();
  });

  it("recreates the signals directory itself if it doesn't exist yet (this machine's first-ever hook fire)", async () => {
    fs.rmSync(signalsDir, { recursive: true, force: true });

    const signals: PermissionSignal[] = [];
    const unsubscribe = tailPermissionSignal(projectPath, (signal) => signals.push(signal));
    expect(fs.existsSync(signalsDir)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.writeFileSync(
      signalFile(),
      JSON.stringify({ toolName: "Bash", toolInput: { command: "npm test" } }) + "\n"
    );

    await waitFor(() => signals.length === 1);
    expect(signals).toEqual([{ toolName: "Bash", toolInput: { command: "npm test" } }]);
    unsubscribe();
  });

  it("skips malformed lines instead of throwing", async () => {
    const signals: PermissionSignal[] = [];
    const unsubscribe = tailPermissionSignal(projectPath, (signal) => signals.push(signal));

    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.mkdirSync(signalsDir, { recursive: true });
    fs.writeFileSync(signalFile(), "not json\n");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(signals).toHaveLength(0);

    fs.appendFileSync(
      signalFile(),
      JSON.stringify({ toolName: "Bash", toolInput: { command: "npm test" } }) + "\n"
    );
    await waitFor(() => signals.length === 1);
    expect(signals).toEqual([{ toolName: "Bash", toolInput: { command: "npm test" } }]);
    unsubscribe();
  });

  it("skips a line with no toolName", async () => {
    const signals: PermissionSignal[] = [];
    const unsubscribe = tailPermissionSignal(projectPath, (signal) => signals.push(signal));

    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.mkdirSync(signalsDir, { recursive: true });
    fs.writeFileSync(signalFile(), JSON.stringify({ toolInput: {} }) + "\n");

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(signals).toHaveLength(0);
    unsubscribe();
  });
});
