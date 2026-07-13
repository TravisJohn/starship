import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getAppPath: vi.fn(), getPath: vi.fn() },
  ipcMain: { handle: vi.fn() }
}));

import { buildSessionNarrative } from "./briefing";

let tempDir: string;
let transcriptPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-briefing-"));
  transcriptPath = path.join(tempDir, "session.jsonl");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const writeLines = (...records: unknown[]): void => {
  fs.writeFileSync(transcriptPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
};

describe("buildSessionNarrative", () => {
  it("returns an empty string when the transcript doesn't exist", () => {
    expect(buildSessionNarrative(path.join(tempDir, "missing.jsonl"))).toBe("");
  });

  it("captures the builder's prompt, Claude's text responses, and tool use, in order", () => {
    writeLines(
      {
        type: "user",
        message: { role: "user", content: "Build a tic-tac-toe board." }
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "I'll start with the game logic module." },
            { type: "tool_use", id: "t1", name: "Write", input: { file_path: "src/game.ts" } }
          ]
        }
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Game logic is in place with tests passing." }]
        }
      }
    );

    const narrative = buildSessionNarrative(transcriptPath);
    expect(narrative).toBe(
      [
        "Builder: Build a tic-tac-toe board.",
        "Claude: I'll start with the game logic module.",
        "Claude used Write (src/game.ts)",
        "Claude: Game logic is in place with tests passing."
      ].join("\n")
    );
  });

  it("extracts the builder's prompt when message.content is an array of text blocks", () => {
    writeLines({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "Now add a reset button." }] }
    });

    expect(buildSessionNarrative(transcriptPath)).toBe("Builder: Now add a reset button.");
  });

  it("ignores tool_result blocks on user records - those aren't the builder's own words", () => {
    writeLines({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }]
      }
    });

    expect(buildSessionNarrative(transcriptPath)).toBe("");
  });

  it("describes a Bash tool call by its command, truncated if long", () => {
    writeLines({
      type: "assistant",
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }]
      }
    });

    expect(buildSessionNarrative(transcriptPath)).toBe("Claude used Bash (npm test)");
  });

  it("skips malformed lines instead of throwing", () => {
    fs.writeFileSync(transcriptPath, "not json\n" + JSON.stringify({ type: "user", message: { content: "hi" } }));

    expect(buildSessionNarrative(transcriptPath)).toBe("Builder: hi");
  });

  it("bounds the narrative to the most recent content when the session is very long", () => {
    const longLines = Array.from({ length: 2000 }, (_, i) => ({
      type: "user",
      message: { content: `message number ${i}` }
    }));
    fs.writeFileSync(transcriptPath, longLines.map((r) => JSON.stringify(r)).join("\n"));

    const narrative = buildSessionNarrative(transcriptPath);
    expect(narrative.length).toBeLessThanOrEqual(12000);
    expect(narrative).toContain("message number 1999");
    expect(narrative).not.toContain("message number 0\n");
  });
});
