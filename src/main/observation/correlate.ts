import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSessionLine } from "../parser";
import { resolveClaudeProjectDir } from "./slug";

export type CorrelationOutcome =
  | { status: "resolved"; transcriptPath: string }
  | { status: "unresolved" };

export type CorrelationRequest = {
  ptySessionId: string;
  /** Absolute project directory the pty was launched with as cwd. */
  projectPath: string;
  /** epoch ms when the pty was spawned. */
  spawnTimeMs: number;
};

export type CorrelationOptions = {
  claudeProjectsRoot?: string;
  /** How far a candidate file's creation time may precede spawnTimeMs and still count (IPC/process-start clock skew). */
  skewBufferMs?: number;
  /** How long to wait for a just-created file to contain a parsable cwd before giving up on this attempt (it keeps watching regardless). */
  contentPollTimeoutMs?: number;
  contentPollIntervalMs?: number;
  /** After a candidate's cwd matches, how long to wait before committing - gives a near-simultaneously created sibling file (a second concurrent session) a chance to arrive and flip this to unresolved instead of guessing. */
  settleWindowMs?: number;
};

export type Unsubscribe = () => void;

const DEFAULT_SKEW_BUFFER_MS = 3000;
const DEFAULT_CONTENT_POLL_TIMEOUT_MS = 5000;
const DEFAULT_CONTENT_POLL_INTERVAL_MS = 150;
const DEFAULT_SETTLE_WINDOW_MS = 300;

/**
 * Watches for the single JSONL transcript Claude Code will create for a pty
 * session Starship just launched, and resolves to it - or stays unresolved
 * rather than guessing. This is a passive, read-only observer: no hooks are
 * installed, no files are written anywhere under ~/.claude.
 *
 * Algorithm (see PHASE3 plan for the full write-up and named failure
 * modes): watch the whole `claudeProjectsRoot` tree (new project
 * directories don't exist yet on a brand-new project's first launch, so we
 * can't watch the target directory directly), filtered to the one
 * slug-resolved target directory. The first `.jsonl` file to appear there
 * after spawnTimeMs (within a small clock-skew buffer) is a candidate; it's
 * only trusted once its own `cwd` field is read back and matches the
 * launched project path exactly (the slug is not injective, so this
 * cross-check is mandatory, not defensive). If a second candidate appears
 * before or after resolution, this correlation becomes permanently
 * unresolved rather than guessing between them.
 */
export const correlateSession = (
  request: CorrelationRequest,
  onOutcome: (outcome: CorrelationOutcome) => void,
  options: CorrelationOptions = {}
): Unsubscribe => {
  const claudeProjectsRoot =
    options.claudeProjectsRoot ?? path.join(os.homedir(), ".claude", "projects");
  const skewBufferMs = options.skewBufferMs ?? DEFAULT_SKEW_BUFFER_MS;
  const contentPollTimeoutMs = options.contentPollTimeoutMs ?? DEFAULT_CONTENT_POLL_TIMEOUT_MS;
  const contentPollIntervalMs =
    options.contentPollIntervalMs ?? DEFAULT_CONTENT_POLL_INTERVAL_MS;
  const settleWindowMs = options.settleWindowMs ?? DEFAULT_SETTLE_WINDOW_MS;

  const resolvedProjectPath = path.resolve(request.projectPath);
  const targetDir = resolveClaudeProjectDir(resolvedProjectPath, claudeProjectsRoot);
  const targetPrefix = targetDir + path.sep;

  let settled = false;
  let candidateCount = 0;
  let checkChain: Promise<void> = Promise.resolve();
  let watcher: FSWatcher | null = null;

  const finish = (outcome: CorrelationOutcome): void => {
    if (settled) {
      return;
    }
    settled = true;
    void watcher?.close();
    onOutcome(outcome);
  };

  const handleCandidate = (candidatePath: string): void => {
    if (settled) {
      return;
    }
    if (!candidatePath.startsWith(targetPrefix) || !candidatePath.endsWith(".jsonl")) {
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidatePath);
    } catch {
      return;
    }
    const createdAtMs = stat.birthtimeMs || stat.mtimeMs;
    if (createdAtMs < request.spawnTimeMs - skewBufferMs) {
      return;
    }

    candidateCount += 1;
    if (candidateCount > 1) {
      finish({ status: "unresolved" });
      return;
    }

    checkChain = checkChain.then(() => tryResolveCandidate(candidatePath));
  };

  const tryResolveCandidate = async (candidatePath: string): Promise<void> => {
    if (settled) {
      return;
    }

    const cwd = await readCwdWhenAvailable(
      candidatePath,
      contentPollTimeoutMs,
      contentPollIntervalMs
    );

    if (settled || candidateCount > 1) {
      return;
    }

    if (cwd !== null && cwd.toLowerCase() === resolvedProjectPath.toLowerCase()) {
      // Don't commit immediately - give a near-simultaneously created
      // sibling file (a second concurrent session) a chance to be observed
      // and flip this to unresolved instead of guessing between them.
      await delay(settleWindowMs);
      if (settled || candidateCount > 1) {
        return;
      }
      finish({ status: "resolved", transcriptPath: candidatePath });
    }
    // Missing/mismatched cwd: leave unresolved and keep watching - either
    // the file hasn't been written to yet, or (slug collision) it belongs
    // to a different project entirely.
  };

  watcher = chokidar.watch(claudeProjectsRoot, {
    ignoreInitial: true,
    depth: 1,
    awaitWriteFinish: false
  });

  watcher.on("add", handleCandidate);
  watcher.on("error", () => {
    // The claudeProjectsRoot or target directory may not exist yet on a
    // brand-new project's first-ever launch; chokidar keeps retrying its
    // internal glob, so no action is needed here beyond not crashing.
  });

  return () => {
    settled = true;
    void watcher?.close();
  };
};

const readCwdWhenAvailable = async (
  filePath: string,
  timeoutMs: number,
  intervalMs: number
): Promise<string | null> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const cwd = tryReadCwd(filePath);
    if (cwd !== null || Date.now() >= deadline) {
      return cwd;
    }
    await delay(intervalMs);
  }
};

const tryReadCwd = (filePath: string): string | null => {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  for (const line of content.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    for (const record of parseSessionLine(line)) {
      if (record.kind === "session-meta" && record.cwd) {
        return record.cwd;
      }
    }
  }
  return null;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
