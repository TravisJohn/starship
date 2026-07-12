import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParsedRecord } from "../parser";
import { tailSession } from "./tailer";

let dir: string;
let transcriptPath: string;

// No `sessionId` field here deliberately - the parser emits an extra
// session-meta record whenever it's present, which would double the
// per-line record count and obscure what these tests are checking (the
// tailer's byte/offset bookkeeping, not the parser's multi-record fan-out,
// which parseLine.test.ts already covers).
const permissionModeLine = (mode: string): string =>
  JSON.stringify({ type: "permission-mode", permissionMode: mode }) + "\n";

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-tailer-test-"));
  transcriptPath = path.join(dir, "session.jsonl");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("tailSession", () => {
  it("delivers pre-existing content immediately as a one-time catch-up read", () => {
    fs.writeFileSync(transcriptPath, permissionModeLine("bypassPermissions") + permissionModeLine("plan"));

    const records: ParsedRecord[] = [];
    const unsubscribe = tailSession(transcriptPath, (record) => records.push(record));

    expect(records).toEqual([
      { kind: "permission-mode", permissionMode: "bypassPermissions" },
      { kind: "permission-mode", permissionMode: "plan" }
    ]);

    unsubscribe();
  });

  it("delivers newly appended lines incrementally without re-delivering earlier ones", async () => {
    fs.writeFileSync(transcriptPath, permissionModeLine("bypassPermissions"));

    const records: ParsedRecord[] = [];
    const unsubscribe = tailSession(transcriptPath, (record) => records.push(record));
    expect(records).toHaveLength(1);

    // A brief delay avoids racing chokidar's own watcher-readiness, mirroring
    // the same pattern used in correlate.test.ts.
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.appendFileSync(transcriptPath, permissionModeLine("plan"));

    await waitFor(() => records.length === 2);
    expect(records).toEqual([
      { kind: "permission-mode", permissionMode: "bypassPermissions" },
      { kind: "permission-mode", permissionMode: "plan" }
    ]);

    unsubscribe();
  });

  it("holds back a line with no trailing newline until it is completed", async () => {
    fs.writeFileSync(transcriptPath, "");

    const records: ParsedRecord[] = [];
    const unsubscribe = tailSession(transcriptPath, (record) => records.push(record));

    const fullLine = JSON.stringify({ type: "permission-mode", permissionMode: "acceptEdits" });
    // Write the line in two pieces with no newline yet after the first half.
    fs.appendFileSync(transcriptPath, fullLine.slice(0, 20));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(records).toHaveLength(0);

    fs.appendFileSync(transcriptPath, fullLine.slice(20) + "\n");
    await waitFor(() => records.length === 1);
    expect(records).toEqual([{ kind: "permission-mode", permissionMode: "acceptEdits" }]);

    unsubscribe();
  });

  it("stops delivering records after unsubscribe", async () => {
    fs.writeFileSync(transcriptPath, permissionModeLine("bypassPermissions"));

    const records: ParsedRecord[] = [];
    const unsubscribe = tailSession(transcriptPath, (record) => records.push(record));
    expect(records).toHaveLength(1);

    unsubscribe();
    fs.appendFileSync(transcriptPath, permissionModeLine("plan"));
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(records).toHaveLength(1);
  });
});
