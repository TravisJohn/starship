import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentLedger, SessionBriefingHistoryEntry } from "../shared/ipc";
import type { StarshipDb } from "./db";

vi.mock("electron", () => ({
  app: { getAppPath: vi.fn(), getPath: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn() }
}));

vi.mock("./inception/headlessClaude", () => ({
  getHeadlessCwd: vi.fn(() => "D:\\WEB PROJECTS\\starship"),
  runHeadlessClaude: vi.fn()
}));

import { runHeadlessClaude } from "./inception/headlessClaude";
import { generateNarrativeJourney, renderNarrativeJourneyMarkdown } from "./narrativeJourney";

let tempDir: string;
let previousPromptDir: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-narrative-journey-"));
  previousPromptDir = process.env.STARSHIP_PROMPT_DIR;
  process.env.STARSHIP_PROMPT_DIR = tempDir;
  fs.writeFileSync(
    path.join(tempDir, "narrative-journey.md"),
    "Tell the story.\n\nInput:\n{{payload_json}}",
    "utf8"
  );
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

const ledger: IntentLedger = {
  projectId: "proj-1",
  purpose: "Ship a fun local game.",
  successCriteria: "Two players can complete a match.",
  acceptedTradeoffs: "No online play in v1.",
  neverDo: "Never add ads.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const historyEntry = (id: number, summary: string, createdAt: string): SessionBriefingHistoryEntry => ({
  id,
  projectId: "proj-1",
  summary,
  createdAt
});

const makeDb = (savedLedger: IntentLedger | null, history: SessionBriefingHistoryEntry[]): StarshipDb =>
  ({
    getIntentLedger: vi.fn(() => savedLedger),
    listBriefingHistory: vi.fn(() => history),
    getProject: vi.fn(() => null)
  }) as unknown as StarshipDb;

describe("generateNarrativeJourney", () => {
  it("returns no chapters and makes no headless call when there's no session history yet", async () => {
    const db = makeDb(ledger, []);

    const result = await generateNarrativeJourney(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1"
    });

    expect(result.chapters).toEqual([]);
    expect(runHeadlessClaude).not.toHaveBeenCalled();
  });

  it("returns the chapters the headless call produces", async () => {
    const history = [
      historyEntry(1, "Built the board module.", "2026-01-01T00:00:00.000Z"),
      historyEntry(2, "Added scoring and a restart flow.", "2026-01-02T00:00:00.000Z")
    ];
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({
        chapters: [
          { title: "Foundation", narrative: "It started with the board." },
          { title: "Bringing it to life", narrative: "Scoring and restart followed." }
        ]
      })
    );

    const db = makeDb(ledger, history);
    const result = await generateNarrativeJourney(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1"
    });

    expect(result.chapters).toEqual([
      { title: "Foundation", narrative: "It started with the board." },
      { title: "Bringing it to life", narrative: "Scoring and restart followed." }
    ]);
  });

  it("passes intentLedger: null and the ordered session summaries through to the prompt", async () => {
    const history = [historyEntry(1, "First session summary.", "2026-01-01T00:00:00.000Z")];
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({ chapters: [{ title: "Start", narrative: "It began." }] })
    );

    const db = makeDb(null, history);
    await generateNarrativeJourney(db, { projectId: "proj-1", projectPath: "D:\\projects\\proj-1" });

    const prompt = vi.mocked(runHeadlessClaude).mock.calls[0][1].prompt;
    expect(prompt).toContain('"intentLedger": null');
    expect(prompt).toContain("First session summary.");
  });

  it("falls back to a single honest chapter when the headless call fails", async () => {
    const history = [historyEntry(1, "First session summary.", "2026-01-01T00:00:00.000Z")];
    vi.mocked(runHeadlessClaude).mockRejectedValue(new Error("claude unavailable"));

    const db = makeDb(ledger, history);
    const result = await generateNarrativeJourney(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1"
    });

    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe("Journey");
    expect(result.chapters[0].narrative).toContain("claude unavailable");
  });

  it("falls back to a single honest chapter when the headless call returns unusable JSON", async () => {
    const history = [historyEntry(1, "First session summary.", "2026-01-01T00:00:00.000Z")];
    vi.mocked(runHeadlessClaude).mockResolvedValue("not json at all");

    const db = makeDb(ledger, history);
    const result = await generateNarrativeJourney(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1"
    });

    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].title).toBe("Journey");
  });
});

describe("renderNarrativeJourneyMarkdown", () => {
  it("renders a plain notice when there are no chapters", () => {
    const markdown = renderNarrativeJourneyMarkdown(
      { chapters: [], generatedAt: "2026-01-01T00:00:00.000Z" },
      "StarshipApp"
    );

    expect(markdown).toContain("# StarshipApp — Narrative Journey");
    expect(markdown).toContain("No sessions recorded yet.");
  });

  it("renders each chapter as its own heading and paragraph", () => {
    const markdown = renderNarrativeJourneyMarkdown(
      {
        chapters: [
          { title: "Foundation", narrative: "It started with the board." },
          { title: "Bringing it to life", narrative: "Scoring followed." }
        ],
        generatedAt: "2026-01-01T00:00:00.000Z"
      },
      "StarshipApp"
    );

    expect(markdown).toContain("## Foundation");
    expect(markdown).toContain("It started with the board.");
    expect(markdown).toContain("## Bringing it to life");
    expect(markdown).toContain("Scoring followed.");
  });
});
