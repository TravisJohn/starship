import { describe, expect, it } from "vitest";
import { KanbanReducer } from "./kanban";

describe("KanbanReducer", () => {
  it("materializes an incremental task only once the tool_result assigns an id", () => {
    const reducer = new KanbanReducer();

    const created = reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_1",
      toolName: "TaskCreate",
      input: { subject: "Fix the bug", description: "...", activeForm: "Fixing the bug" },
      timestamp: null
    });
    expect(created).toBe(false);
    expect(reducer.getState().tasks).toEqual([]);

    const resolved = reducer.handleRecord({
      kind: "tool-result",
      toolUseId: "toolu_1",
      isError: false,
      toolUseResult: { task: { id: "1", subject: "Fix the bug" } },
      timestamp: null
    });
    expect(resolved).toBe(true);
    expect(reducer.getState().tasks).toEqual([{ id: "1", label: "Fix the bug", status: "pending" }]);
  });

  it("does not create a task when the TaskCreate tool_result is an error", () => {
    const reducer = new KanbanReducer();
    reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_1",
      toolName: "TaskCreate",
      input: { subject: "Fix the bug" },
      timestamp: null
    });

    const changed = reducer.handleRecord({
      kind: "tool-result",
      toolUseId: "toolu_1",
      isError: true,
      toolUseResult: null,
      timestamp: null
    });

    expect(changed).toBe(false);
    expect(reducer.getState().tasks).toEqual([]);
  });

  it("moves a task through pending -> in_progress -> completed via TaskUpdate", () => {
    const reducer = new KanbanReducer();
    reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_1",
      toolName: "TaskCreate",
      input: { subject: "Fix the bug" },
      timestamp: null
    });
    reducer.handleRecord({
      kind: "tool-result",
      toolUseId: "toolu_1",
      isError: false,
      toolUseResult: { task: { id: "1" } },
      timestamp: null
    });

    reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_2",
      toolName: "TaskUpdate",
      input: { task_id: "1", status: "in_progress" },
      timestamp: null
    });
    expect(reducer.getState().tasks).toEqual([{ id: "1", label: "Fix the bug", status: "in_progress" }]);

    reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_3",
      toolName: "TaskUpdate",
      input: { taskId: "1", status: "completed" },
      timestamp: null
    });
    expect(reducer.getState().tasks).toEqual([{ id: "1", label: "Fix the bug", status: "completed" }]);
  });

  it("ignores a TaskUpdate for an unknown task id rather than fabricating a task", () => {
    const reducer = new KanbanReducer();
    const changed = reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_1",
      toolName: "TaskUpdate",
      input: { taskId: "99", status: "completed" },
      timestamp: null
    });
    expect(changed).toBe(false);
    expect(reducer.getState().tasks).toEqual([]);
  });

  it("materializes the bulk shape directly from the tool_use input, in order", () => {
    const reducer = new KanbanReducer();
    const changed = reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_1",
      toolName: "TaskCreate",
      input: {
        tasks: JSON.stringify([
          { content: "Step one", status: "in_progress" },
          { content: "Step two", status: "pending" }
        ])
      },
      timestamp: null
    });

    expect(changed).toBe(true);
    expect(reducer.getState().tasks).toEqual([
      { id: "toolu_1:0", label: "Step one", status: "in_progress" },
      { id: "toolu_1:1", label: "Step two", status: "pending" }
    ]);
  });

  it("ignores unrelated tool_use and tool_result records", () => {
    const reducer = new KanbanReducer();
    const changed = reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_1",
      toolName: "Bash",
      input: { command: "npm test" },
      timestamp: null
    });
    expect(changed).toBe(false);
    expect(reducer.getState().tasks).toEqual([]);
  });

  it("preserves creation order across multiple tasks", () => {
    const reducer = new KanbanReducer();
    for (const [toolUseId, subject, id] of [
      ["toolu_1", "First", "1"],
      ["toolu_2", "Second", "2"]
    ]) {
      reducer.handleRecord({
        kind: "tool-use",
        toolUseId,
        toolName: "TaskCreate",
        input: { subject },
        timestamp: null
      });
      reducer.handleRecord({
        kind: "tool-result",
        toolUseId,
        isError: false,
        toolUseResult: { task: { id } },
        timestamp: null
      });
    }

    expect(reducer.getState().tasks).toEqual([
      { id: "1", label: "First", status: "pending" },
      { id: "2", label: "Second", status: "pending" }
    ]);
  });
});
