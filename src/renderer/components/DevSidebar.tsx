import { NotesPanel } from "./NotesPanel";

type DevSidebarProps = {
  projectId: string;
};

/**
 * Lower-right column. Used to also host Claude's Kanban task state, but
 * that board stayed empty often enough in real sessions to be misleading
 * rather than useful (task extraction depends on Claude actually emitting
 * TaskCreate/TaskUpdate calls, which not every session does) - dropped
 * rather than left half-working. Notes (the developer's own scratchpad) is
 * unrelated to that data source and stays.
 */
export const DevSidebar = ({ projectId }: DevSidebarProps): JSX.Element => {
  return (
    <aside className="flex h-full min-h-0 w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="flex h-9 shrink-0 items-center border-b border-zinc-800 px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Notes
        </h2>
      </div>
      <div className="min-h-0 flex-1">
        <NotesPanel projectId={projectId} />
      </div>
    </aside>
  );
};
