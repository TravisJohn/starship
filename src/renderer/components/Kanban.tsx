import type { KanbanTaskDto, KanbanTaskStatus, ObservationStatus } from "../../shared/ipc";

type KanbanProps = {
  status: ObservationStatus;
  tasks: KanbanTaskDto[];
};

const COLUMNS: Array<{ status: KanbanTaskStatus; label: string }> = [
  { status: "pending", label: "Pending" },
  { status: "in_progress", label: "In Progress" },
  { status: "completed", label: "Completed" }
];

// Read-only by design: Claude Code owns task state (CLAUDE.md), this pane
// only reflects it. No drag, no editing, no local mutation.
export const Kanban = ({ status, tasks }: KanbanProps): JSX.Element => {
  if (status === "no-session-detected") {
    return (
      <aside className="flex h-full min-h-0 w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
        <div className="flex h-full items-center justify-center p-4">
          <p className="text-center text-xs text-zinc-500">No session detected</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-h-0 w-72 shrink-0 flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-3">
      {COLUMNS.map((column) => {
        const columnTasks = tasks.filter((task) => task.status === column.status);
        return (
          <section key={column.status} className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {column.label} ({columnTasks.length})
            </h3>
            <ul className="space-y-2">
              {columnTasks.map((task) => (
                <li
                  key={task.id}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-200"
                >
                  {task.label}
                </li>
              ))}
              {columnTasks.length === 0 ? (
                <li className="text-xs text-zinc-600">—</li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </aside>
  );
};
