import chokidar, { type FSWatcher } from "chokidar";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { PermissionSignal } from "./statusEngine";
import { slugProjectPath } from "./slug";
import { tailFile, type Unsubscribe } from "./tailer";

export type { PermissionSignal };

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null ? (value as JsonRecord) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * The directory `templates/permission-hook.cjs` (copied into every new
 * project's `.starship/`) appends signal lines to. Must match the hook
 * script's own resolution exactly - the hook runs as a plain Node child
 * process outside Electron, so it can't call `app.getPath("userData")`
 * itself; it hardcodes the same `<userData>/signals` convention. Keep the
 * two in sync if this ever changes.
 */
export const resolveSignalsDir = (): string =>
  process.env.STARSHIP_SIGNALS_DIR ?? path.join(app.getPath("userData"), "signals");

export const resolveSignalFilePath = (projectPath: string): string =>
  path.join(resolveSignalsDir(), `${slugProjectPath(path.resolve(projectPath))}.ndjson`);

const parseSignalLine = (line: string): PermissionSignal | null => {
  const trimmed = line.trim();
  if (trimmed === "") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  if (!record) {
    return null;
  }

  const toolName = asString(record.toolName);
  if (!toolName) {
    return null;
  }

  return { toolName, toolInput: record.toolInput };
};

/**
 * Tails the permission-signal file for one project: each line is one
 * `PermissionRequest` hook firing, i.e. Claude Code is showing a real
 * approval prompt right now, before the human has answered it. This is the
 * one signal the JSONL transcript structurally cannot provide in time - see
 * PHASE3_LOG.md "New finding" - because Claude Code does not write a
 * `tool_use` record for a pending-approval tool call until after the human
 * responds.
 *
 * The file persists across every session ever launched for this project
 * (the hook only ever appends), so unlike `tailSession`'s transcript
 * catch-up read, starting from byte 0 would replay stale signals from past,
 * already-resolved sessions as if they were pending right now. Instead:
 * - If the file already exists when observation starts, skip straight to
 *   its current end and only report genuinely new appends from here.
 * - If it doesn't exist yet, watch its parent directory for it to appear
 *   (chokidar can't reliably watch a single nonexistent file path directly,
 *   only a directory for new entries - the same constraint `correlate.ts`
 *   works around for the transcript root) and then tail it from byte 0,
 *   since its very first write *is* the live event in that case, not
 *   history to skip.
 */
export const tailPermissionSignal = (
  projectPath: string,
  onSignal: (signal: PermissionSignal) => void
): Unsubscribe => {
  const filePath = resolveSignalFilePath(projectPath);
  const onLine = (line: string): void => {
    const signal = parseSignalLine(line);
    if (signal) {
      onSignal(signal);
    }
  };

  let closed = false;
  let unsubscribeTail: Unsubscribe | null = null;

  const existingSize = statSizeOrNull(filePath);
  if (existingSize !== null) {
    unsubscribeTail = tailFile(filePath, onLine, { initialOffsetBytes: existingSize });
    return () => {
      closed = true;
      unsubscribeTail?.();
    };
  }

  const dir = path.dirname(filePath);
  // Ensure the directory itself exists before watching it - chokidar reliably
  // detects a new *file* appearing in an existing watched directory (tested
  // above), but recovering from the directory itself not existing at
  // watch-start is a much less certain path to depend on. This only matters
  // on this machine's very first-ever hook fire for any project.
  fs.mkdirSync(dir, { recursive: true });
  const resolvedTarget = path.resolve(filePath);
  const dirWatcher: FSWatcher = chokidar.watch(dir, {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: false
  });

  const handleAdd = (addedPath: string): void => {
    if (closed || unsubscribeTail || path.resolve(addedPath) !== resolvedTarget) {
      return;
    }
    unsubscribeTail = tailFile(filePath, onLine);
    void dirWatcher.close();
  };

  dirWatcher.on("add", handleAdd);
  dirWatcher.on("error", () => {
    // The signals directory may not exist yet on this machine's first-ever
    // hook fire; chokidar keeps retrying its internal glob, so no action is
    // needed here beyond not crashing (mirrors correlate.ts).
  });

  return () => {
    closed = true;
    void dirWatcher.close();
    unsubscribeTail?.();
  };
};

const statSizeOrNull = (filePath: string): number | null => {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
};
