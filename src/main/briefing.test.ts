import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getAppPath: vi.fn(), getPath: vi.fn() },
  ipcMain: { handle: vi.fn() }
}));

import { buildSessionNarrative, extractContinuity, extractSummary, writeContinuity } from "./briefing";
import type { ContinuityContext, ContinuitySections } from "./continuity";
import type { StarshipDb } from "./db";

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

describe("extractContinuity", () => {
  const wellFormed = JSON.stringify({
    summary: "Dropped the legacy tables.",
    continuity: {
      whereThisIs: "The systems model is live.",
      thisSession: ["Dropped four legacy tables."],
      decided: ["Sonnet writes the story in one call."],
      never: ["Never a live unsupervised LLM."],
      next: "Design the story generator."
    }
  });

  it("extracts all five sections from a well-formed response", () => {
    expect(extractContinuity(wellFormed)).toEqual({
      whereThisIs: "The systems model is live.",
      thisSession: ["Dropped four legacy tables."],
      decided: ["Sonnet writes the story in one call."],
      never: ["Never a live unsupervised LLM."],
      next: "Design the story generator."
    });
  });

  it("reads through a fenced code block, which the model sometimes wraps its JSON in", () => {
    expect(extractContinuity("```json\n" + wellFormed + "\n```")).not.toBeNull();
  });

  it("returns null when the handoff block is missing entirely", () => {
    expect(extractContinuity(JSON.stringify({ summary: "just a briefing" }))).toBeNull();
  });

  it("returns null rather than a partial handoff when a required section is absent", () => {
    const missingNext = JSON.stringify({
      continuity: { whereThisIs: "somewhere", thisSession: [], decided: [], never: [] }
    });

    expect(extractContinuity(missingNext)).toBeNull();
  });

  it("drops non-string list entries instead of letting them reach the document", () => {
    const dirty = JSON.stringify({
      continuity: {
        whereThisIs: "here",
        thisSession: ["real", 42, null, { nested: true }],
        decided: "not an array",
        never: [],
        next: "onwards"
      }
    });

    expect(extractContinuity(dirty)).toMatchObject({
      thisSession: ["real"],
      decided: []
    });
  });

  it("returns null on unparseable output rather than throwing into the exit flow", () => {
    expect(extractContinuity("the model just said words")).toBeNull();
  });
});

describe("extractSummary and extractContinuity are independent", () => {
  it("still yields the briefing when the handoff block is malformed", () => {
    const raw = JSON.stringify({ summary: "The briefing survived.", continuity: "not an object" });

    expect(extractSummary(raw)).toBe("The briefing survived.");
    expect(extractContinuity(raw)).toBeNull();
  });

  it("still yields the handoff when the briefing text is missing", () => {
    const raw = JSON.stringify({
      continuity: {
        whereThisIs: "here",
        thisSession: [],
        decided: [],
        never: [],
        next: "onwards"
      }
    });

    expect(extractSummary(raw)).toBeNull();
    expect(extractContinuity(raw)).not.toBeNull();
  });
});

describe("writeContinuity", () => {
  const sections: ContinuitySections = {
    whereThisIs: "The model is validated.",
    thisSession: ["Validated the harmonic model."],
    decided: ["Local OCR only."],
    never: ["Never become a general weather product."],
    next: "Persist stations and predictions."
  };

  const context: ContinuityContext = {
    projectName: "tide-atlas",
    prdSummary: "A local-first tide almanac.",
    phases: [],
    latestLogEntry: null,
    ledger: null
  };

  type Saved = { projectId: string; sections: ContinuitySections; degraded: boolean };

  const stubDb = (input: { onSave?: () => void } = {}) => {
    const saves: Saved[] = [];
    const events: string[] = [];
    const db = {
      saveContinuitySections: (saved: Saved) => {
        input.onSave?.();
        saves.push(saved);
        return { ...saved, createdAt: "", updatedAt: "" };
      },
      logActivity: ({ eventType }: { eventType: string }) => {
        events.push(eventType);
        return {};
      }
    } as unknown as StarshipDb;

    return { db, saves, events };
  };

  const request = () => ({
    projectId: "p1",
    projectPath: tempDir,
    projectName: "tide-atlas"
  });

  it("persists the sections when the session produced a real handoff", () => {
    const { db, saves } = stubDb();

    writeContinuity(db, request(), context, Date.now(), { sections });

    expect(saves).toHaveLength(1);
    expect(saves[0].sections.next).toBe("Persist stations and predictions.");
    expect(saves[0].degraded).toBe(false);
  });

  it("persists the degraded sections too, flagged as degraded", () => {
    const { db, saves } = stubDb();

    writeContinuity(db, request(), context, Date.now(), {
      degraded: "The session ended before it could be summarized."
    });

    expect(saves).toHaveLength(1);
    expect(saves[0].degraded).toBe(true);
    // Degraded or not, the durable half is still described rather than blank.
    expect(saves[0].sections.whereThisIs).toContain("A local-first tide almanac");
  });

  it("still writes the handoff file when storing the sections fails", () => {
    const { db, events } = stubDb({
      onSave: () => {
        throw new Error("database is locked");
      }
    });

    const result = writeContinuity(db, request(), context, Date.now(), { sections });

    // The file is what the next agent actually reads, so a storage failure
    // must not be able to cost the user it.
    expect(result.filePath).toBe(path.join(tempDir, "CONTINUITY.md"));
    expect(fs.existsSync(path.join(tempDir, "CONTINUITY.md"))).toBe(true);
    expect(events).toContain("continuity_sections_store_failed");
  });
});
