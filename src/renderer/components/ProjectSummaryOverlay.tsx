import { useEffect } from "react";
import type { MissionProject } from "../../shared/ipc";

type ProjectSummaryOverlayProps = {
  project: MissionProject | null;
  onClose: () => void;
};

export const ProjectSummaryOverlay = ({
  project,
  onClose
}: ProjectSummaryOverlayProps): JSX.Element | null => {
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
        aria-labelledby="project-summary-title"
        className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-md border border-zinc-700 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="project-summary-title"
            className="min-w-0 text-base font-semibold text-zinc-100"
          >
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
        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
          {project.prdSummary}
        </p>
      </section>
    </div>
  );
};
