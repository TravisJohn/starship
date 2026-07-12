import { useEffect, useState } from "react";
import type { ObservationStatus, Project } from "../../shared/ipc";
import { StatusDot } from "./StatusDot";

type ShelfProps = {
  onLaunch: (project: Project) => void;
  onNewProject: () => void;
  onEditIntent: (project: Project) => void;
  /** Live status for whichever project currently has (or most recently had, this app session) a Starship-launched session. Projects with no entry show a neutral dot - Phase 3 does not persist status across app restarts. */
  statusByProjectId: Record<string, ObservationStatus>;
};

export const Shelf = ({
  onLaunch,
  onNewProject,
  onEditIntent,
  statusByProjectId
}: ShelfProps): JSX.Element => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void window.starship.shelf.listProjects().then((nextProjects) => {
      if (!cancelled) {
        setProjects(nextProjects);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const addProject = async (): Promise<void> => {
    const project = await window.starship.shelf.addProject();
    if (!project) {
      return;
    }

    setProjects((current) => [
      project,
      ...current.filter((item) => item.id !== project.id)
    ]);
  };

  const launchProject = async (projectId: string): Promise<void> => {
    const { project } = await window.starship.shelf.launch({ projectId });
    onLaunch(project);
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-5">
        <div>
          <h1 className="text-sm font-semibold leading-none">Starship</h1>
          <p className="mt-1 text-xs leading-none text-zinc-400">Project Shelf</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNewProject}
            className="h-9 rounded-md bg-emerald-500 px-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            New Project
          </button>
          <button
            type="button"
            onClick={() => void addProject()}
            className="h-9 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            Add Folder
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {loading ? (
          <p className="text-sm text-zinc-400">Loading projects</p>
        ) : projects.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-400">No projects added</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <article
                key={project.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <StatusDot status={statusByProjectId[project.id]} />
                  <h2 className="truncate text-sm font-semibold text-zinc-100">
                    {project.name}
                  </h2>
                </div>
                <p className="mt-2 truncate text-xs text-zinc-400">
                  {project.path}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onEditIntent(project)}
                    className="h-9 rounded-md border border-zinc-700 text-sm font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  >
                    Intent
                  </button>
                  <button
                    type="button"
                    onClick={() => void launchProject(project.id)}
                    className="h-9 rounded-md border border-zinc-700 text-sm font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  >
                    Launch
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
