import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findLatestProjectLogEntry,
  readPrdPhases,
  readPrdSummary
} from "./dashboard";

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: vi.fn()
  },
  ipcMain: {
    handle: vi.fn()
  }
}));

describe("readPrdSummary", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-prd-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  it("extracts the normal one-liner section", () => {
    writePrd(`
# Project

## 1. One-liner

This project turns intent into a running build.
It keeps the strategic summary visible.

## 2. Thesis

Details here.
`);

    expect(readPrdSummary(tempDir)).toBe(
      "This project turns intent into a running build. It keeps the strategic summary visible."
    );
  });

  it("returns null when PRD.md is missing", () => {
    expect(readPrdSummary(tempDir)).toBeNull();
  });

  it("returns null when the one-liner heading is missing", () => {
    writePrd(`
# Project

## Thesis

No matching heading.
`);

    expect(readPrdSummary(tempDir)).toBeNull();
  });

  it("returns null when the one-liner body is empty", () => {
    writePrd(`
# Project

## 1. One-liner


`);

    expect(readPrdSummary(tempDir)).toBeNull();
  });

  it("matches a lowercase one-liner heading", () => {
    writePrd(`
# Project

## 1. one-liner
Lowercase headings still count.
`);

    expect(readPrdSummary(tempDir)).toBe("Lowercase headings still count.");
  });

  it("returns null when another heading immediately follows", () => {
    writePrd(`
# Project

## 1. One-liner
## 2. Thesis
No body for the one-liner.
`);

    expect(readPrdSummary(tempDir)).toBeNull();
  });

  const writePrd = (content: string): void => {
    fs.writeFileSync(path.join(tempDir, "PRD.md"), content.trimStart(), "utf8");
  };
});

describe("readPrdPhases", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-prd-phases-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  const writePrd = (content: string): void => {
    fs.writeFileSync(path.join(tempDir, "PRD.md"), content.trimStart(), "utf8");
  };

  it("extracts every phase from a real-shaped Phases section, stopping before the next top-level heading", () => {
    writePrd(`
# TicTacToe

## 9. Phases (sequenced to retire uncertainty, not to demo value)

*Each phase opens with the strategic question it answers.*

### Phase 1 — Can we make a fun, working game?
Question: Does a simple game hold up as fun to play together?

Scope: Two players, full game logic, a clean interface.

### Phase 2 — Does keeping score add to the fun?
Question: Does tracking wins/losses across rounds help?

### Phase 3 — Can we put it on the internet simply?
Question: What's the simplest way to host it?

## 10. Risks

| Risk | Mitigation |
|---|---|
| Something | Something else |
`);

    const phases = readPrdPhases(tempDir);
    expect(phases).toEqual([
      {
        title: "Phase 1 — Can we make a fun, working game?",
        body: "Question: Does a simple game hold up as fun to play together? Scope: Two players, full game logic, a clean interface."
      },
      {
        title: "Phase 2 — Does keeping score add to the fun?",
        body: "Question: Does tracking wins/losses across rounds help?"
      },
      {
        title: "Phase 3 — Can we put it on the internet simply?",
        body: "Question: What's the simplest way to host it?"
      }
    ]);
  });

  it("returns an empty array when PRD.md is missing", () => {
    expect(readPrdPhases(tempDir)).toEqual([]);
  });

  it("returns an empty array when there is no Phases heading", () => {
    writePrd(`
# Project

## 1. One-liner

Just a one-liner, no phases section at all.
`);

    expect(readPrdPhases(tempDir)).toEqual([]);
  });

  it("matches a lowercase, differently-numbered Phases heading", () => {
    writePrd(`
# Project

## 4. phases

### Phase 1 — Only phase
Some body text.
`);

    expect(readPrdPhases(tempDir)).toEqual([{ title: "Phase 1 — Only phase", body: "Some body text." }]);
  });

  it("returns an empty array when the Phases section has no phase sub-headings", () => {
    writePrd(`
# Project

## 9. Phases

Nothing decided yet.

## 10. Risks

None yet.
`);

    expect(readPrdPhases(tempDir)).toEqual([]);
  });
});

describe("findLatestProjectLogEntry", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-project-log-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  const writeProjectLog = (content: string): void => {
    fs.writeFileSync(
      path.join(tempDir, "PROJECT_LOG.md"),
      content.trimStart(),
      "utf8"
    );
  };

  it("picks the latest dated heading from a chronological log", () => {
    writeProjectLog(`
# Project Log

## 2026-07-10 - PRD approved

The first pass established the shape.

## 2026-07-13 - File map verified

The file map now works from the dashboard and terminal.
`);

    expect(findLatestProjectLogEntry(tempDir)).toEqual({
      date: "2026-07-13",
      title: "2026-07-13 - File map verified",
      body: "The file map now works from the dashboard and terminal."
    });
  });

  it("picks the latest dated heading from a reverse-chronological log", () => {
    writeProjectLog(`
# Project Log

Newest entries at the top.

## 2026-07-13 - Resume point captured

The newest entry is intentionally first.

## 2026-07-12 - Earlier implementation

This should not be selected.
`);

    expect(findLatestProjectLogEntry(tempDir)).toEqual({
      date: "2026-07-13",
      title: "2026-07-13 - Resume point captured",
      body: "The newest entry is intentionally first."
    });
  });

  it("returns null when PROJECT_LOG.md is missing", () => {
    expect(findLatestProjectLogEntry(tempDir)).toBeNull();
  });

  it("returns null when headings are not dated project-log entries", () => {
    writeProjectLog(`
# Project Log

## Notes

This project has a log, but no dated entry headings.
`);

    expect(findLatestProjectLogEntry(tempDir)).toBeNull();
  });

  it("extracts a single dated entry", () => {
    writeProjectLog(`
# Project Log

## 2026-06-22 (evening) - Seed and verification pass

The seed pass is complete.
`);

    expect(findLatestProjectLogEntry(tempDir)).toEqual({
      date: "2026-06-22",
      title: "2026-06-22 (evening) - Seed and verification pass",
      body: "The seed pass is complete."
    });
  });

  it("keeps nested subheadings in the body but stops at the next entry heading", () => {
    writeProjectLog(`
# Project Log

## 2026-07-13 - Latest milestone

### Done and verified working

The main flow is complete.

### Where to resume next session

Start by checking the save path.

## 2026-07-12 - Previous milestone

This content must not be included.
`);

    expect(findLatestProjectLogEntry(tempDir)).toEqual({
      date: "2026-07-13",
      title: "2026-07-13 - Latest milestone",
      body: "### Done and verified working The main flow is complete. ### Where to resume next session Start by checking the save path."
    });
  });

  it("picks the LAST same-dated entry in a chronological log, not the first (a single productive day logging multiple milestones)", () => {
    writeProjectLog(`
# Project Log

## 2026-07-13 - PRD approved

Approved the plan.

## 2026-07-13 - Stack chosen

Picked the stack.

## 2026-07-13 - Phase 1 milestone: playable game complete

The game actually works now.
`);

    expect(findLatestProjectLogEntry(tempDir)).toEqual({
      date: "2026-07-13",
      title: "2026-07-13 - Phase 1 milestone: playable game complete",
      body: "The game actually works now."
    });
  });

  it("picks the FIRST same-dated entry in a reverse-chronological log, not the last (newest-at-top convention)", () => {
    writeProjectLog(`
# Project Log

Newest entries at the top.

## 2026-07-13 - Phase 1 milestone: playable game complete

The game actually works now.

## 2026-07-13 - Stack chosen

Picked the stack.

## 2026-07-13 - PRD approved

Approved the plan.
`);

    expect(findLatestProjectLogEntry(tempDir)).toEqual({
      date: "2026-07-13",
      title: "2026-07-13 - Phase 1 milestone: playable game complete",
      body: "The game actually works now."
    });
  });
});
