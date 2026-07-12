import type { SubagentEntryDto } from "../../shared/ipc";

type SubagentStripProps = {
  agents: SubagentEntryDto[];
};

// Read-only reflection of active Task/Agent tool calls (PRD §9 Phase 3).
// Nothing here is clickable or editable.
export const SubagentStrip = ({ agents }: SubagentStripProps): JSX.Element | null => {
  if (agents.length === 0) {
    return null;
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2">
      {agents.map((agent) => (
        <span
          key={agent.id}
          className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              agent.status === "running" ? "bg-amber-400" : "bg-emerald-400"
            }`}
          />
          {agent.description}
        </span>
      ))}
    </div>
  );
};
