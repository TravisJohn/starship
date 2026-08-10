import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() }
}));

import { extractInitialPlan } from "./initialPlan";

let tempDir: string;
let transcriptPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-initial-plan-"));
  transcriptPath = path.join(tempDir, "session.jsonl");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const writeLines = (...records: unknown[]): void => {
  fs.writeFileSync(transcriptPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
};

describe("extractInitialPlan", () => {
  it("returns nulls when the transcript doesn't exist", () => {
    expect(extractInitialPlan(path.join(tempDir, "missing.jsonl"))).toEqual({
      markdown: null,
      capturedAt: null
    });
  });

  it("captures the first assistant text turn, ignoring the cold prompt itself", () => {
    writeLines(
      { type: "user", message: { role: "user", content: "Read PRD.md and CLAUDE.md..." } },
      {
        type: "assistant",
        timestamp: "2026-07-29T10:00:00.000Z",
        message: {
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "# Phase 1 Plan\n\nModule structure..." }]
        }
      }
    );

    expect(extractInitialPlan(transcriptPath)).toEqual({
      markdown: "# Phase 1 Plan\n\nModule structure...",
      capturedAt: "2026-07-29T10:00:00.000Z"
    });
  });

  it("stops at the first assistant turn that has text, not a later one", () => {
    writeLines(
      {
        type: "assistant",
        message: {
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "First plan." }]
        }
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Later follow-up, after approval." }]
        }
      }
    );

    expect(extractInitialPlan(transcriptPath).markdown).toBe("First plan.");
  });

  it("skips a leading tool_use-only assistant turn and keeps scanning for the first turn with text", () => {
    writeLines(
      {
        type: "assistant",
        message: {
          role: "assistant",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "PRD.md" } }]
        }
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Here's the plan now that I've read the PRD." }]
        }
      }
    );

    expect(extractInitialPlan(transcriptPath).markdown).toBe(
      "Here's the plan now that I've read the PRD."
    );
  });

  it("joins multiple text blocks in the same turn", () => {
    writeLines({
      type: "assistant",
      message: {
        role: "assistant",
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "Part one." },
          { type: "text", text: "Part two." }
        ]
      }
    });

    expect(extractInitialPlan(transcriptPath).markdown).toBe("Part one.\n\nPart two.");
  });

  it("returns nulls when no assistant turn ever produced text", () => {
    writeLines({
      type: "assistant",
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "PRD.md" } }]
      }
    });

    expect(extractInitialPlan(transcriptPath)).toEqual({ markdown: null, capturedAt: null });
  });

  it("skips malformed lines instead of throwing", () => {
    fs.writeFileSync(
      transcriptPath,
      "not json\n" +
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "Recovered plan." }] }
        })
    );

    expect(extractInitialPlan(transcriptPath).markdown).toBe("Recovered plan.");
  });
});
