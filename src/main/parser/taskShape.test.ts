import { describe, expect, it } from "vitest";
import {
  interpretTaskCreateInput,
  interpretTaskCreateResult,
  interpretTaskStopInput,
  interpretTaskUpdateInput
} from "./taskShape";

describe("interpretTaskCreateInput", () => {
  it("recognizes the incremental shape (subject/description/activeForm)", () => {
    expect(
      interpretTaskCreateInput({ subject: "Fix the bug", description: "...", activeForm: "Fixing the bug" })
    ).toEqual({ form: "incremental", label: "Fix the bug" });
  });

  it("recognizes the bulk shape (JSON-encoded tasks array)", () => {
    const input = {
      subagent_type: "general-purpose",
      tasks: JSON.stringify([
        { content: "Step one", status: "in_progress", priority: "high" },
        { content: "Step two", status: "pending", priority: "high" }
      ])
    };

    expect(interpretTaskCreateInput(input)).toEqual({
      form: "bulk",
      items: [
        { label: "Step one", status: "in_progress" },
        { label: "Step two", status: "pending" }
      ]
    });
  });

  it("defaults a bulk item's status to pending when missing or invalid", () => {
    const input = { tasks: JSON.stringify([{ content: "Step one" }]) };
    expect(interpretTaskCreateInput(input)).toEqual({ form: "bulk", items: [{ label: "Step one", status: "pending" }] });
  });

  it("degrades to unknown for an unrecognized shape rather than throwing", () => {
    expect(interpretTaskCreateInput({ somethingElse: true })).toEqual({ form: "unknown" });
    expect(interpretTaskCreateInput({ tasks: "{not valid json" })).toEqual({ form: "unknown" });
    expect(interpretTaskCreateInput(null)).toEqual({ form: "unknown" });
  });
});

describe("interpretTaskCreateResult", () => {
  it("extracts the assigned task id from a successful result", () => {
    expect(interpretTaskCreateResult({ task: { id: "1", subject: "Fix the bug" } }, false)).toEqual({
      assigned: true,
      taskId: "1"
    });
  });

  it("reports unassigned on error", () => {
    expect(interpretTaskCreateResult({ task: { id: "1" } }, true)).toEqual({ assigned: false });
  });

  it("reports unassigned when the result has no task id", () => {
    expect(interpretTaskCreateResult({}, false)).toEqual({ assigned: false });
    expect(interpretTaskCreateResult(null, false)).toEqual({ assigned: false });
  });
});

describe("interpretTaskUpdateInput", () => {
  it("accepts camelCase taskId (v2.1.191 shape)", () => {
    expect(interpretTaskUpdateInput({ taskId: "1", status: "completed" })).toEqual({ taskId: "1", status: "completed" });
  });

  it("accepts snake_case task_id (v2.1.207 shape observed live)", () => {
    expect(interpretTaskUpdateInput({ task_id: "1", status: "in_progress" })).toEqual({ taskId: "1", status: "in_progress" });
  });

  it("returns null for an invalid status or missing id", () => {
    expect(interpretTaskUpdateInput({ taskId: "1", status: "archived" })).toBeNull();
    expect(interpretTaskUpdateInput({ status: "completed" })).toBeNull();
    expect(interpretTaskUpdateInput(null)).toBeNull();
  });
});

describe("interpretTaskStopInput", () => {
  it("extracts the id regardless of casing", () => {
    expect(interpretTaskStopInput({ task_id: "bhu9rwddo" })).toEqual({ taskId: "bhu9rwddo" });
    expect(interpretTaskStopInput({ taskId: "bhu9rwddo" })).toEqual({ taskId: "bhu9rwddo" });
  });

  it("returns null when no id is present", () => {
    expect(interpretTaskStopInput({})).toBeNull();
  });
});
