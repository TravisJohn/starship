import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPrdSummary } from "./dashboard";

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
