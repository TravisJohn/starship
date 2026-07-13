import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StarshipDb } from "./db";

vi.mock("electron", () => ({
  app: { getAppPath: vi.fn(), getPath: vi.fn() },
  ipcMain: { handle: vi.fn() }
}));

vi.mock("./inception/headlessClaude", () => ({
  getHeadlessCwd: vi.fn(() => "D:\\WEB PROJECTS\\starship"),
  runHeadlessClaude: vi.fn()
}));

import { runHeadlessClaude } from "./inception/headlessClaude";
import { generateProjectLogBriefing } from "./projectLogBriefing";

describe("generateProjectLogBriefing", () => {
  let tempDir: string;
  let previousPromptDir: string | undefined;
  const db = {} as StarshipDb;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-project-log-prompt-"));
    previousPromptDir = process.env.STARSHIP_PROMPT_DIR;
    process.env.STARSHIP_PROMPT_DIR = tempDir;
    fs.writeFileSync(
      path.join(tempDir, "project-log-summary.md"),
      "Summarize this log entry.\n\nInput:\n{{payload_json}}",
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

  it("assembles the prompt and returns the parsed summary", async () => {
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({ summary: "Resume by checking the saved file path." })
    );

    const result = await generateProjectLogBriefing(db, {
      title: "2026-07-13 - File map verified",
      body: "The map works. Next session should check download polish."
    });

    expect(result).toEqual({
      summary: "Resume by checking the saved file path."
    });
    expect(runHeadlessClaude).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        cacheNamespace: "project-log-summary",
        cwd: "D:\\WEB PROJECTS\\starship"
      })
    );
    const prompt = vi.mocked(runHeadlessClaude).mock.calls[0][1].prompt;
    expect(prompt).toContain('"title": "2026-07-13 - File map verified"');
    expect(prompt).toContain(
      '"body": "The map works. Next session should check download polish."'
    );
  });

  it("parses a JSON summary inside a code fence", async () => {
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      '```json\n{"summary":"The next step is already explicit."}\n```'
    );

    await expect(
      generateProjectLogBriefing(db, {
        title: "2026-07-13 - Resume point",
        body: "Start with deployment verification."
      })
    ).resolves.toEqual({ summary: "The next step is already explicit." });
  });

  it("falls back to the raw entry body when the response does not parse", async () => {
    vi.mocked(runHeadlessClaude).mockResolvedValue("not json");

    await expect(
      generateProjectLogBriefing(db, {
        title: "2026-07-13 - Resume point",
        body: "Start with deployment verification."
      })
    ).resolves.toEqual({ summary: "Start with deployment verification." });
  });

  it("falls back to the raw entry body when the headless call fails", async () => {
    vi.mocked(runHeadlessClaude).mockRejectedValue(new Error("claude unavailable"));

    await expect(
      generateProjectLogBriefing(db, {
        title: "2026-07-13 - Resume point",
        body: "Use the already-written log entry."
      })
    ).resolves.toEqual({ summary: "Use the already-written log entry." });
  });
});
