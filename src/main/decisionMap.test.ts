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
  findAllTranscriptsForProject: vi.fn(),
  // Real (small) implementation rather than a vi.fn() stub - decisionMap.ts
  // calls this directly for date resolution/coverage, not just as a
  // dependency to assert was-called-with. Mirrors dashboard.ts's own regex
  // exactly; kept inline here so this test doesn't have to load the real
  // dashboard.ts module (which pulls in electron dialogs and the JSONL
  // parser for unrelated reasons).
  extractDatedHeadings: (content: string) => {
    const headings: { date: string; title: string; lineIndex: number }[] = [];
    content.split(/\r?\n/).forEach((line, lineIndex) => {
      const match = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
      if (match) {
        headings.push({ date: match[1], title: line.replace(/^##\s+/, "").trim(), lineIndex });
      }
    });
    return headings;
  }
}));

vi.mock("./inception/headlessClaude", () => ({
  getHeadlessCwd: vi.fn(() => "D:\\WEB PROJECTS\\starship"),
  runHeadlessClaude: vi.fn()
}));

import { findAllTranscriptsForProject } from "./dashboard";
import { findDecisionLanguageExcerpts, generateDecisionMap } from "./decisionMap";
import { runHeadlessClaude } from "./inception/headlessClaude";

let tempDir: string;
let transcriptPath: string;
let previousPromptDir: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-decision-map-"));
  transcriptPath = path.join(tempDir, "session.jsonl");
  previousPromptDir = process.env.STARSHIP_PROMPT_DIR;
  process.env.STARSHIP_PROMPT_DIR = tempDir;
  // Bare placeholder (no surrounding prose) so `prompt` in a mocked
  // runHeadlessClaude call IS the JSON payload, directly JSON.parse-able by
  // tests that need to inspect what was actually sent to the model.
  fs.writeFileSync(path.join(tempDir, "decision-map.md"), "{{payload_json}}", "utf8");
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

const writeLines = (filePath: string, ...records: unknown[]): void => {
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
};

const assistantText = (text: string): unknown => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] }
});

const incrementalTaskCreate = (subject: string): unknown => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", name: "TaskCreate", input: { subject } }] }
});

const humanUserTurn = (text: string): unknown => ({
  type: "user",
  message: { role: "user", content: text },
  origin: { kind: "human" }
});

const taskNotificationUserTurn = (text: string): unknown => ({
  type: "user",
  message: { role: "user", content: text },
  origin: { kind: "task-notification" }
});

const toolResultUserTurn = (): unknown => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1" }] }
});

const writeProjectLog = (content: string): void => {
  fs.writeFileSync(path.join(tempDir, "PROJECT_LOG.md"), content, "utf8");
};

const ledger: IntentLedger = {
  projectId: "proj-1",
  purpose: "Ship a fun local game.",
  successCriteria: "Two players can complete a match.",
  acceptedTradeoffs: "No online play in v1.",
  neverDo: "Never apply this to a live game to predict outcomes.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const makeDb = (savedLedger: IntentLedger | null): StarshipDb =>
  ({
    getIntentLedger: vi.fn(() => savedLedger),
    getProject: vi.fn(() => null)
  }) as unknown as StarshipDb;

const mockDecisions = (decisions: unknown[]): void => {
  vi.mocked(runHeadlessClaude).mockResolvedValue(JSON.stringify({ decisions }));
};

describe("generateDecisionMap", () => {
  it("returns an empty record with no headless call when there are no logs or transcripts", async () => {
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([]);
    const db = makeDb(ledger);

    const result = await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    expect(result.decisions).toEqual([]);
    expect(result.coverage.hasProjectLogs).toBe(false);
    expect(result.coverage.totalDecisions).toBe(0);
    expect(runHeadlessClaude).not.toHaveBeenCalled();
  });

  it("drops a task item with no captured reasoning before it's ever offered as a candidate", async () => {
    writeLines(transcriptPath, incrementalTaskCreate("Build the board module"));
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([{ path: transcriptPath, mtimeMs: 1 }]);
    const db = makeDb(ledger);

    const result = await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    expect(result.decisions).toEqual([]);
    expect(runHeadlessClaude).not.toHaveBeenCalled();
  });

  it("collapses N task items sharing identical preceding reasoning into one cluster in the prompt payload", async () => {
    writeLines(
      transcriptPath,
      assistantText("Running the depth extension season by season, newest first."),
      incrementalTaskCreate("Player-level backfill: 2025-26"),
      incrementalTaskCreate("Player-level backfill: 2024-25"),
      incrementalTaskCreate("Player-level backfill: 2023-24")
    );
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([{ path: transcriptPath, mtimeMs: 1 }]);
    mockDecisions([]);

    const db = makeDb(ledger);
    await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    const prompt = vi.mocked(runHeadlessClaude).mock.calls[0][1].prompt;
    const payload = JSON.parse(prompt);
    expect(payload.reasoningClusters).toEqual([
      {
        reasoning: "Running the depth extension season by season, newest first.",
        occurrenceCount: 3,
        sessionId: "session"
      }
    ]);
  });

  it("drops an evidence entry whose anchor isn't verbatim in its named source, and drops a decision whose evidence all fail", async () => {
    writeProjectLog(
      "## 2026-07-20 — Data source decision\n\nChose nba_api over balldontlie.io because of cost.\n"
    );
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([]);
    mockDecisions([
      {
        chose: "nba_api",
        over: "balldontlie.io",
        because: "Cost.",
        evidence: [
          { source: "log", file: "PROJECT_LOG.md", anchor: "Chose nba_api over balldontlie.io because of cost." },
          { source: "transcript", sessionId: "nope", anchor: "this never appeared anywhere" }
        ]
      },
      {
        chose: "Something else",
        over: "An alternative",
        because: "Reasons.",
        evidence: [{ source: "log", file: "PROJECT_LOG.md", anchor: "text that does not exist in the log" }]
      }
    ]);

    const db = makeDb(ledger);
    const result = await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].chose).toBe("nba_api");
    expect(result.decisions[0].evidence).toEqual([
      {
        source: "log",
        ref: "PROJECT_LOG.md#2026-07-20",
        anchor: "Chose nba_api over balldontlie.io because of cost."
      }
    ]);
  });

  it("drops a decision marked isRecapOnly even when otherwise well-formed", async () => {
    writeProjectLog("## 2026-07-20 — Note\n\nAs decided before, X over Y because Z.\n");
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([]);
    mockDecisions([
      {
        chose: "X",
        over: "Y",
        because: "Z.",
        evidence: [{ source: "log", file: "PROJECT_LOG.md", anchor: "As decided before, X over Y because Z." }],
        isRecapOnly: true
      }
    ]);

    const db = makeDb(ledger);
    const result = await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    expect(result.decisions).toEqual([]);
  });

  it("resolves supersedesChose to a surviving decision's id, and nulls an unresolvable reference", async () => {
    writeProjectLog(
      "## 2026-07-20 — A\n\nExcluded 003 only.\n\n## 2026-07-23 — B\n\nSwitched to an include-list instead of the exclude-list.\n"
    );
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([]);
    mockDecisions([
      {
        chose: "Exclude-list (003 only)",
        over: "No filter",
        because: "All-Star games distort records.",
        evidence: [{ source: "log", file: "PROJECT_LOG.md", anchor: "Excluded 003 only." }]
      },
      {
        chose: "Include-list",
        over: "Exclude-list (003 only)",
        because: "Preseason also needed excluding.",
        evidence: [
          { source: "log", file: "PROJECT_LOG.md", anchor: "Switched to an include-list instead of the exclude-list." }
        ],
        supersedesChose: "Exclude-list (003 only)"
      },
      {
        chose: "Unrelated",
        over: "Something",
        because: "Reason.",
        evidence: [{ source: "log", file: "PROJECT_LOG.md", anchor: "Excluded 003 only." }],
        supersedesChose: "A decision that was never emitted"
      }
    ]);

    const db = makeDb(ledger);
    const result = await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    const includeList = result.decisions.find((d) => d.chose === "Include-list");
    const excludeList = result.decisions.find((d) => d.chose === "Exclude-list (003 only)");
    const unrelated = result.decisions.find((d) => d.chose === "Unrelated");

    expect(includeList?.supersedes).toBe(excludeList?.id);
    expect(unrelated?.supersedes).toBeNull();
  });

  it("produces transcript-only decisions with hasProjectLogs: false when no log files exist", async () => {
    writeLines(
      transcriptPath,
      humanUserTurn("should we run this in parallel?"),
      assistantText("Rather than parallel runs, sequential is safer here because of the lock risk.")
    );
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([
      { path: transcriptPath, mtimeMs: Date.parse("2026-07-22T00:00:00.000Z") }
    ]);
    mockDecisions([
      {
        chose: "Sequential runs",
        over: "Parallel runs",
        because: "Lock risk.",
        evidence: [
          {
            source: "transcript",
            sessionId: "session",
            anchor: "Rather than parallel runs, sequential is safer here because of the lock risk."
          }
        ]
      }
    ]);

    const db = makeDb(ledger);
    const result = await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    expect(result.coverage.hasProjectLogs).toBe(false);
    expect(result.coverage.fromLogs).toBe(0);
    expect(result.coverage.fromTranscript).toBe(1);
    expect(result.decisions).toHaveLength(1);
  });

  it("marks transcriptCoveragePartial when the oldest surviving transcript postdates the earliest log entry", async () => {
    writeProjectLog("## 2026-01-01 — Start\n\nFirst entry.\n");
    writeLines(transcriptPath, assistantText("nothing decision-worthy"));
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([
      { path: transcriptPath, mtimeMs: Date.parse("2026-07-01T00:00:00.000Z") }
    ]);
    mockDecisions([]);

    const db = makeDb(ledger);
    const result = await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    expect(result.coverage.transcriptCoveragePartial).toBe(true);
    expect(result.coverage.logsDateRange).toEqual({ earliest: "2026-01-01", latest: "2026-01-01" });
    expect(result.coverage.transcriptDateRange).toEqual({ earliest: "2026-07-01", latest: "2026-07-01" });
  });

  it("reports extractionError with candidate counts on headless failure, never a silently-empty success", async () => {
    writeProjectLog("## 2026-01-01 — Start\n\nSome content.\n");
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([]);
    vi.mocked(runHeadlessClaude).mockRejectedValue(new Error("claude unavailable"));

    const db = makeDb(ledger);
    const result = await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    expect(result.decisions).toEqual([]);
    expect(result.coverage.extractionError).toContain("claude unavailable");
    expect(result.coverage.extractionError).toContain("1 log file(s)");
  });

  it("passes intentLedger: null through to the prompt when no ledger is saved", async () => {
    writeProjectLog("## 2026-01-01 — Start\n\nSome content.\n");
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([]);
    mockDecisions([]);

    const db = makeDb(null);
    await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    const prompt = vi.mocked(runHeadlessClaude).mock.calls[0][1].prompt;
    expect(JSON.parse(prompt).intentLedger).toBeNull();
  });

  it("forces servesIntent to null when no Intent Ledger exists, even if the model tagged one", async () => {
    writeProjectLog("## 2026-01-01 — Start\n\nChose X over Y because Z.\n");
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([]);
    mockDecisions([
      {
        chose: "X",
        over: "Y",
        because: "Z.",
        evidence: [{ source: "log", file: "PROJECT_LOG.md", anchor: "Chose X over Y because Z." }],
        servesIntent: "neverDo"
      }
    ]);

    const db = makeDb(null);
    const result = await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    expect(result.decisions[0].servesIntent).toBeNull();
  });

  it("keeps reversible only when the cited evidence anchor itself states reversibility language", async () => {
    writeProjectLog(
      "## 2026-01-01 — Start\n\nDeferred home/away splits; can be added later without rework.\n\nChose flat pricing over tiered pricing because simplicity.\n"
    );
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([]);
    mockDecisions([
      {
        chose: "Season-aggregate only",
        over: "Home/away splits",
        because: "Simpler to ship first.",
        evidence: [
          {
            source: "log",
            file: "PROJECT_LOG.md",
            anchor: "Deferred home/away splits; can be added later without rework."
          }
        ],
        reversible: "cheap"
      },
      {
        chose: "Flat pricing",
        over: "Tiered pricing",
        because: "Simplicity.",
        evidence: [
          { source: "log", file: "PROJECT_LOG.md", anchor: "Chose flat pricing over tiered pricing because simplicity." }
        ],
        reversible: "load-bearing"
      }
    ]);

    const db = makeDb(ledger);
    const result = await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    const seasonAgg = result.decisions.find((d) => d.chose === "Season-aggregate only");
    const flatPricing = result.decisions.find((d) => d.chose === "Flat pricing");
    expect(seasonAgg?.reversible).toBe("cheap");
    expect(flatPricing?.reversible).toBeNull();
  });

  it("also survives a 'load-bearing' tag when the evidence states load-bearing language, not just 'cheap' language", async () => {
    writeProjectLog(
      "## 2026-01-01 — Start\n\nSchema choice is load-bearing and would require a rewrite to change later.\n"
    );
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([]);
    mockDecisions([
      {
        chose: "Wide table",
        over: "Normalized schema",
        because: "Read performance.",
        evidence: [
          {
            source: "log",
            file: "PROJECT_LOG.md",
            anchor: "Schema choice is load-bearing and would require a rewrite to change later."
          }
        ],
        reversible: "load-bearing"
      }
    ]);

    const db = makeDb(ledger);
    const result = await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    expect(result.decisions[0].reversible).toBe("load-bearing");
  });

  it("truncates 'because' to two sentences even when the model returns more", async () => {
    writeProjectLog("## 2026-01-01 — Start\n\nChose X over Y for three stated reasons.\n");
    vi.mocked(findAllTranscriptsForProject).mockReturnValue([]);
    mockDecisions([
      {
        chose: "X",
        over: "Y",
        because: "First reason applies. Second reason also applies. Third reason is extra and should be cut.",
        evidence: [{ source: "log", file: "PROJECT_LOG.md", anchor: "Chose X over Y for three stated reasons." }]
      }
    ]);

    const db = makeDb(ledger);
    const result = await generateDecisionMap(db, { projectId: "proj-1", projectPath: tempDir });

    expect(result.decisions[0].because).toBe("First reason applies. Second reason also applies.");
  });
});

describe("findDecisionLanguageExcerpts", () => {
  it("attaches a human-typed question as context, but never a tool_result or task-notification impersonating one", () => {
    writeLines(
      transcriptPath,
      humanUserTurn("can we explore parallel run right?"),
      assistantText(
        "One real decision to flag: parallel backfills would double the exact throttling we're already fighting."
      ),
      toolResultUserTurn(),
      taskNotificationUserTurn("<task-notification>...</task-notification>"),
      assistantText("Rather than retry immediately, let me flag one real risk before continuing.")
    );

    const excerpts = findDecisionLanguageExcerpts([{ path: transcriptPath }]);

    expect(excerpts).toHaveLength(2);
    expect(excerpts[0].userQuestion).toBe("can we explore parallel run right?");
    expect(excerpts[0].assistantText).toContain("double the exact throttling");
    // Neither the tool_result nor the task-notification (same "user" shape,
    // different origin.kind) should have overwritten the tracked question.
    expect(excerpts[1].userQuestion).toBe("can we explore parallel run right?");
  });
});
