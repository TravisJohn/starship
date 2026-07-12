import { describe, expect, it } from "vitest";
import { SubagentReducer } from "./subagents";

describe("SubagentReducer", () => {
  it("adds a subagent as running when its Agent tool_use is seen", () => {
    const reducer = new SubagentReducer();
    const changed = reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_1",
      toolName: "Agent",
      input: { description: "Investigate the bug", prompt: "...", subagent_type: "Explore" },
      timestamp: null
    });

    expect(changed).toBe(true);
    expect(reducer.getState().agents).toEqual([
      { id: "toolu_1", description: "Investigate the bug", subagentType: "Explore", status: "running" }
    ]);
  });

  it("marks a subagent finished once its tool_result arrives", () => {
    const reducer = new SubagentReducer();
    reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_1",
      toolName: "Agent",
      input: { description: "Investigate the bug" },
      timestamp: null
    });

    const changed = reducer.handleRecord({
      kind: "tool-result",
      toolUseId: "toolu_1",
      isError: false,
      toolUseResult: null,
      timestamp: null
    });

    expect(changed).toBe(true);
    expect(reducer.getState().agents[0]?.status).toBe("finished");
  });

  it("treats an errored tool_result as finished too, not a distinct status", () => {
    const reducer = new SubagentReducer();
    reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_1",
      toolName: "Agent",
      input: { description: "Investigate the bug" },
      timestamp: null
    });

    reducer.handleRecord({ kind: "tool-result", toolUseId: "toolu_1", isError: true, toolUseResult: null, timestamp: null });
    expect(reducer.getState().agents[0]?.status).toBe("finished");
  });

  it("ignores tool_results that do not match a known subagent", () => {
    const reducer = new SubagentReducer();
    const changed = reducer.handleRecord({
      kind: "tool-result",
      toolUseId: "toolu_unknown",
      isError: false,
      toolUseResult: null,
      timestamp: null
    });
    expect(changed).toBe(false);
    expect(reducer.getState().agents).toEqual([]);
  });

  it("ignores unrelated tool_use records", () => {
    const reducer = new SubagentReducer();
    const changed = reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_1",
      toolName: "Bash",
      input: {},
      timestamp: null
    });
    expect(changed).toBe(false);
  });

  it("preserves start order across multiple subagents", () => {
    const reducer = new SubagentReducer();
    reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_1",
      toolName: "Agent",
      input: { description: "First" },
      timestamp: null
    });
    reducer.handleRecord({
      kind: "tool-use",
      toolUseId: "toolu_2",
      toolName: "Agent",
      input: { description: "Second" },
      timestamp: null
    });

    expect(reducer.getState().agents.map((a) => a.description)).toEqual(["First", "Second"]);
  });
});
