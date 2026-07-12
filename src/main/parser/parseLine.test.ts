import { describe, expect, it } from "vitest";
import { parseSessionLine } from "./parseLine";

// Fixtures below mirror the exact structural shapes captured from real
// ~/.claude/projects/**/*.jsonl session files on this machine (Claude Code
// 2.1.191 - 2.1.207). Field values are synthesized; field names, nesting,
// and record shape are not.

describe("parseSessionLine", () => {
  it("parses an incremental TaskCreate tool_use and extracts session meta", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-07-12T19:00:00.000Z",
      cwd: "D:\\WEB PROJECTS\\starship",
      sessionId: "test-session",
      version: "2.1.207",
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_01",
            name: "TaskCreate",
            input: { subject: "Do the thing", description: "Details", activeForm: "Doing the thing" }
          }
        ]
      }
    });

    const records = parseSessionLine(line);

    expect(records).toContainEqual({
      kind: "session-meta",
      cwd: "D:\\WEB PROJECTS\\starship",
      sessionId: "test-session",
      version: "2.1.207"
    });
    expect(records).toContainEqual({
      kind: "tool-use",
      toolUseId: "toolu_01",
      toolName: "TaskCreate",
      input: { subject: "Do the thing", description: "Details", activeForm: "Doing the thing" },
      timestamp: "2026-07-12T19:00:00.000Z"
    });
  });

  it("parses a TaskCreate tool_result carrying the assigned id", () => {
    const line = JSON.stringify({
      type: "user",
      timestamp: "2026-07-12T19:00:01.000Z",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_01", content: "Task #1 created", is_error: false }
        ]
      },
      toolUseResult: { task: { id: "1", subject: "Do the thing" } }
    });

    const records = parseSessionLine(line);

    expect(records).toContainEqual({
      kind: "tool-result",
      toolUseId: "toolu_01",
      isError: false,
      toolUseResult: { task: { id: "1", subject: "Do the thing" } },
      timestamp: "2026-07-12T19:00:01.000Z"
    });
  });

  it("parses a TaskUpdate tool_use with snake_case task_id", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-07-12T19:00:02.000Z",
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "toolu_02", name: "TaskUpdate", input: { task_id: "1", status: "in_progress" } }]
      }
    });

    const records = parseSessionLine(line);

    expect(records).toContainEqual(
      expect.objectContaining({ kind: "tool-use", toolName: "TaskUpdate", input: { task_id: "1", status: "in_progress" } })
    );
  });

  it("parses an Agent tool_use and its completion result", () => {
    const useLine = JSON.stringify({
      type: "assistant",
      timestamp: "2026-07-12T19:00:03.000Z",
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "toolu_03", name: "Agent", input: { description: "Investigate the bug", prompt: "..." } }
        ]
      }
    });
    const resultLine = JSON.stringify({
      type: "user",
      timestamp: "2026-07-12T19:00:10.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_03", content: "done", is_error: false }]
      },
      toolUseResult: { status: "completed" }
    });

    expect(parseSessionLine(useLine)).toContainEqual(
      expect.objectContaining({ kind: "tool-use", toolName: "Agent" })
    );
    expect(parseSessionLine(resultLine)).toContainEqual(
      expect.objectContaining({ kind: "tool-result", toolUseId: "toolu_03", isError: false })
    );
  });

  it("treats a non-tool_use stop_reason as a turn-ended record", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-07-12T19:00:04.000Z",
      message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] }
    });

    expect(parseSessionLine(line)).toContainEqual({ kind: "turn-ended", timestamp: "2026-07-12T19:00:04.000Z" });
  });

  it("parses a permission-mode record", () => {
    const line = JSON.stringify({ type: "permission-mode", permissionMode: "bypassPermissions", sessionId: "test-session" });

    expect(parseSessionLine(line)).toContainEqual({ kind: "permission-mode", permissionMode: "bypassPermissions" });
  });

  it("skips known-but-irrelevant record types without throwing", () => {
    const line = JSON.stringify({ type: "mode", mode: "normal", sessionId: "test-session" });

    const records = parseSessionLine(line);
    expect(records).toContainEqual(expect.objectContaining({ kind: "skipped", rawType: "mode" }));
  });

  it("skips an unrecognized record type rather than throwing", () => {
    const line = JSON.stringify({ type: "some-future-record-type", data: 42 });

    expect(parseSessionLine(line)).toEqual([
      { kind: "skipped", reason: "unrecognized record type: some-future-record-type", rawType: "some-future-record-type" }
    ]);
  });

  it("skips malformed JSON rather than throwing", () => {
    expect(parseSessionLine("{not valid json")).toEqual([{ kind: "skipped", reason: "invalid JSON", rawType: null }]);
  });

  it("skips a blank line by returning no records", () => {
    expect(parseSessionLine("   ")).toEqual([]);
  });
});
