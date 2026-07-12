/**
 * Normalized envelope types for one line of a Claude Code session JSONL
 * transcript. The parser's job stops at this envelope: it recognizes the
 * stable outer shape (assistant tool_use / user tool_result / turn end /
 * permission-mode) that has held across the Claude Code point releases
 * observed on this machine (2.1.191 - 2.1.207). It deliberately does NOT
 * interpret tool-specific `input`/`toolUseResult` payloads (e.g. TaskCreate's
 * fields) - those have drifted release to release and are interpreted by the
 * per-tool shape adapters in this same directory (see taskShape.ts), kept
 * separate so a future drift only touches one small file.
 */

export type ToolUseRecord = {
  kind: "tool-use";
  toolUseId: string;
  toolName: string;
  input: unknown;
  timestamp: string | null;
};

export type ToolResultRecord = {
  kind: "tool-result";
  toolUseId: string;
  isError: boolean;
  /** Structured result payload when present (Claude Code's `toolUseResult`). */
  toolUseResult: unknown;
  timestamp: string | null;
};

export type TurnEndedRecord = {
  kind: "turn-ended";
  timestamp: string | null;
};

export type PermissionModeRecord = {
  kind: "permission-mode";
  permissionMode: string;
};

export type SessionMetaRecord = {
  kind: "session-meta";
  cwd: string | null;
  sessionId: string | null;
  version: string | null;
};

/** A record whose top-level `type` or shape isn't recognized. Tolerant
 * parsing: never thrown, always skipped and logged by the caller. */
export type SkippedRecord = {
  kind: "skipped";
  reason: string;
  rawType: string | null;
};

export type ParsedRecord =
  | ToolUseRecord
  | ToolResultRecord
  | TurnEndedRecord
  | PermissionModeRecord
  | SessionMetaRecord
  | SkippedRecord;

export type TaskStatus = "pending" | "in_progress" | "completed";
