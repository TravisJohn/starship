import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getAppPath: vi.fn(), getPath: vi.fn() },
  ipcMain: { handle: vi.fn() }
}));

import { buildContextExport, readProjectRules } from "./contextExport";
import type { ContinuitySections } from "./continuity";
import type { StarshipDb, StoredContinuitySections } from "./db";
import type { IntentLedger } from "../shared/ipc";

const MAX_BYTES = 20 * 1024;

const ledger = (overrides: Partial<IntentLedger> = {}): IntentLedger => ({
  projectId: "p1",
  purpose: "So I stop driving to a beach that turned out to be blown out.",
  successCriteria: "I check it instead of three other sites for a whole season.",
  acceptedTradeoffs: "One coastline only. No accounts, no sharing.",
  neverDo: "Never become a general weather product.",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...overrides
});

const sections = (overrides: Partial<ContinuitySections> = {}): ContinuitySections => ({
  whereThisIs: "The model is validated. Storage is not started.",
  thisSession: ["Validated the harmonic model against a published table."],
  decided: ["Local OCR only."],
  never: ["Never become a general weather product."],
  next: "Persist stations and predictions.",
  ...overrides
});

/**
 * buildContextExport only ever asks the database two questions, so a stub
 * keeps these tests about assembly rather than about SQLite.
 */
const stubDb = (input: {
  ledger?: IntentLedger | null;
  stored?: StoredContinuitySections | null;
}): StarshipDb =>
  ({
    getIntentLedger: () => input.ledger ?? null,
    getContinuitySections: () => input.stored ?? null
  }) as unknown as StarshipDb;

const stored = (
  overrides: Partial<StoredContinuitySections> = {}
): StoredContinuitySections => ({
  projectId: "p1",
  sections: sections(),
  degraded: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...overrides
});

describe("buildContextExport", () => {
  let projectPath: string;

  const request = () => ({ projectId: "p1", projectPath, projectName: "tide-atlas" });

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "starship-ctx-"));
    fs.writeFileSync(
      path.join(projectPath, "CLAUDE.md"),
      "# tide-atlas\n\n## Prime directives\n1. Validate before building.\n"
    );
    fs.writeFileSync(
      path.join(projectPath, "PRD.md"),
      "# tide-atlas - PRD\n\n## 1. One-liner\n\nA local-first tide almanac for one coastline.\n"
    );
    fs.writeFileSync(
      path.join(projectPath, "PROJECT_LOG.md"),
      "# Project Log\n\n## 2026-08-09 - Validation before UI\n\nReordered so the model is validated first.\n"
    );
  });

  afterEach(() => {
    fs.rmSync(projectPath, { force: true, recursive: true });
  });

  it("carries all four sections when every source is present", () => {
    const result = buildContextExport(
      stubDb({ ledger: ledger(), stored: stored() }),
      request()
    );

    expect(result.text).toContain("RULES");
    expect(result.text).toContain("Validate before building.");
    expect(result.text).toContain("INTENT LEDGER");
    expect(result.text).toContain("So I stop driving to a beach");
    expect(result.text).toContain("STATE");
    expect(result.text).toContain("A local-first tide almanac");
    expect(result.text).toContain("NEXT");
    expect(result.text).toContain("Persist stations and predictions.");
    expect(result.missingSections).toEqual([]);
    expect(result.trimmed).toBe(false);
  });

  it("names a missing source out loud instead of quietly omitting the section", () => {
    fs.rmSync(path.join(projectPath, "CLAUDE.md"));

    const result = buildContextExport(stubDb({ ledger: null, stored: null }), request());

    expect(result.missingSections).toEqual(["Rules", "Intent Ledger", "Next Steps"]);
    expect(result.text).toContain("no CLAUDE.md");
    expect(result.text).toContain("No Intent Ledger has been captured");
    expect(result.text).toContain("No session has ended through Starship");
  });

  it("flags a reconstructed next step rather than passing it off as the session's own", () => {
    const result = buildContextExport(
      stubDb({ ledger: ledger(), stored: stored({ degraded: true }) }),
      request()
    );

    expect(result.text).toContain("reconstructed from durable state");
  });

  it("keeps the whole block inside the size limit", () => {
    const result = buildContextExport(
      stubDb({ ledger: ledger(), stored: stored() }),
      request()
    );

    expect(result.bytes).toBeLessThanOrEqual(MAX_BYTES);
    expect(result.bytes).toBe(Buffer.byteLength(result.text, "utf8"));
  });

  it("emits pure ASCII, because the block is pasted through terminals and chat boxes", () => {
    fs.writeFileSync(
      path.join(projectPath, "CLAUDE.md"),
      "# Rules\n\nUse “curly quotes” and an em dash — here, plus an ellipsis…\n"
    );

    const result = buildContextExport(
      stubDb({
        ledger: ledger({ purpose: "Fold ‘these’ too." }),
        stored: stored()
      }),
      request()
    );

    expect(/[^\x09\x0A\x20-\x7E]/.test(result.text)).toBe(false);
    // Folded to ASCII rather than dropped, so the text stays readable.
    expect(result.text).toContain('"curly quotes"');
    expect(result.text).toContain("'these'");
  });

  it("drops the log body first when the block is too big, and says that it did", () => {
    fs.writeFileSync(
      path.join(projectPath, "PROJECT_LOG.md"),
      `# Project Log\n\n## 2026-08-09 - Validation before UI\n\n${"Long body line.\n".repeat(1500)}`
    );

    const result = buildContextExport(
      stubDb({ ledger: ledger(), stored: stored() }),
      request()
    );

    expect(result.trimmed).toBe(true);
    expect(result.bytes).toBeLessThanOrEqual(MAX_BYTES);
    expect(result.trimNotice).toContain("reduced to its title");
    // The heading survives, so the reader knows where to look for the rest.
    expect(result.text).toContain("Validation before UI");
    expect(result.text).not.toContain("Long body line.");
  });

  it("never truncates the Intent Ledger, even when the rules alone exceed the limit", () => {
    fs.writeFileSync(
      path.join(projectPath, "CLAUDE.md"),
      `# Rules\n\n${"A binding rule that must be followed.\n".repeat(900)}`
    );

    const result = buildContextExport(
      stubDb({ ledger: ledger(), stored: stored() }),
      request()
    );

    expect(result.bytes).toBeLessThanOrEqual(MAX_BYTES);
    expect(result.trimmed).toBe(true);
    expect(result.text).toContain("[RULES TRUNCATED");
    // Constraints survive whole - a half-stated constraint reads as complete
    // and is more dangerous than an absent one.
    expect(result.text).toContain("Never become a general weather product.");
    expect(result.text).toContain("So I stop driving to a beach");
  });

  it("still produces a usable block for a project with no files at all", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "starship-ctx-bare-"));
    try {
      const result = buildContextExport(stubDb({}), {
        projectId: "p1",
        projectPath: bare,
        projectName: "harbour-notes"
      });

      expect(result.text).toContain("STARSHIP CONTEXT EXPORT - harbour-notes");
      expect(result.text).toContain("could not be described from durable sources");
      expect(result.bytes).toBeGreaterThan(0);
    } finally {
      fs.rmSync(bare, { force: true, recursive: true });
    }
  });
});

describe("readProjectRules", () => {
  it("returns null for a project with no CLAUDE.md rather than throwing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-rules-"));
    try {
      expect(readProjectRules(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  it("treats a whitespace-only CLAUDE.md as no rules at all", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-rules-"));
    try {
      fs.writeFileSync(path.join(dir, "CLAUDE.md"), "   \n\n  \n");
      expect(readProjectRules(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });
});
