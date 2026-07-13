import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPrdPhases, readPrdSummary } from "./dashboard";

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
