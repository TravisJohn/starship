import { describe, expect, it } from "vitest";
import { interpretAgentStartInput } from "./agentShape";

describe("interpretAgentStartInput", () => {
  it("extracts description and subagent type", () => {
    expect(interpretAgentStartInput({ description: "Investigate the bug", prompt: "...", subagent_type: "Explore" })).toEqual({
      description: "Investigate the bug",
      subagentType: "Explore"
    });
  });

  it("returns null when description is missing", () => {
    expect(interpretAgentStartInput({ prompt: "..." })).toBeNull();
    expect(interpretAgentStartInput(null)).toBeNull();
  });
});
