import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getAppPath: vi.fn(), getPath: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn() }
}));

import { buildFileTouchTimeline } from "./fileMap";

let tempDir: string;
let firstTranscriptPath: string;
let secondTranscriptPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-file-map-"));
  firstTranscriptPath = path.join(tempDir, "first.jsonl");
  secondTranscriptPath = path.join(tempDir, "second.jsonl");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const writeLines = (transcriptPath: string, ...records: unknown[]): void => {
  fs.writeFileSync(
    transcriptPath,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8"
  );
};

describe("buildFileTouchTimeline", () => {
  it("processes multiple transcripts in the supplied order", () => {
    writeLines(
      firstTranscriptPath,
      assistantTextAndTool("First session starts with the model.", "Write", "src/model.ts", "2026-01-01T00:00:00.000Z")
    );
    writeLines(
      secondTranscriptPath,
      assistantTextAndTool("Second session adds the view.", "Write", "src/view.ts", "2026-01-02T00:00:00.000Z")
    );

    expect(buildFileTouchTimeline([firstTranscriptPath, secondTranscriptPath])).toEqual([
      {
        filePath: "src/model.ts",
        timestamp: "2026-01-01T00:00:00.000Z",
        reasoning: "First session starts with the model."
      },
      {
        filePath: "src/view.ts",
        timestamp: "2026-01-02T00:00:00.000Z",
        reasoning: "Second session adds the view."
      }
    ]);
  });

  it("resets reasoning between transcripts", () => {
    writeLines(
      firstTranscriptPath,
      {
        type: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: {
          content: [{ type: "text", text: "Earlier session reasoning." }]
        }
      }
    );
    writeLines(
      secondTranscriptPath,
      {
        type: "assistant",
        timestamp: "2026-01-02T00:00:00.000Z",
        message: {
          content: [
            { type: "tool_use", name: "Write", input: { file_path: "src/new.ts" } }
          ]
        }
      }
    );

    expect(buildFileTouchTimeline([firstTranscriptPath, secondTranscriptPath])).toEqual([
      {
        filePath: "src/new.ts",
        timestamp: "2026-01-02T00:00:00.000Z",
        reasoning: null
      }
    ]);
  });

  it("keeps multiple touches for the same file", () => {
    writeLines(
      firstTranscriptPath,
      assistantTextAndTool("Create config.", "Write", "src/config.ts", "2026-01-01T00:00:00.000Z"),
      assistantTextAndTool("Refine config.", "Edit", "src/config.ts", "2026-01-01T00:01:00.000Z")
    );

    expect(buildFileTouchTimeline([firstTranscriptPath])).toEqual([
      {
        filePath: "src/config.ts",
        timestamp: "2026-01-01T00:00:00.000Z",
        reasoning: "Create config."
      },
      {
        filePath: "src/config.ts",
        timestamp: "2026-01-01T00:01:00.000Z",
        reasoning: "Refine config."
      }
    ]);
  });

  it("skips malformed lines without throwing", () => {
    fs.writeFileSync(
      firstTranscriptPath,
      "not json\n" +
        JSON.stringify(
          assistantTextAndTool("Still captures the valid touch.", "Write", "src/ok.ts", null)
        ),
      "utf8"
    );

    expect(buildFileTouchTimeline([firstTranscriptPath])).toEqual([
      {
        filePath: "src/ok.ts",
        timestamp: null,
        reasoning: "Still captures the valid touch."
      }
    ]);
  });

  it("captures both Edit and Write file touches", () => {
    writeLines(
      firstTranscriptPath,
      assistantTextAndTool("Write the module.", "Write", "src/module.ts", null),
      assistantTextAndTool("Edit the module.", "Edit", "src/module.ts", null)
    );

    expect(buildFileTouchTimeline([firstTranscriptPath]).map((touch) => touch.filePath)).toEqual([
      "src/module.ts",
      "src/module.ts"
    ]);
  });

  it("ignores unrelated tools", () => {
    writeLines(
      firstTranscriptPath,
      assistantTextAndTool("Run the tests.", "Bash", "npm test", null)
    );

    expect(buildFileTouchTimeline([firstTranscriptPath])).toEqual([]);
  });
});

const assistantTextAndTool = (
  text: string,
  toolName: string,
  filePath: string,
  timestamp: string | null
): unknown => ({
  type: "assistant",
  timestamp,
  message: {
    role: "assistant",
    content: [
      { type: "text", text },
      {
        type: "tool_use",
        name: toolName,
        input:
          toolName === "Bash"
            ? { command: filePath }
            : { file_path: filePath }
      }
    ]
  }
});
