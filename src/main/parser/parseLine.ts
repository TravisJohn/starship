import type { ParsedRecord, ToolUseRecord } from "./types";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null ? (value as JsonRecord) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * Parses one raw line of a Claude Code session JSONL transcript into zero or
 * more normalized records. Never throws: malformed JSON, unrecognized
 * top-level `type` values, and unrecognized inner shapes all degrade to a
 * `skipped` record rather than an exception, per the tolerant-parsing rule
 * in CLAUDE.md. A single line can yield multiple records (e.g. session
 * metadata plus a tool result), so callers should flatten across lines.
 */
export const parseSessionLine = (raw: string): ParsedRecord[] => {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [{ kind: "skipped", reason: "invalid JSON", rawType: null }];
  }

  const record = asRecord(parsed);
  if (!record) {
    return [{ kind: "skipped", reason: "not a JSON object", rawType: null }];
  }

  const results: ParsedRecord[] = [];
  const sessionMeta = extractSessionMeta(record);
  if (sessionMeta) {
    results.push(sessionMeta);
  }

  const rawType = asString(record.type);

  switch (rawType) {
    case "assistant":
      results.push(...parseAssistantRecord(record));
      break;
    case "user":
      results.push(...parseUserRecord(record));
      break;
    case "permission-mode": {
      const permissionMode = asString(record.permissionMode);
      if (permissionMode) {
        results.push({ kind: "permission-mode", permissionMode });
      } else {
        results.push({
          kind: "skipped",
          reason: "permission-mode record missing permissionMode",
          rawType
        });
      }
      break;
    }
    // Known-but-irrelevant to Phase 3 derivation: session mode, file
    // snapshots, attachments, titles, prompt echoes, turn timing, and
    // mobile-bridge/artifact metadata. Recorded as skipped (not thrown) so
    // an unrecognized *new* type is distinguishable from these in logs.
    case "mode":
    case "file-history-snapshot":
    case "attachment":
    case "ai-title":
    case "last-prompt":
    case "system":
    case "bridge-session":
    case "queue-operation":
    case "frame-link":
      results.push({
        kind: "skipped",
        reason: `ignored record type: ${rawType}`,
        rawType
      });
      break;
    default:
      results.push({
        kind: "skipped",
        reason: rawType ? `unrecognized record type: ${rawType}` : "record missing type",
        rawType
      });
  }

  return results;
};

const extractSessionMeta = (record: JsonRecord): ParsedRecord | null => {
  const cwd = asString(record.cwd);
  const sessionId = asString(record.sessionId ?? record.session_id);
  const version = asString(record.version);
  if (cwd === null && sessionId === null && version === null) {
    return null;
  }
  return { kind: "session-meta", cwd, sessionId, version };
};

const parseAssistantRecord = (record: JsonRecord): ParsedRecord[] => {
  const message = asRecord(record.message);
  if (!message) {
    return [{ kind: "skipped", reason: "assistant record missing message", rawType: "assistant" }];
  }

  const timestamp = asString(record.timestamp);
  const stopReason = asString(message.stop_reason);
  const content = message.content;

  if (stopReason === "tool_use" && Array.isArray(content)) {
    const toolUses = content
      .map((block) => asRecord(block))
      .filter((block): block is JsonRecord => block !== null && block.type === "tool_use")
      .map((block): ToolUseRecord => ({
        kind: "tool-use",
        toolUseId: asString(block.id) ?? "",
        toolName: asString(block.name) ?? "",
        input: block.input,
        timestamp
      }))
      .filter((block) => block.toolUseId !== "" && block.toolName !== "");

    if (toolUses.length > 0) {
      return toolUses;
    }
  }

  // Any stop reason other than an in-flight tool_use ends the assistant's
  // turn from the status engine's point of view (end_turn, max_tokens, ...).
  return [{ kind: "turn-ended", timestamp }];
};

const parseUserRecord = (record: JsonRecord): ParsedRecord[] => {
  const message = asRecord(record.message);
  const content = message?.content;
  if (!Array.isArray(content)) {
    return [{ kind: "skipped", reason: "user record missing content array", rawType: "user" }];
  }

  const resultBlocks = content
    .map((block) => asRecord(block))
    .filter((block): block is JsonRecord => block !== null && block.type === "tool_result");

  if (resultBlocks.length === 0) {
    return [{ kind: "skipped", reason: "user record has no tool_result blocks", rawType: "user" }];
  }

  const timestamp = asString(record.timestamp);
  // Claude Code's structured `toolUseResult` is a sibling of `message`, one
  // per line. It's only unambiguously attributable to a single tool_result
  // when exactly one appears in this line's content.
  const structuredResult = resultBlocks.length === 1 ? record.toolUseResult ?? null : null;

  return resultBlocks
    .map((block): ParsedRecord | null => {
      const toolUseId = asString(block.tool_use_id);
      if (!toolUseId) {
        return null;
      }
      return {
        kind: "tool-result",
        toolUseId,
        isError: block.is_error === true,
        toolUseResult: structuredResult,
        timestamp
      };
    })
    .filter((r): r is ParsedRecord => r !== null);
};
