import { describe, expect, it } from "vitest";
import { StatusEngine, summarizeToolInput } from "./statusEngine";

const makeClock = (startMs = 0) => {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

describe("StatusEngine", () => {
  it("is idle before anything has happened", () => {
    const engine = new StatusEngine();
    expect(engine.computeStatus(0)).toEqual({ status: "idle" });
  });

  it("is building while a pending tool call is within the grace period", () => {
    const clock = makeClock();
    const engine = new StatusEngine({ clockNowMs: clock.now, gracePeriodMs: 1500 });
    engine.handleRecord({ kind: "tool-use", toolUseId: "t1", toolName: "Bash", input: { command: "npm test" }, timestamp: null });

    expect(engine.computeStatus(clock.now())).toEqual({ status: "building" });
  });

  it("returns to idle once the pending tool call resolves", () => {
    const engine = new StatusEngine();
    engine.handleRecord({ kind: "tool-use", toolUseId: "t1", toolName: "Read", input: {}, timestamp: null });
    engine.handleRecord({ kind: "tool-result", toolUseId: "t1", isError: false, toolUseResult: null, timestamp: null });

    expect(engine.computeStatus(0)).toEqual({ status: "idle" });
  });

  it("never treats an always-auto-approved tool as decision-needed, even after the grace period", () => {
    const clock = makeClock();
    const engine = new StatusEngine({ clockNowMs: clock.now, gracePeriodMs: 1500 });
    engine.handleRecord({ kind: "tool-use", toolUseId: "t1", toolName: "Read", input: { file_path: "a.ts" }, timestamp: null });

    clock.advance(10_000);
    expect(engine.computeStatus(clock.now())).toEqual({ status: "building" });
  });

  it("flips a non-auto-approved tool to decision-needed only after the grace period elapses", () => {
    const clock = makeClock();
    const engine = new StatusEngine({ clockNowMs: clock.now, gracePeriodMs: 1500 });
    engine.handleRecord({ kind: "tool-use", toolUseId: "t1", toolName: "Bash", input: { command: "rm -rf node_modules" }, timestamp: null });

    expect(engine.computeStatus(clock.now())).toEqual({ status: "building" });

    clock.advance(1600);
    expect(engine.computeStatus(clock.now())).toEqual({
      status: "decision-needed",
      decision: { toolName: "Bash", summary: "run: rm -rf node_modules" }
    });
  });

  it("never needs a decision for a non-auto-approved tool under bypassPermissions", () => {
    const clock = makeClock();
    const engine = new StatusEngine({ clockNowMs: clock.now, gracePeriodMs: 1500 });
    engine.handleRecord({ kind: "permission-mode", permissionMode: "bypassPermissions" });
    engine.handleRecord({ kind: "tool-use", toolUseId: "t1", toolName: "Bash", input: { command: "rm -rf node_modules" }, timestamp: null });

    clock.advance(10_000);
    expect(engine.computeStatus(clock.now())).toEqual({ status: "building" });
  });

  it("auto-approves Edit/Write under acceptEdits but not Bash", () => {
    const clock = makeClock();
    const engine = new StatusEngine({ clockNowMs: clock.now, gracePeriodMs: 1500 });
    engine.handleRecord({ kind: "permission-mode", permissionMode: "acceptEdits" });
    engine.handleRecord({ kind: "tool-use", toolUseId: "t1", toolName: "Edit", input: { file_path: "a.ts" }, timestamp: null });
    engine.handleRecord({ kind: "tool-use", toolUseId: "t2", toolName: "Bash", input: { command: "npm install left-pad" }, timestamp: null });

    clock.advance(10_000);
    const result = engine.computeStatus(clock.now());
    expect(result.status).toBe("decision-needed");
    expect(result.status === "decision-needed" && result.decision.toolName).toBe("Bash");
  });

  it("treats a pending AskUserQuestion as decision-needed immediately, no grace period", () => {
    const engine = new StatusEngine();
    engine.handleRecord({
      kind: "tool-use",
      toolUseId: "t1",
      toolName: "AskUserQuestion",
      input: { questions: [{ question: "Which library should we use?" }] },
      timestamp: null
    });

    expect(engine.computeStatus(0)).toEqual({
      status: "decision-needed",
      decision: { toolName: "AskUserQuestion", summary: "Which library should we use?" }
    });
  });

  it("treats a pending ExitPlanMode as decision-needed immediately and quotes the plan", () => {
    const engine = new StatusEngine();
    engine.handleRecord({
      kind: "tool-use",
      toolUseId: "t1",
      toolName: "ExitPlanMode",
      input: { plan: "1. Add the endpoint. 2. Wire the UI." },
      timestamp: null
    });

    const result = engine.computeStatus(0);
    expect(result.status).toBe("decision-needed");
    expect(result.status === "decision-needed" && result.decision.summary).toContain("Add the endpoint");
  });

  it("does not let a long-running approved tool false-positive into decision-needed", () => {
    const clock = makeClock();
    const engine = new StatusEngine({ clockNowMs: clock.now, gracePeriodMs: 1500 });
    engine.handleRecord({ kind: "tool-use", toolUseId: "t1", toolName: "TaskUpdate", input: { task_id: "1", status: "in_progress" }, timestamp: null });

    clock.advance(60_000); // a slow approved call, e.g. long test suite via an allow-listed tool
    expect(engine.computeStatus(clock.now())).toEqual({ status: "building" });
  });
});

describe("summarizeToolInput", () => {
  it("falls back to naming the tool when no recognizable field is present", () => {
    expect(summarizeToolInput("SomeMcpTool", { foo: "bar" })).toBe("use SomeMcpTool");
  });

  it("truncates a long plan", () => {
    const longPlan = "x".repeat(500);
    const summary = summarizeToolInput("ExitPlanMode", { plan: longPlan });
    expect(summary.length).toBeLessThan(300);
  });
});
