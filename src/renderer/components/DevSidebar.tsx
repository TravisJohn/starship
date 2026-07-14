import { useState } from "react";
import type { KanbanTaskDto, ObservationStatus } from "../../shared/ipc";
import { Kanban } from "./Kanban";
import { NotesPanel } from "./NotesPanel";

type DevSidebarProps = {
  status: ObservationStatus;
  tasks: KanbanTaskDto[];
  projectId: string;
};

type SidebarTab = "tasks" | "notes";

/**
 * Owns the lower-right column's shell and the Tasks/Notes tab toggle.
 * Kanban (Claude-owned task state) and NotesPanel (the developer's own
 * scratchpad) are two unrelated data sources - this is just the shared
 * chrome around them, never mixing the two.
 */
export const DevSidebar = ({ status, tasks, projectId }: DevSidebarProps): JSX.Element => {
  const [tab, setTab] = useState<SidebarTab>("tasks");

  return (
    <aside className="flex h-full min-h-0 w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="flex h-9 shrink-0 items-center border-b border-zinc-800">
        <button
          type="button"
          onClick={() => setTab("tasks")}
          className={`h-full flex-1 text-xs font-medium focus:outline-none ${
            tab === "tasks"
              ? "border-b-2 border-sky-400 text-sky-200"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Tasks
        </button>
        <button
          type="button"
          onClick={() => setTab("notes")}
          className={`h-full flex-1 text-xs font-medium focus:outline-none ${
            tab === "notes"
              ? "border-b-2 border-sky-400 text-sky-200"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Notes
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "tasks" ? (
          <Kanban status={status} tasks={tasks} />
        ) : (
          <NotesPanel projectId={projectId} />
        )}
      </div>
    </aside>
  );
};
