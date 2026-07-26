import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { showSaveDialog, ipcHandlers } = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>()
}));

vi.mock("electron", () => ({
  app: { getAppPath: vi.fn(), getPath: vi.fn() },
  dialog: { showSaveDialog },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    }
  }
}));

vi.mock("./dashboard", () => ({
  findNewestTranscript: vi.fn()
}));

import { findNewestTranscript } from "./dashboard";
import { registerDecisionsExportHandlers } from "./decisionsExport";

let tempDir: string;
let transcriptPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-decisions-export-"));
  transcriptPath = path.join(tempDir, "session.jsonl");
  showSaveDialog.mockReset();
  vi.mocked(findNewestTranscript).mockReset();
  ipcHandlers.clear();
  registerDecisionsExportHandlers();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const writeLines = (...records: unknown[]): void => {
  fs.writeFileSync(
    transcriptPath,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8"
  );
};

const exportDecisions = (
  request: { projectId: string; projectPath: string; projectName: string }
) => {
  const handler = ipcHandlers.get("decisions:export");
  if (!handler) {
    throw new Error("decisions:export handler was not registered");
  }
  return handler(null, request) as Promise<{ savedPath: string | null; count: number }>;
};

describe("decisions:export", () => {
  it("returns null and skips writing when the save dialog is canceled", async () => {
    vi.mocked(findNewestTranscript).mockReturnValue({ path: transcriptPath, mtimeMs: 0 });
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    writeLines({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Starting the task." },
          { type: "tool_use", id: "t1", name: "TaskCreate", input: { subject: "Do the thing" } }
        ]
      }
    });

    const response = await exportDecisions({
      projectId: "project-a",
      projectPath: tempDir,
      projectName: "Starship"
    });

    expect(response).toEqual({ savedPath: null, count: 0 });
  });

  it("writes one JSONL line per captured task, verbatim - no reinterpretation", async () => {
    vi.mocked(findNewestTranscript).mockReturnValue({ path: transcriptPath, mtimeMs: 0 });
    const outPath = path.join(tempDir, "out.jsonl");
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: outPath });
    writeLines({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "This needs its own module." },
          { type: "tool_use", id: "t1", name: "TaskCreate", input: { subject: "Add clipboard bridge" } }
        ]
      }
    });

    const response = await exportDecisions({
      projectId: "project-a",
      projectPath: tempDir,
      projectName: "Starship"
    });

    expect(response).toEqual({ savedPath: outPath, count: 1 });
    const written = fs.readFileSync(outPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(written).toEqual([
      { task: "Add clipboard bridge", reasoning: "This needs its own module." }
    ]);
  });

  it("writes an empty file when there is no transcript yet", async () => {
    vi.mocked(findNewestTranscript).mockReturnValue(null);
    const outPath = path.join(tempDir, "out.jsonl");
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: outPath });

    const response = await exportDecisions({
      projectId: "project-a",
      projectPath: tempDir,
      projectName: "Starship"
    });

    expect(response).toEqual({ savedPath: outPath, count: 0 });
    expect(fs.readFileSync(outPath, "utf8")).toBe("");
  });
});
