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
//
// Renders just its content, not an outer shell - DevSidebar owns the
// surrounding <aside> and the Tasks/Notes tab toggle around it.
export const Kanban = ({ status, tasks }: KanbanProps): JSX.Element => {
  if (status === "no-session-detected") {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-center text-xs text-zinc-500">No session detected</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-3">
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
    </div>
  );
};
