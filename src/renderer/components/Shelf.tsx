import { useEffect, useState } from "react";
import type { Project } from "../../shared/ipc";

type ShelfProps = {
  onLaunch: (project: Project) => void;
};

export const Shelf = ({ onLaunch }: ShelfProps): JSX.Element => {
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
        <button
          type="button"
          onClick={() => void addProject()}
          className="h-9 rounded-md bg-emerald-500 px-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300"
        >
          Add Project
        </button>
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
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-zinc-100">
                    {project.name}
                  </h2>
                  <p className="mt-2 truncate text-xs text-zinc-400">
                    {project.path}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void launchProject(project.id)}
                  className="mt-4 h-9 w-full rounded-md border border-zinc-700 text-sm font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                >
                  Launch
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
