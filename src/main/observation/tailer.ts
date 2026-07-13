import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs";
import { parseSessionLine } from "../parser";
import type { ParsedRecord } from "../parser";

export type Unsubscribe = () => void;

/**
 * Tails a single file: one bounded read of whatever content already exists
 * (a session can be hundreds of KB to several MB from a long-running
 * conversation - this is a one-time cost on attach, not a steady-state one),
 * then byte-offset incremental reads on every subsequent change, never
 * re-parsing bytes already consumed.
 *
 * A trailing line with no newline yet (the writer mid-write) is held back
 * and prefixed onto the next read rather than parsed early or dropped.
 *
 * Shared low-level primitive behind both `tailSession` (Claude Code
 * transcripts) and the permission-signal tailer (see permissionSignal.ts) -
 * both are append-only newline-delimited files with the exact same
 * incremental-read requirements, just different per-line parsing.
 */
export type TailFileOptions = {
  /** Byte offset to start reading from, skipping any content already present up to it. Defaults to 0 (read everything). */
  initialOffsetBytes?: number;
};

export const tailFile = (
  filePath: string,
  onLine: (line: string) => void,
  options: TailFileOptions = {}
): Unsubscribe => {
  let offsetBytes = options.initialOffsetBytes ?? 0;
  let leftover = "";
  let closed = false;

  const readNewContent = (): void => {
    if (closed) {
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }

    if (stat.size < offsetBytes) {
      // Should not happen for an append-only file; defensively treat as if
      // we'd never read it rather than reading negative-length bytes.
      offsetBytes = 0;
      leftover = "";
    }

    if (stat.size <= offsetBytes) {
      return;
    }

    const length = stat.size - offsetBytes;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, length, offsetBytes);
    } finally {
      fs.closeSync(fd);
    }
    offsetBytes = stat.size;

    const chunk = leftover + buffer.toString("utf8");
    const lines = chunk.split("\n");
    leftover = lines.pop() ?? "";

    for (const line of lines) {
      onLine(line);
    }
  };

  // One bounded catch-up read of whatever already exists.
  readNewContent();

  const watcher: FSWatcher = chokidar.watch(filePath, {
    ignoreInitial: true,
    awaitWriteFinish: false
  });
  watcher.on("change", readNewContent);
  watcher.on("add", readNewContent);

  return () => {
    closed = true;
    void watcher.close();
  };
};

/**
 * Tails a single resolved Claude Code transcript file, parsing each line via
 * the versioned JSONL adapter. See `tailFile` for the incremental-read
 * guarantees this relies on.
 */
export const tailSession = (
  transcriptPath: string,
  onRecord: (record: ParsedRecord) => void
): Unsubscribe =>
  tailFile(transcriptPath, (line) => {
    for (const record of parseSessionLine(line)) {
      onRecord(record);
    }
  });
