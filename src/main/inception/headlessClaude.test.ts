import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StarshipDb } from "../db";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}));

import { getHeadlessCwd, runHeadlessClaude } from "./headlessClaude";

class FakeStream extends EventEmitter {
  setEncoding = vi.fn();
}

class FakeChildProcess extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  stdin = { write: vi.fn(), end: vi.fn() };
}

/** Simulates a real `claude -p --output-format json` process: emits stdout
 * then closes on the next microtask, mirroring the real async event order. */
const makeFakeProcess = (stdoutText: string, exitCode = 0): FakeChildProcess => {
  const child = new FakeChildProcess();
  queueMicrotask(() => {
    child.stdout.emit("data", stdoutText);
    child.emit("close", exitCode);
  });
  return child;
};

const claudeOutputJson = (resultText: string): string =>
  JSON.stringify({ is_error: false, result: resultText });

/**
 * The array envelope, in the shape captured from a real
 * `claude -p --output-format json` run on 2026-08-07: stream events with the
 * payload on the trailing `result` element.
 */
const claudeStreamJson = (resultText: string, isError = false): string =>
  JSON.stringify([
    { type: "system", subtype: "init", cwd: "D:\\WEB PROJECTS\\starship", session_id: "s1" },
    { type: "rate_limit_event", rate_limit_info: {}, session_id: "s1" },
    { type: "assistant", message: { role: "assistant", content: [] }, session_id: "s1" },
    {
      type: "result",
      subtype: isError ? "error" : "success",
      is_error: isError,
      result: resultText,
      session_id: "s1"
    }
  ]);

let db: StarshipDb;
let previousCommand: string | undefined;

beforeEach(() => {
  spawnMock.mockReset();
  previousCommand = process.env.STARSHIP_CLAUDE_COMMAND;
  db = {
    getHeadlessCache: vi.fn(() => null),
    saveHeadlessCache: vi.fn()
  } as unknown as StarshipDb;
});

afterEach(() => {
  if (previousCommand === undefined) {
    delete process.env.STARSHIP_CLAUDE_COMMAND;
  } else {
    process.env.STARSHIP_CLAUDE_COMMAND = previousCommand;
  }
});

describe("runHeadlessClaude", () => {
  it("returns the cached value without spawning a process when present", async () => {
    db.getHeadlessCache = vi.fn(() => "cached-value");

    const result = await runHeadlessClaude(db, { cacheNamespace: "ns", prompt: "p", cwd: "." });

    expect(result).toBe("cached-value");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("caches by default when shouldCache is omitted, preserving every existing caller's behavior", async () => {
    spawnMock.mockReturnValue(makeFakeProcess(claudeOutputJson('{"decisions":[]}')));

    const result = await runHeadlessClaude(db, { cacheNamespace: "ns", prompt: "p", cwd: "." });

    expect(result).toBe('{"decisions":[]}');
    expect(db.saveHeadlessCache).toHaveBeenCalledWith(expect.any(String), '{"decisions":[]}');
  });

  it("skips caching when shouldCache returns false, so a bad roll isn't frozen behind a stable content-hash key", async () => {
    spawnMock.mockReturnValue(makeFakeProcess(claudeOutputJson('{"decisions":[]}')));

    await runHeadlessClaude(db, {
      cacheNamespace: "ns",
      prompt: "p",
      cwd: ".",
      shouldCache: () => false
    });

    expect(db.saveHeadlessCache).not.toHaveBeenCalled();
  });

  it("caches when shouldCache returns true", async () => {
    spawnMock.mockReturnValue(makeFakeProcess(claudeOutputJson('{"decisions":[{"chose":"x"}]}')));

    await runHeadlessClaude(db, {
      cacheNamespace: "ns",
      prompt: "p",
      cwd: ".",
      shouldCache: () => true
    });

    expect(db.saveHeadlessCache).toHaveBeenCalled();
  });

  it("pipes the prompt over stdin rather than passing it as a CLI argument", async () => {
    const child = makeFakeProcess(claudeOutputJson('{"decisions":[]}'));
    spawnMock.mockReturnValue(child);
    const longPrompt = "a".repeat(50000);

    await runHeadlessClaude(db, { cacheNamespace: "ns", prompt: longPrompt, cwd: "." });

    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(args).not.toContain(longPrompt);
    expect(args).toEqual(["-p", "--output-format", "json"]);
    expect(child.stdin.write).toHaveBeenCalledWith(longPrompt, "utf8");
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it("rejects when the process exits non-zero", async () => {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    queueMicrotask(() => {
      child.stderr.emit("data", "boom");
      child.emit("close", 1);
    });

    await expect(runHeadlessClaude(db, { cacheNamespace: "ns", prompt: "p", cwd: "." })).rejects.toThrow(
      /claude -p exited with 1: boom/
    );
    expect(db.saveHeadlessCache).not.toHaveBeenCalled();
  });

  it("falls through to raw text instead of throwing when the model's reply isn't valid JSON", async () => {
    spawnMock.mockReturnValue(makeFakeProcess(claudeOutputJson("I shouldn't fabricate a decision from this.")));

    const result = await runHeadlessClaude(db, { cacheNamespace: "ns", prompt: "p", cwd: "." });

    expect(result).toBe("I shouldn't fabricate a decision from this.");
  });

  /**
   * Regression for Inception's PRD/CLAUDE.md drafting: those prompts used to ask
   * the model to wrap the whole document in {"draft": "..."} JSON. A model that put
   * straight quotation marks in its own prose (normal English, e.g. "how well")
   * produced invalid JSON, which fell through this same raw-text path but still
   * carrying the literal {"draft":"...\n\n..."} envelope and escaped \n sequences
   * into PRD.md/CLAUDE.md on disk. The prompts now ask for plain markdown with no
   * JSON envelope, so this path just needs to return prose-with-quotes untouched.
   */
  it("returns plain markdown containing straight quotes verbatim, unwrapped", async () => {
    const markdown = '# Title\n\nSome text with "quoted words" and other punctuation.';
    spawnMock.mockReturnValue(makeFakeProcess(claudeOutputJson(markdown)));

    const result = await runHeadlessClaude(db, { cacheNamespace: "ns", prompt: "p", cwd: "." });

    expect(result).toBe(markdown);
  });
});

describe("runHeadlessClaude envelope shapes", () => {
  /**
   * Starship assumed the single-object envelope. When the CLI moved to the
   * array form, every headless feature broke at once and mostly silently -
   * these cover both shapes so a future CLI change in either direction is
   * caught here rather than in production.
   */
  it("reads the payload from the array envelope a current CLI emits", async () => {
    spawnMock.mockImplementation(() => makeFakeProcess(claudeStreamJson("the answer")));

    await expect(
      runHeadlessClaude(db, { cacheNamespace: "ns", prompt: "p", cwd: "." })
    ).resolves.toBe("the answer");
  });

  it("still reads the single-object envelope an older CLI emits", async () => {
    spawnMock.mockImplementation(() => makeFakeProcess(claudeOutputJson("the answer")));

    await expect(
      runHeadlessClaude(db, { cacheNamespace: "ns", prompt: "p", cwd: "." })
    ).resolves.toBe("the answer");
  });

  it("takes the trailing result event, not an earlier stream event", async () => {
    const stream = JSON.stringify([
      { type: "system", subtype: "init" },
      { type: "result", subtype: "success", is_error: false, result: "first" },
      { type: "result", subtype: "success", is_error: false, result: "last" }
    ]);
    spawnMock.mockImplementation(() => makeFakeProcess(stream));

    await expect(
      runHeadlessClaude(db, { cacheNamespace: "ns", prompt: "p", cwd: "." })
    ).resolves.toBe("last");
  });

  it("surfaces an error reported inside the array envelope", async () => {
    spawnMock.mockImplementation(() => makeFakeProcess(claudeStreamJson("nope", true)));

    await expect(
      runHeadlessClaude(db, { cacheNamespace: "ns", prompt: "p", cwd: "." })
    ).rejects.toThrow(/Headless Claude error/);
  });

  it("rejects a stream that carries no result event rather than returning something wrong", async () => {
    const stream = JSON.stringify([
      { type: "system", subtype: "init" },
      { type: "assistant", message: {} }
    ]);
    spawnMock.mockImplementation(() => makeFakeProcess(stream));

    await expect(
      runHeadlessClaude(db, { cacheNamespace: "ns", prompt: "p", cwd: "." })
    ).rejects.toThrow(/no result event/);
  });

  it("unwraps a JSON payload nested inside the array envelope's result string", async () => {
    spawnMock.mockImplementation(() =>
      makeFakeProcess(claudeStreamJson('{"summary":"nested and extracted"}'))
    );

    await expect(
      runHeadlessClaude(db, { cacheNamespace: "ns", prompt: "p", cwd: "." })
    ).resolves.toBe('{"summary":"nested and extracted"}');
  });
});

describe("getHeadlessCwd", () => {
  it("returns the resolved current working directory", () => {
    expect(getHeadlessCwd()).toBe(process.cwd());
  });
});
