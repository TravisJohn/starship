import { interpretAgentStartInput } from "../parser";
import type { ParsedRecord } from "../parser";

export type SubagentStatus = "running" | "finished";

export type SubagentEntry = {
  id: string;
  description: string;
  subagentType: string | null;
  status: SubagentStatus;
};

export type SubagentState = {
  agents: SubagentEntry[];
};

/**
 * Derives the subagent strip's state (PRD §9 Phase 3: "active Task tool
 * calls with description and running/finished status" - the tool is named
 * `Agent` on this machine, see parser/agentShape.ts). Whether a finished
 * subagent errored isn't surfaced here: that's an operational distinction
 * PRD §9 didn't ask for at this altitude, and Phase 3 is read-only status,
 * not a place to invent scope.
 */
export class SubagentReducer {
  private readonly agentsById = new Map<string, SubagentEntry>();
  private readonly order: string[] = [];

  /** Returns true if this record changed the visible subagent strip state. */
  handleRecord(record: ParsedRecord): boolean {
    if (record.kind === "tool-use" && record.toolName === "Agent") {
      const shape = interpretAgentStartInput(record.input);
      if (!shape) {
        return false;
      }

      this.agentsById.set(record.toolUseId, {
        id: record.toolUseId,
        description: shape.description,
        subagentType: shape.subagentType,
        status: "running"
      });
      this.order.push(record.toolUseId);
      return true;
    }

    if (record.kind === "tool-result") {
      const agent = this.agentsById.get(record.toolUseId);
      if (!agent || agent.status === "finished") {
        return false;
      }

      agent.status = "finished";
      return true;
    }

    return false;
  }

  getState(): SubagentState {
    return { agents: this.order.map((id) => this.agentsById.get(id)!) };
  }
}
