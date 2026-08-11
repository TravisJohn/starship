import { useEffect } from "react";
import type { MissionProject } from "../../shared/ipc";
import { ContextExportView } from "./ContextExportView";

type ContextExportOverlayProps = {
  project: MissionProject | null;
  onClose: () => void;
};

export const ContextExportOverlay = ({
  project,
  onClose
}: ContextExportOverlayProps): JSX.Element | null => {
  useEffect(() => {
    if (!project) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [project, onClose]);

  if (!project) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="context-export-title"
        className="flex h-[82vh] w-full max-w-3xl min-w-0 flex-col overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4">
          <h2 id="context-export-title" className="truncate text-sm font-semibold">
            {project.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-8 shrink-0 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <ContextExportView
            request={{
              projectId: project.id,
              projectPath: project.path,
              projectName: project.name
            }}
          />
        </div>
      </section>
    </div>
  );
};
