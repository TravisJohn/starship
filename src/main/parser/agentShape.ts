type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null ? (value as JsonRecord) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * Interpretation of an `Agent` tool_use `input` (Claude Code's subagent
 * spawn tool - named `Agent` on this machine, not `Task` as the PRD's
 * source material assumed).
 */
export type AgentStartShape = { description: string; subagentType: string | null } | null;

export const interpretAgentStartInput = (input: unknown): AgentStartShape => {
  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const description = asString(record.description);
  if (!description) {
    return null;
  }

  return { description, subagentType: asString(record.subagent_type) };
};
