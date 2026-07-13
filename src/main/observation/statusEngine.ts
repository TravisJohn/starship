import type { ParsedRecord } from "../parser";

export type EngineStatus = "idle" | "building" | "decision-needed";

export type DecisionDetail = {
  toolName: string;
  /** Decision-altitude text naming what's pending - never "waiting for input". */
  summary: string;
};

export type StatusResult =
  | { status: "idle" }
  | { status: "building" }
  | { status: "decision-needed"; decision: DecisionDetail };

/**
 * A tool call that pauses specifically to ask the user something is always
 * a decision, regardless of permission mode or allow-lists.
 */
const INTERACTIVE_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

/**
 * Tools Claude Code conventionally never prompts for, regardless of
 * permission mode (read-only or self-contained bookkeeping).
 */
const ALWAYS_AUTO_APPROVED_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "TaskCreate",
  "TaskUpdate",
  "TaskStop",
  "TaskList",
  "TaskGet",
  "TaskOutput",
  "WebSearch"
]);

const ACCEPT_EDITS_AUTO_APPROVED_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

export type IsAutoApproved = (
  toolName: string,
  input: unknown,
  permissionMode: string | null
) => boolean;

/**
 * Built-in permission classifier. This is a deliberately simple
 * category+mode heuristic, not a full replication of Claude Code's
 * settings.json/settings.local.json glob-based allow-list engine (that
 * would be its own project). Known consequence: a tool call covered by a
 * custom allow-list entry that this heuristic doesn't know about will be
 * (mis)classified as needing a decision under "normal"/"plan" mode - an
 * over-notify, not a missed notification, which is the safer direction of
 * error against the acceptance bar ("a real permission prompt produces a
 * notification").
 */
export const defaultIsAutoApproved: IsAutoApproved = (toolName, _input, permissionMode) => {
  if (permissionMode === "bypassPermissions") {
    return true;
  }
  if (ALWAYS_AUTO_APPROVED_TOOLS.has(toolName)) {
    return true;
  }
  if (permissionMode === "acceptEdits" && ACCEPT_EDITS_AUTO_APPROVED_TOOLS.has(toolName)) {
    return true;
  }
  return false;
};

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null ? (value as JsonRecord) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const truncate = (text: string, maxLength: number): string =>
  text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;

/**
 * Decision-altitude text naming the pending tool call, per CLAUDE.md
 * altitude discipline: never "waiting for input", always what/where.
 */
export const summarizeToolInput = (toolName: string, input: unknown): string => {
  const record = asRecord(input);

  if (toolName === "AskUserQuestion" && record) {
    const questions = Array.isArray(record.questions) ? record.questions : [];
    const first = asRecord(questions[0]);
    const questionText = first ? asString(first.question) : null;
    if (questionText) {
      return questionText;
    }
  }

  if (toolName === "ExitPlanMode" && record) {
    const plan = asString(record.plan);
    if (plan) {
      return `review the plan: ${truncate(plan, 240)}`;
    }
  }

  if (toolName === "Bash" && record) {
    const command = asString(record.command);
    if (command) {
      return `run: ${truncate(command, 200)}`;
    }
  }

  if ((toolName === "Write" || toolName === "Edit") && record) {
    const filePath = asString(record.file_path) ?? asString(record.path);
    if (filePath) {
      return `write to ${filePath}`;
    }
  }

  return `use ${toolName}`;
};

type PendingToolUse = {
  toolUseId: string;
  toolName: string;
  input: unknown;
  firstSeenAtMs: number;
};

/**
 * One `PermissionRequest` hook firing (see permissionSignal.ts): Claude Code
 * is showing a real approval prompt for this tool right now, before the
 * human has answered it. Unlike a `PendingToolUse`, this needs no grace
 * period and no auto-approval classification - the hook only ever fires
 * when Claude Code itself has already decided a real prompt is required, so
 * there's no ambiguity to wait out.
 */
export type PermissionSignal = {
  toolName: string;
  toolInput: unknown;
};

export type StatusEngineOptions = {
  isAutoApproved?: IsAutoApproved;
  /** Delay before an unapproved-looking tool call is treated as decision-needed, to avoid a flash on trivially-fast calls. */
  gracePeriodMs?: number;
  clockNowMs?: () => number;
};

/**
 * Derives idle / building / decision-needed from the tailed record stream.
 * A pending tool_use with no matching tool_result yet is inherently
 * ambiguous between "still executing" and "blocked on a permission
 * prompt" - Claude Code writes nothing to the transcript while a real
 * prompt is showing, so the two look identical at the file level. This is
 * resolved by classification (see defaultIsAutoApproved), not by waiting
 * longer: a legitimately slow approved tool (e.g. a test suite) must not
 * flip to decision-needed just because it's taking a while.
 *
 * That classification heuristic is a fallback, not the primary signal - it
 * exists for approvals the hook-based signal below cannot cover for any
 * reason (hook script failure, older projects created before the hook
 * existed). The `PermissionRequest` hook signal fed via
 * `handlePermissionSignal` is confirmed-real, not guessed, and takes
 * priority whenever present.
 */
export class StatusEngine {
  private readonly pending = new Map<string, PendingToolUse>();
  private permissionMode: string | null = null;
  private hookPendingSignal: PermissionSignal | null = null;
  private readonly isAutoApproved: IsAutoApproved;
  private readonly gracePeriodMs: number;
  private readonly clockNowMs: () => number;

  constructor(options: StatusEngineOptions = {}) {
    this.isAutoApproved = options.isAutoApproved ?? defaultIsAutoApproved;
    this.gracePeriodMs = options.gracePeriodMs ?? 1500;
    this.clockNowMs = options.clockNowMs ?? Date.now;
  }

  handleRecord(record: ParsedRecord): void {
    // Any transcript activity at all proves a previously-signaled pending
    // approval was already answered: Claude Code is fully blocked, waiting
    // synchronously on the hook and then on the human, so nothing else can
    // reach the transcript in between. Safer than trying to match this
    // record back to the specific approval (the hook payload has no
    // tool_use_id yet - that's assigned only once the record is written).
    this.hookPendingSignal = null;

    if (record.kind === "tool-use") {
      this.pending.set(record.toolUseId, {
        toolUseId: record.toolUseId,
        toolName: record.toolName,
        input: record.input,
        firstSeenAtMs: this.clockNowMs()
      });
      return;
    }

    if (record.kind === "tool-result") {
      this.pending.delete(record.toolUseId);
      return;
    }

    if (record.kind === "permission-mode") {
      this.permissionMode = record.permissionMode;
    }
  }

  /** Fed from the permission-signal file tail - see permissionSignal.ts. */
  handlePermissionSignal(signal: PermissionSignal): void {
    this.hookPendingSignal = signal;
  }

  computeStatus(nowMs: number = this.clockNowMs()): StatusResult {
    if (this.hookPendingSignal) {
      const { toolName, toolInput } = this.hookPendingSignal;
      return {
        status: "decision-needed",
        decision: { toolName, summary: summarizeToolInput(toolName, toolInput) }
      };
    }

    for (const use of this.pending.values()) {
      if (INTERACTIVE_TOOLS.has(use.toolName)) {
        return {
          status: "decision-needed",
          decision: { toolName: use.toolName, summary: summarizeToolInput(use.toolName, use.input) }
        };
      }
    }

    for (const use of this.pending.values()) {
      if (this.isAutoApproved(use.toolName, use.input, this.permissionMode)) {
        continue;
      }
      if (nowMs - use.firstSeenAtMs < this.gracePeriodMs) {
        continue;
      }
      return {
        status: "decision-needed",
        decision: { toolName: use.toolName, summary: summarizeToolInput(use.toolName, use.input) }
      };
    }

    return this.pending.size > 0 ? { status: "building" } : { status: "idle" };
  }
}
