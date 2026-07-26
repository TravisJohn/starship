import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentLedger } from "../shared/ipc";
import type { StarshipDb } from "./db";

vi.mock("electron", () => ({
  app: { getAppPath: vi.fn(), getPath: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn() }
}));

vi.mock("./dashboard", () => ({
  findAllTranscriptsForProject: vi.fn()
}));

vi.mock("./inception/headlessClaude", () => ({
  getHeadlessCwd: vi.fn(() => "D:\\WEB PROJECTS\\starship"),
  runHeadlessClaude: vi.fn()
}));

import { findAllTranscriptsForProject } from "./dashboard";
import { generateDecisionMap } from "./decisionMap";
import { runHeadlessClaude } from "./inception/headlessClaude";

let tempDir: string;
let transcriptPath: string;
let previousPromptDir: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-decision-map-"));
  transcriptPath = path.join(tempDir, "session.jsonl");
  previousPromptDir = process.env.STARSHIP_PROMPT_DIR;
  process.env.STARSHIP_PROMPT_DIR = tempDir;
  fs.writeFileSync(
    path.join(tempDir, "decision-map.md"),
    "Map decisions.\n\nInput:\n{{payload_json}}",
    "utf8"
  );
  vi.mocked(findAllTranscriptsForProject).mockReset();
  vi.mocked(runHeadlessClaude).mockReset();
});

afterEach(() => {
  if (previousPromptDir === undefined) {
    delete process.env.STARSHIP_PROMPT_DIR;
  } else {
    process.env.STARSHIP_PROMPT_DIR = previousPromptDir;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const writeLines = (...records: unknown[]): void => {
  fs.writeFileSync(transcriptPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
};

const assistantText = (text: string): unknown => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] }
});

const incrementalTaskCreate = (subject: string): unknown => ({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "tool_use", name: "TaskCreate", input: { subject } }]
  }
});

const ledger: IntentLedger = {
  projectId: "proj-1",
  purpose: "Ship a fun local game.",
  successCriteria: "Two players can complete a match.",
  acceptedTradeoffs: "No online play in v1.",
  neverDo: "Never add ads.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const makeDb = (savedLedger: IntentLedger | null): StarshipDb =>
  ({
    getIntentLedger: vi.fn(() => savedLedger),
    getProject: vi.fn(() => null)
  }) as unknown as StarshipDb;

describe("generateDecisionMap", () => {
  it("returns an empty graph with no headless call when there are no transcripts", async () => {
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([]);
    const db = makeDb(ledger);

    const result = await generateDecisionMap(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1"
    });

    expect(result).toEqual({ nodes: [], edges: [], generatedAt: result.generatedAt });
    expect(runHeadlessClaude).not.toHaveBeenCalled();
  });

  it("returns an empty graph when transcripts exist but capture no decisions", async () => {
    writeLines(assistantText("Just talk, no TaskCreate calls."));
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([
      { path: transcriptPath, mtimeMs: 1 }
    ]);
    const db = makeDb(ledger);

    const result = await generateDecisionMap(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1"
    });

    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(runHeadlessClaude).not.toHaveBeenCalled();
  });

  it("assigns unique ids in timeline order and reconciles servesIntent tags and edges by label", async () => {
    writeLines(
      assistantText("Start with the board module."),
      incrementalTaskCreate("Build the board module"),
      assistantText("Scoring needs the board in place first."),
      incrementalTaskCreate("Add scoring")
    );
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([
      { path: transcriptPath, mtimeMs: 1 }
    ]);
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({
        nodes: [
          { label: "Build the board module", servesIntent: "successCriteria" },
          { label: "Add scoring", servesIntent: "successCriteria" }
        ],
        edges: [
          {
            from: "Build the board module",
            to: "Add scoring",
            reason: "Scoring depends on the board existing."
          }
        ]
      })
    );

    const db = makeDb(ledger);
    const result = await generateDecisionMap(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1"
    });

    expect(result.nodes).toEqual([
      { id: "decision-0", label: "Build the board module", servesIntent: "successCriteria", sessionIndex: 0 },
      { id: "decision-1", label: "Add scoring", servesIntent: "successCriteria", sessionIndex: 0 }
    ]);
    expect(result.edges).toEqual([
      { from: "decision-0", to: "decision-1", reason: "Scoring depends on the board existing." }
    ]);
  });

  it("keeps the default 'none' tag for a node the response didn't tag, and drops an edge citing an unknown label", async () => {
    writeLines(incrementalTaskCreate("Build the board module"));
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([
      { path: transcriptPath, mtimeMs: 1 }
    ]);
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({
        nodes: [],
        edges: [
          {
            from: "Build the board module",
            to: "A label the model invented",
            reason: "Should be dropped."
          }
        ]
      })
    );

    const db = makeDb(ledger);
    const result = await generateDecisionMap(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1"
    });

    expect(result.nodes).toEqual([
      { id: "decision-0", label: "Build the board module", servesIntent: "none", sessionIndex: 0 }
    ]);
    expect(result.edges).toEqual([]);
  });

  it("falls back to untagged nodes and no edges when the headless call fails", async () => {
    writeLines(incrementalTaskCreate("Build the board module"));
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([
      { path: transcriptPath, mtimeMs: 1 }
    ]);
    vi.mocked(runHeadlessClaude).mockRejectedValue(new Error("claude unavailable"));

    const db = makeDb(ledger);
    const result = await generateDecisionMap(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1"
    });

    expect(result.nodes).toEqual([
      { id: "decision-0", label: "Build the board module", servesIntent: "none", sessionIndex: 0 }
    ]);
    expect(result.edges).toEqual([]);
  });

  it("passes intentLedger: null through to the prompt when no ledger is saved", async () => {
    writeLines(incrementalTaskCreate("Build the board module"));
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([
      { path: transcriptPath, mtimeMs: 1 }
    ]);
    vi.mocked(runHeadlessClaude).mockResolvedValue(JSON.stringify({ nodes: [], edges: [] }));

    const db = makeDb(null);
    await generateDecisionMap(db, { projectId: "proj-1", projectPath: "D:\\projects\\proj-1" });

    const prompt = vi.mocked(runHeadlessClaude).mock.calls[0][1].prompt;
    expect(prompt).toContain('"intentLedger": null');
  });
});
