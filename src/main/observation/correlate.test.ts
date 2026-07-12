import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { correlateSession, type CorrelationOutcome } from "./correlate";
import { resolveClaudeProjectDir } from "./slug";

// Real filesystem + real chokidar against a temp directory standing in for
// ~/.claude/projects, so this exercises the actual watch/race behavior
// rather than a mocked approximation of it.

let claudeProjectsRoot: string;
let projectPath: string;

const sessionMetaLine = (cwd: string): string =>
  JSON.stringify({ type: "system", subtype: "turn_duration", cwd, sessionId: "s1", version: "2.1.207" }) + "\n";

const waitFor = async (predicate: () => boolean, timeoutMs = 4000, intervalMs = 25): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

beforeEach(() => {
  claudeProjectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "starship-correlate-test-"));
  projectPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "starship-project-")), "My Project");
  fs.mkdirSync(projectPath, { recursive: true });
});

afterEach(() => {
  fs.rmSync(claudeProjectsRoot, { recursive: true, force: true });
});

const tuningOptions = { contentPollIntervalMs: 20, contentPollTimeoutMs: 2000, skewBufferMs: 3000 };

describe("correlateSession", () => {
  it("resolves to the single new transcript whose cwd matches the launched project", async () => {
    const dir = resolveClaudeProjectDir(projectPath, claudeProjectsRoot);
    fs.mkdirSync(dir, { recursive: true });

    const outcomes: CorrelationOutcome[] = [];
    const unsubscribe = correlateSession(
      { ptySessionId: "pty-1", projectPath, spawnTimeMs: Date.now() },
      (outcome) => outcomes.push(outcome),
      { ...tuningOptions, claudeProjectsRoot }
    );

    // A brief delay before writing mirrors real-world timing (a real
    // `claude` process takes far longer than chokidar's startup scan to
    // write its first line) and avoids racing chokidar's own readiness.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const transcriptPath = path.join(dir, "session-a.jsonl");
    fs.writeFileSync(transcriptPath, sessionMetaLine(projectPath));

    await waitFor(() => outcomes.length > 0);
    expect(outcomes).toEqual([{ status: "resolved", transcriptPath }]);

    unsubscribe();
  });

  it("resolves even when the project's transcript directory does not exist yet at watch start", async () => {
    // No mkdirSync for `dir` here - simulates a brand-new project's very
    // first Claude launch, where ~/.claude/projects/<slug>/ doesn't exist
    // until Claude creates it.
    const dir = resolveClaudeProjectDir(projectPath, claudeProjectsRoot);

    const outcomes: CorrelationOutcome[] = [];
    correlateSession(
      { ptySessionId: "pty-1", projectPath, spawnTimeMs: Date.now() },
      (outcome) => outcomes.push(outcome),
      { ...tuningOptions, claudeProjectsRoot }
    );

    fs.mkdirSync(dir, { recursive: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const transcriptPath = path.join(dir, "session-a.jsonl");
    fs.writeFileSync(transcriptPath, sessionMetaLine(projectPath));

    await waitFor(() => outcomes.length > 0, 6000);
    expect(outcomes).toEqual([{ status: "resolved", transcriptPath }]);
  });

  it("stays unresolved when two transcripts appear in the same window", async () => {
    const dir = resolveClaudeProjectDir(projectPath, claudeProjectsRoot);
    fs.mkdirSync(dir, { recursive: true });

    const outcomes: CorrelationOutcome[] = [];
    correlateSession(
      { ptySessionId: "pty-1", projectPath, spawnTimeMs: Date.now() },
      (outcome) => outcomes.push(outcome),
      { ...tuningOptions, claudeProjectsRoot }
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.writeFileSync(path.join(dir, "session-a.jsonl"), sessionMetaLine(projectPath));
    fs.writeFileSync(path.join(dir, "session-b.jsonl"), sessionMetaLine(projectPath));

    await waitFor(() => outcomes.length > 0);
    expect(outcomes).toEqual([{ status: "unresolved" }]);
  });

  it("never resolves to a file whose cwd does not match the launched project (slug collision guard)", async () => {
    const dir = resolveClaudeProjectDir(projectPath, claudeProjectsRoot);
    fs.mkdirSync(dir, { recursive: true });

    const outcomes: CorrelationOutcome[] = [];
    correlateSession(
      { ptySessionId: "pty-1", projectPath, spawnTimeMs: Date.now() },
      (outcome) => outcomes.push(outcome),
      { ...tuningOptions, claudeProjectsRoot }
    );

    fs.writeFileSync(
      path.join(dir, "session-a.jsonl"),
      sessionMetaLine(path.join(path.dirname(projectPath), "a-totally-different-project"))
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(outcomes).toEqual([]);
  });

  it("ignores transcripts that already existed before the watch started", async () => {
    const dir = resolveClaudeProjectDir(projectPath, claudeProjectsRoot);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pre-existing.jsonl"), sessionMetaLine(projectPath));

    const outcomes: CorrelationOutcome[] = [];
    correlateSession(
      { ptySessionId: "pty-1", projectPath, spawnTimeMs: Date.now() },
      (outcome) => outcomes.push(outcome),
      { ...tuningOptions, claudeProjectsRoot }
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(outcomes).toEqual([]);
  });

  it("ignores activity in other projects' transcript directories", async () => {
    const dir = resolveClaudeProjectDir(projectPath, claudeProjectsRoot);
    fs.mkdirSync(dir, { recursive: true });
    const otherDir = path.join(claudeProjectsRoot, "some-other-project");
    fs.mkdirSync(otherDir, { recursive: true });

    const outcomes: CorrelationOutcome[] = [];
    correlateSession(
      { ptySessionId: "pty-1", projectPath, spawnTimeMs: Date.now() },
      (outcome) => outcomes.push(outcome),
      { ...tuningOptions, claudeProjectsRoot }
    );

    fs.writeFileSync(path.join(otherDir, "unrelated.jsonl"), sessionMetaLine("D:\\Somewhere\\Else"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(outcomes).toEqual([]);

    const transcriptPath = path.join(dir, "session-a.jsonl");
    fs.writeFileSync(transcriptPath, sessionMetaLine(projectPath));
    await waitFor(() => outcomes.length > 0);
    expect(outcomes).toEqual([{ status: "resolved", transcriptPath }]);
  });
});
