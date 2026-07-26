import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentLedger, KanbanTaskDto } from "../shared/ipc";
import type { StarshipDb } from "./db";

vi.mock("electron", () => ({
  app: { getAppPath: vi.fn(), getPath: vi.fn() },
  ipcMain: { handle: vi.fn() }
}));

vi.mock("./dashboard", () => ({
  findNewestTranscript: vi.fn()
}));

vi.mock("./inception/headlessClaude", () => ({
  getHeadlessCwd: vi.fn(() => "D:\\WEB PROJECTS\\starship"),
  runHeadlessClaude: vi.fn()
}));

import { findNewestTranscript } from "./dashboard";
import { runHeadlessClaude } from "./inception/headlessClaude";
import {
  buildTaskReasoningTimeline,
  buildTaskReasoningTimelineForProject,
  generateIntentAnnotation,
  matchReasoningToTasks
} from "./intentAnnotation";

let tempDir: string;
let transcriptPath: string;
let previousPromptDir: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-intent-annotation-"));
  transcriptPath = path.join(tempDir, "session.jsonl");
  previousPromptDir = process.env.STARSHIP_PROMPT_DIR;
  process.env.STARSHIP_PROMPT_DIR = tempDir;
  fs.writeFileSync(
    path.join(tempDir, "intent-annotation.md"),
    "Annotate.\n\nInput:\n{{payload_json}}",
    "utf8"
  );
  vi.mocked(findNewestTranscript).mockReset();
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

const bulkTaskCreate = (items: Array<{ content: string; status: string }>): unknown => ({
  type: "assistant",
  message: {
    role: "assistant",
    content: [
      { type: "tool_use", name: "TaskCreate", input: { tasks: JSON.stringify(items) } }
    ]
  }
});

describe("buildTaskReasoningTimeline", () => {
  it("returns [] when the transcript doesn't exist", () => {
    expect(buildTaskReasoningTimeline(path.join(tempDir, "missing.jsonl"))).toEqual([]);
  });

  it("captures the nearest-preceding reasoning for an incremental TaskCreate", () => {
    writeLines(
      assistantText("First, set up the board module."),
      incrementalTaskCreate("Build the board module")
    );

    expect(buildTaskReasoningTimeline(transcriptPath)).toEqual([
      { label: "Build the board module", reasoning: "First, set up the board module." }
    ]);
  });

  it("captures reasoning for every item in a bulk TaskCreate call, sharing the same nearest reasoning", () => {
    writeLines(
      assistantText("Here's the plan for the whole feature."),
      bulkTaskCreate([
        { content: "Design the schema", status: "pending" },
        { content: "Write the migration", status: "pending" }
      ])
    );

    expect(buildTaskReasoningTimeline(transcriptPath)).toEqual([
      { label: "Design the schema", reasoning: "Here's the plan for the whole feature." },
      { label: "Write the migration", reasoning: "Here's the plan for the whole feature." }
    ]);
  });

  it("records null reasoning when no assistant text preceded the TaskCreate call", () => {
    writeLines(incrementalTaskCreate("Task with no narration"));

    expect(buildTaskReasoningTimeline(transcriptPath)).toEqual([
      { label: "Task with no narration", reasoning: null }
    ]);
  });

  it("ignores TaskUpdate and unrelated tool calls", () => {
    writeLines(
      assistantText("Reasoning before an update, not a create."),
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "TaskUpdate", input: { taskId: "1", status: "completed" } }]
        }
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }]
        }
      }
    );

    expect(buildTaskReasoningTimeline(transcriptPath)).toEqual([]);
  });

  it("skips malformed lines without throwing", () => {
    fs.writeFileSync(
      transcriptPath,
      "not json\n" + JSON.stringify(incrementalTaskCreate("Still captured")),
      "utf8"
    );

    expect(buildTaskReasoningTimeline(transcriptPath)).toEqual([
      { label: "Still captured", reasoning: null }
    ]);
  });
});

describe("buildTaskReasoningTimelineForProject", () => {
  it("returns [] for an empty transcript list", () => {
    expect(buildTaskReasoningTimelineForProject([])).toEqual([]);
  });

  it("concatenates decisions across multiple transcripts in order", () => {
    const firstPath = path.join(tempDir, "first.jsonl");
    const secondPath = path.join(tempDir, "second.jsonl");
    fs.writeFileSync(
      firstPath,
      [assistantText("Kick off the board module."), incrementalTaskCreate("Build the board module")]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
      "utf8"
    );
    fs.writeFileSync(
      secondPath,
      [assistantText("Now wire up scoring."), incrementalTaskCreate("Add scoring")]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
      "utf8"
    );

    expect(buildTaskReasoningTimelineForProject([firstPath, secondPath])).toEqual([
      { label: "Build the board module", reasoning: "Kick off the board module.", sessionIndex: 0 },
      { label: "Add scoring", reasoning: "Now wire up scoring.", sessionIndex: 1 }
    ]);
  });

  it("resets reasoning at each transcript boundary - a later session's task never inherits an earlier session's trailing text", () => {
    const firstPath = path.join(tempDir, "first.jsonl");
    const secondPath = path.join(tempDir, "second.jsonl");
    fs.writeFileSync(
      firstPath,
      JSON.stringify(assistantText("Leftover reasoning from session one.")) + "\n",
      "utf8"
    );
    fs.writeFileSync(secondPath, JSON.stringify(incrementalTaskCreate("Task in session two")) + "\n", "utf8");

    expect(buildTaskReasoningTimelineForProject([firstPath, secondPath])).toEqual([
      { label: "Task in session two", reasoning: null, sessionIndex: 1 }
    ]);
  });

  it("skips a transcript that can't be read rather than throwing", () => {
    const missingPath = path.join(tempDir, "missing.jsonl");
    const secondPath = path.join(tempDir, "second.jsonl");
    fs.writeFileSync(secondPath, JSON.stringify(incrementalTaskCreate("Still captured")) + "\n", "utf8");

    expect(buildTaskReasoningTimelineForProject([missingPath, secondPath])).toEqual([
      { label: "Still captured", reasoning: null, sessionIndex: 1 }
    ]);
  });
});

describe("matchReasoningToTasks", () => {
  const task = (id: string, label: string): KanbanTaskDto => ({ id, label, status: "pending" });

  it("matches tasks to timeline entries by label, in order", () => {
    const tasks = [task("1", "Design the schema"), task("2", "Write the migration")];
    const timeline = [
      { label: "Design the schema", reasoning: "First reasoning." },
      { label: "Write the migration", reasoning: "Second reasoning." }
    ];

    expect(matchReasoningToTasks(tasks, timeline)).toEqual([
      { ...tasks[0], reasoning: "First reasoning." },
      { ...tasks[1], reasoning: "Second reasoning." }
    ]);
  });

  it("consumes the first unused match when labels repeat", () => {
    const tasks = [task("1", "Write tests"), task("2", "Write tests")];
    const timeline = [
      { label: "Write tests", reasoning: "First round." },
      { label: "Write tests", reasoning: "Second round." }
    ];

    expect(matchReasoningToTasks(tasks, timeline)).toEqual([
      { ...tasks[0], reasoning: "First round." },
      { ...tasks[1], reasoning: "Second round." }
    ]);
  });

  it("assigns null reasoning when no timeline entry matches", () => {
    const tasks = [task("1", "A task the transcript never covered")];

    expect(matchReasoningToTasks(tasks, [])).toEqual([{ ...tasks[0], reasoning: null }]);
  });
});

describe("generateIntentAnnotation", () => {
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
    ({ getIntentLedger: vi.fn(() => savedLedger) }) as unknown as StarshipDb;

  it("short-circuits with no headless call when there are no tasks", async () => {
    const db = makeDb(ledger);

    const result = await generateIntentAnnotation(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1",
      tasks: []
    });

    expect(result.perTask).toEqual([]);
    expect(result.overall.verdict).toBe("No tasks yet — nothing to check against intent.");
    expect(runHeadlessClaude).not.toHaveBeenCalled();
  });

  it("passes intentLedger: null through to the prompt when no ledger is saved", async () => {
    vi.mocked(findNewestTranscript).mockReturnValue(null);
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({
        perTask: [{ label: "Build the board", rationale: "First step.", servesIntent: "none", note: "" }],
        overall: { verdict: "No stated intent to check against.", concerns: "" }
      })
    );

    const db = makeDb(null);
    await generateIntentAnnotation(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1",
      tasks: [{ id: "1", label: "Build the board", status: "pending" }]
    });

    const prompt = vi.mocked(runHeadlessClaude).mock.calls[0][1].prompt;
    expect(prompt).toContain('"intentLedger": null');
  });

  it("returns default annotations and a fallback verdict when the headless call fails", async () => {
    vi.mocked(findNewestTranscript).mockReturnValue(null);
    vi.mocked(runHeadlessClaude).mockRejectedValue(new Error("claude unavailable"));

    const db = makeDb(ledger);
    const tasks: KanbanTaskDto[] = [
      { id: "1", label: "Build the board", status: "pending" },
      { id: "2", label: "Wire up scoring", status: "pending" }
    ];

    const result = await generateIntentAnnotation(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1",
      tasks
    });

    expect(result.perTask).toEqual([
      { taskId: "1", rationale: null, servesIntent: "none", note: "" },
      { taskId: "2", rationale: null, servesIntent: "none", note: "" }
    ]);
    expect(result.overall).toEqual({
      verdict: "The intent check couldn't be generated right now.",
      concerns: ""
    });
  });

  it("drops a response entry whose label doesn't match any current task, and defaults tasks the response omitted", async () => {
    vi.mocked(findNewestTranscript).mockReturnValue(null);
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({
        perTask: [
          {
            label: "Build the board",
            rationale: "Foundational step.",
            servesIntent: "successCriteria",
            note: ""
          },
          {
            label: "A label the model invented that isn't in the input",
            rationale: "Should be dropped.",
            servesIntent: "purpose",
            note: ""
          }
        ],
        overall: { verdict: "The plan serves the stated purpose.", concerns: "" }
      })
    );

    const db = makeDb(ledger);
    const tasks: KanbanTaskDto[] = [
      { id: "1", label: "Build the board", status: "pending" },
      { id: "2", label: "Wire up scoring", status: "pending" }
    ];

    const result = await generateIntentAnnotation(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1",
      tasks
    });

    expect(result.perTask).toEqual([
      {
        taskId: "1",
        rationale: "Foundational step.",
        servesIntent: "successCriteria",
        note: ""
      },
      { taskId: "2", rationale: null, servesIntent: "none", note: "" }
    ]);
    expect(result.overall.verdict).toBe("The plan serves the stated purpose.");
  });

  it("flags a task whose note brushes against neverDo", async () => {
    vi.mocked(findNewestTranscript).mockReturnValue(null);
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({
        perTask: [
          {
            label: "Add a rewarded-ad break between rounds",
            rationale: "Requested mid-session.",
            servesIntent: "neverDo",
            note: "This conflicts with the ledger's neverDo: never add ads."
          }
        ],
        overall: { verdict: "One task conflicts with a stated constraint.", concerns: "See the flagged task." }
      })
    );

    const db = makeDb(ledger);
    const result = await generateIntentAnnotation(db, {
      projectId: "proj-1",
      projectPath: "D:\\projects\\proj-1",
      tasks: [{ id: "1", label: "Add a rewarded-ad break between rounds", status: "pending" }]
    });

    expect(result.perTask[0].servesIntent).toBe("neverDo");
    expect(result.perTask[0].note).toContain("neverDo");
    expect(result.overall.concerns).toBe("See the flagged task.");
  });
});
