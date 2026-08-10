import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("electron", () => ({
  app: { getAppPath: vi.fn(), getPath: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() }
}));

import {
  buildDegradedSections,
  capDecided,
  formatSessionDate,
  isAgentAuthored,
  normalizeBullets,
  renderContinuityDocument,
  shouldPreserveExisting,
  toAscii,
  writeContinuityDocument,
  STARSHIP_PROVENANCE,
  type ContinuityContext,
  type ContinuitySections
} from "./continuity";

const sections = (overrides: Partial<ContinuitySections> = {}): ContinuitySections => ({
  whereThisIs: "Phases one to four are built. Phase five is parked.",
  thisSession: ["Retrofit is possible now."],
  decided: ["The note is written by the finishing agent."],
  never: ["Never write into the user's projects."],
  next: "Wire the Antigravity trigger.",
  ...overrides
});

const context = (overrides: Partial<ContinuityContext> = {}): ContinuityContext => ({
  projectName: "Hugh",
  prdSummary: "An interview companion.",
  phases: [{ title: "Phase 1 - Discovery", body: "Find the shape." }],
  latestLogEntry: { date: "2026-08-06", title: "Legacy tables dropped", body: "..." },
  ledger: null,
  ...overrides
});

describe("toAscii", () => {
  it("folds typographic characters to their ASCII equivalent rather than deleting them", () => {
    expect(toAscii("a — b")).toBe("a - b");
    expect(toAscii("‘quoted’ and “quoted”")).toBe("'quoted' and \"quoted\"");
    expect(toAscii("wait…")).toBe("wait...");
    expect(toAscii("a b")).toBe("a b");
  });

  it("strips anything else outside ASCII, so the note survives every terminal it is pasted through", () => {
    expect(toAscii("plan ✓ done \u{1F680}")).toBe("plan  done ");
    expect(toAscii("café")).toBe("caf");
  });

  it("preserves newlines and tabs, which the document's own layout depends on", () => {
    expect(toAscii("line one\nline two\tindented")).toBe("line one\nline two\tindented");
  });
});

describe("normalizeBullets", () => {
  it("strips model-supplied bullet markers so the document has exactly one level", () => {
    expect(normalizeBullets(["- already bulleted", "* asterisk", "• dot"])).toEqual([
      "already bulleted",
      "asterisk",
      "dot"
    ]);
  });

  it("collapses multi-line prose into one line per bullet", () => {
    expect(normalizeBullets(["a decision\nspanning lines"])).toEqual(["a decision spanning lines"]);
  });

  it("drops empty and whitespace-only entries instead of rendering blank bullets", () => {
    expect(normalizeBullets(["real", "", "   "])).toEqual(["real"]);
  });
});

describe("capDecided", () => {
  it("caps DECIDED at five bullets even when the model returns more", () => {
    expect(capDecided(["1", "2", "3", "4", "5", "6", "7"])).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("leaves a shorter list untouched", () => {
    expect(capDecided(["1", "2"])).toEqual(["1", "2"]);
  });
});

describe("renderContinuityDocument", () => {
  const render = (input: Partial<ContinuitySections> = {}): string =>
    renderContinuityDocument({
      projectName: "Hugh",
      sections: sections(input),
      producedBy: STARSHIP_PROVENANCE,
      sessionEndedOn: "2026-08-07"
    });

  it("renders the header, provenance and all five sections in order", () => {
    const document = render();

    expect(document).toContain("HANDOFF - Hugh");
    expect(document).toContain(`Session ended 2026-08-07. ${STARSHIP_PROVENANCE}`);
    const order = ["WHERE THIS IS", "THIS SESSION", "DECIDED - do not reopen without cause", "NEVER - hard constraints", "NEXT"];
    const positions = order.map((heading) => document.indexOf(heading));
    expect(positions.every((position) => position !== -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("enforces the five-bullet cap on DECIDED at render time, not by trusting the model", () => {
    const document = render({ decided: ["a", "b", "c", "d", "e", "f", "g"] });
    const decidedBlock = document.split("DECIDED - do not reopen without cause")[1].split("NEVER")[0];

    expect(decidedBlock.match(/^- /gm)?.length).toBe(5);
    expect(decidedBlock).not.toContain("- f");
  });

  it("produces a pure ASCII document even when every section arrives full of typography", () => {
    const document = render({
      whereThisIs: "Mid—pivot — the “old” model is gone.",
      thisSession: ["Dropped four tables — archived first ✓"],
      next: "Design the generator…"
    });

    expect(/[^\x09\x0A\x20-\x7E]/.test(document)).toBe(false);
    expect(document).toContain("Mid-pivot - the \"old\" model is gone.");
  });

  it("says a section is empty plainly rather than padding it or dropping the heading", () => {
    const document = render({ thisSession: [], decided: [] });

    expect(document).toContain("Nothing recorded for this session.");
    expect(document).toContain("DECIDED - do not reopen without cause\nNothing recorded.");
  });

  it("names the missing Intent Ledger in NEVER, which is honest and points at the fix", () => {
    const document = render({ never: [] });

    expect(document).toContain(
      "No Intent Ledger has been captured for this project, so no hard constraints are recorded."
    );
  });
});

describe("buildDegradedSections", () => {
  const ledger = {
    projectId: "p1",
    purpose: "",
    successCriteria: "",
    acceptedTradeoffs: "",
    neverDo: "Never expose her to a live LLM.\nNever optimise for engagement.",
    createdAt: "",
    updatedAt: ""
  };

  it("keeps the durable sections populated when the session itself is unusable", () => {
    const degraded = buildDegradedSections(context({ ledger }), "The session ended early.");

    expect(degraded.whereThisIs).toContain("An interview companion.");
    expect(degraded.whereThisIs).toContain("Legacy tables dropped");
    expect(degraded.never).toEqual([
      "Never expose her to a live LLM.",
      "Never optimise for engagement."
    ]);
  });

  it("marks THIS SESSION as incomplete rather than staying silent, since a confidently wrong section is worse than an empty one", () => {
    const degraded = buildDegradedSections(context(), "The session ended early.");

    expect(degraded.thisSession[0]).toContain("The session ended early.");
    expect(degraded.thisSession[0]).toContain("check git status");
  });

  it("never infers a next step from a session that did not state one", () => {
    expect(buildDegradedSections(context(), "reason").next).toContain("Not recorded.");
  });

  it("does not repeat the date when the log heading already leads with it", () => {
    const degraded = buildDegradedSections(
      context({
        latestLogEntry: {
          date: "2026-07-25",
          title: "2026-07-25 - Phase 1 plan approved, build started",
          body: "..."
        }
      }),
      "reason"
    );

    expect(degraded.whereThisIs).toContain(
      "Latest project log entry: 2026-07-25 - Phase 1 plan approved, build started."
    );
    expect(degraded.whereThisIs).not.toContain("2026-07-25: 2026-07-25");
  });

  it("still supplies the date when the log heading does not carry one", () => {
    const degraded = buildDegradedSections(
      context({
        latestLogEntry: { date: "2026-07-25", title: "Phase 1 plan approved", body: "..." }
      }),
      "reason"
    );

    expect(degraded.whereThisIs).toContain(
      "Latest project log entry: 2026-07-25: Phase 1 plan approved."
    );
  });

  it("still describes the project when there is no PRD or log to read from", () => {
    const degraded = buildDegradedSections(
      context({ prdSummary: null, phases: [], latestLogEntry: null }),
      "reason"
    );

    expect(degraded.whereThisIs).toContain("could not be described from durable sources");
    expect(degraded.decided).toEqual([]);
  });
});

describe("isAgentAuthored", () => {
  it("recognises Starship's own note as not agent-authored", () => {
    expect(isAgentAuthored(`HANDOFF - Hugh\nSession ended 2026-08-07. ${STARSHIP_PROVENANCE}\n`)).toBe(
      false
    );
  });

  it("recognises an agent's own note", () => {
    expect(isAgentAuthored("HANDOFF - Hugh\nSession ended 2026-08-07. Produced by Codex.\n")).toBe(true);
  });

  it("treats a file with no provenance line as Starship's to replace", () => {
    expect(isAgentAuthored("some unrelated file content")).toBe(false);
  });
});

describe("shouldPreserveExisting", () => {
  const transcriptMtime = 1_000_000_000_000;
  const agentNote = "HANDOFF - Hugh\nSession ended 2026-08-07. Produced by Claude Code.\n";
  const starshipNote = `HANDOFF - Hugh\nSession ended 2026-08-07. ${STARSHIP_PROVENANCE}\n`;

  it("writes when there is no existing file", () => {
    expect(shouldPreserveExisting(null, null, transcriptMtime)).toBe(false);
  });

  it("overwrites Starship's own previous note", () => {
    expect(shouldPreserveExisting(starshipNote, transcriptMtime, transcriptMtime)).toBe(false);
  });

  it("keeps an agent's note written during this session, since it has context Starship can only infer", () => {
    // Slightly older than the transcript's final write, which is what a note
    // written as the agent's last act actually looks like on disk.
    expect(shouldPreserveExisting(agentNote, transcriptMtime - 60_000, transcriptMtime)).toBe(true);
  });

  it("overwrites a stale agent note left over from an earlier session", () => {
    const threeDaysEarlier = transcriptMtime - 3 * 24 * 60 * 60 * 1000;
    expect(shouldPreserveExisting(agentNote, threeDaysEarlier, transcriptMtime)).toBe(false);
  });

  it("keeps an agent note when there is no transcript to compare against", () => {
    expect(shouldPreserveExisting(agentNote, transcriptMtime, null)).toBe(true);
  });
});

describe("writeContinuityDocument", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-continuity-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const read = (): string => fs.readFileSync(path.join(tempDir, "CONTINUITY.md"), "utf8");

  it("writes CONTINUITY.md to the project root and reports it", () => {
    const result = writeContinuityDocument({
      projectPath: tempDir,
      projectName: "Hugh",
      sections: sections(),
      degraded: false,
      transcriptMtimeMs: Date.now()
    });

    expect(result.status).toBe("written");
    expect(result.filePath).toBe(path.join(tempDir, "CONTINUITY.md"));
    expect(read()).toContain("HANDOFF - Hugh");
  });

  it("overwrites rather than appending, which is what keeps the note thin", () => {
    const write = (next: string): void => {
      writeContinuityDocument({
        projectPath: tempDir,
        projectName: "Hugh",
        sections: sections({ next }),
        degraded: false,
        transcriptMtimeMs: Date.now()
      });
    };

    write("First next step.");
    write("Second next step.");

    const document = read();
    expect(document).toContain("Second next step.");
    expect(document).not.toContain("First next step.");
    expect(document.match(/HANDOFF - Hugh/g)?.length).toBe(1);
  });

  it("reports the degraded write distinctly, so the Activity Log shows which kind it was", () => {
    const result = writeContinuityDocument({
      projectPath: tempDir,
      projectName: "Hugh",
      sections: buildDegradedSections(context(), "The session ended early."),
      degraded: true,
      transcriptMtimeMs: Date.now()
    });

    expect(result.status).toBe("written-degraded");
  });

  it("leaves an agent's own note from this session alone instead of clobbering it", () => {
    const filePath = path.join(tempDir, "CONTINUITY.md");
    fs.writeFileSync(
      filePath,
      "HANDOFF - Hugh\nSession ended 2026-08-07. Produced by Claude Code.\n\nNEXT\nThe agent's own framing.\n",
      "utf8"
    );

    const result = writeContinuityDocument({
      projectPath: tempDir,
      projectName: "Hugh",
      sections: sections(),
      degraded: false,
      transcriptMtimeMs: fs.statSync(filePath).mtimeMs + 30_000
    });

    expect(result.status).toBe("skipped-agent-authored");
    expect(read()).toContain("The agent's own framing.");
  });

  it("reports a failure instead of throwing, so a bad write never costs the builder the briefing", () => {
    const result = writeContinuityDocument({
      projectPath: path.join(tempDir, "does", "not", "exist"),
      projectName: "Hugh",
      sections: sections(),
      degraded: false,
      transcriptMtimeMs: null
    });

    expect(result.status).toBe("failed");
    expect(result.detail).toBeTruthy();
  });
});

describe("formatSessionDate", () => {
  it("formats as YYYY-MM-DD, matching the project log's own heading convention", () => {
    expect(formatSessionDate(new Date(2026, 7, 7))).toBe("2026-08-07");
  });
});
