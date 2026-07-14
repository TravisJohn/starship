import { useEffect, useState } from "react";
import type { MissionProject } from "../../shared/ipc";

type ProjectLogOverlayProps = {
  project: MissionProject | null;
  onClose: () => void;
};

export const ProjectLogOverlay = ({
  project,
  onClose
}: ProjectLogOverlayProps): JSX.Element | null => {
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    if (!project?.projectLogEntry) {
      setSummary(null);
      return;
    }

    let cancelled = false;
    setSummary(null);

    void window.starship.projectLog
      .summarize({
        title: project.projectLogEntry.title,
        body: project.projectLogEntry.body
      })
      .then((response) => {
        if (!cancelled) {
          setSummary(response.summary);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(project.projectLogEntry?.body ?? "");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [project]);

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

  if (!project?.projectLogEntry) {
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
        aria-labelledby="project-log-title"
        className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-md border border-zinc-700 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="project-log-title"
              className="text-base font-semibold text-zinc-100"
            >
              Where We Left Off
            </h2>
            <p className="mt-1 truncate text-xs text-zinc-500">
              {project.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 shrink-0 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            Close
          </button>
        </div>
        <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2">
          <p className="text-xs text-zinc-500">{project.projectLogEntry.date}</p>
          <p className="mt-1 text-sm font-medium text-zinc-200">
            {project.projectLogEntry.title}
          </p>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
          {summary ?? "Summarizing..."}
        </p>
      </section>
    </div>
  );
};
