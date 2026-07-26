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
});

describe("getHeadlessCwd", () => {
  it("returns the resolved current working directory", () => {
    expect(getHeadlessCwd()).toBe(process.cwd());
  });
});
