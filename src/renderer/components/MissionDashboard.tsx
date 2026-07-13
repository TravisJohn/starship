import { useEffect, useState } from "react";
import type {
  MissionDashboardState,
  MissionProject,
  ObservationStatus,
  Project
} from "../../shared/ipc";
import { StatusDot } from "./StatusDot";

type MissionDashboardProps = {
  onLaunch: (project: Project) => void;
  onNewProject: (rootPath: string) => void;
  onEditIntent: (project: Project) => void;
  /** Live status for Starship-launched sessions in this app run. Rows with no live entry render idle. */
  statusByProjectId: Record<string, ObservationStatus>;
};

const emptyState: MissionDashboardState = {
  rootPath: null,
  projects: []
};

export const MissionDashboard = ({
  onLaunch,
  onNewProject,
  onEditIntent,
  statusByProjectId
}: MissionDashboardProps): JSX.Element => {
  const [dashboard, setDashboard] = useState<MissionDashboardState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void window.starship.dashboard
      .getState()
      .then((state) => {
        if (!cancelled) {
          applyDashboardState(state, setDashboard, setError);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(stringifyError(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const locateRoot = async (): Promise<void> => {
    setError(null);
    const state = await window.starship.dashboard.locateRoot();
    if (state) {
      applyDashboardState(state, setDashboard, setError);
    }
  };

  const rescan = async (): Promise<void> => {
    setError(null);
    const state = await window.starship.dashboard.rescan();
    applyDashboardState(state, setDashboard, setError);
  };

  const setIgnored = async (project: MissionProject): Promise<void> => {
    const nextIgnored = !project.ignored;
    setBusyPath(project.path);
    setError(null);
    setDashboard((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.path === project.path ? { ...item, ignored: nextIgnored } : item
      )
    }));

    try {
      const updated = await window.starship.dashboard.setIgnored({
        projectPath: project.path,
        ignored: nextIgnored
      });
      setDashboard((current) => ({
        ...current,
        projects: current.projects.map((item) =>
          item.path === updated.path ? updated : item
        )
      }));
    } catch (toggleError: unknown) {
      setDashboard((current) => ({
        ...current,
        projects: current.projects.map((item) =>
          item.path === project.path ? project : item
        )
      }));
      setError(stringifyError(toggleError));
    } finally {
      setBusyPath(null);
    }
  };

  const launchProject = async (projectId: string): Promise<void> => {
    setError(null);

    try {
      const { project } = await window.starship.dashboard.launch({ projectId });
      onLaunch(project);
    } catch (launchError: unknown) {
      setError(stringifyError(launchError));
    }
  };

  if (loading) {
    return (
      <section className="flex h-full min-h-0 items-center justify-center bg-zinc-950 text-zinc-100">
        <p className="text-sm text-zinc-400">Loading dashboard</p>
      </section>
    );
  }

  if (!dashboard.rootPath) {
    return (
      <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
        <header className="flex h-14 shrink-0 items-center border-b border-zinc-800 px-5">
          <div>
            <h1 className="text-sm font-semibold leading-none">Starship</h1>
            <p className="mt-1 text-xs leading-none text-zinc-400">
              Mission Dashboard
            </p>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center p-5">
          <button
            type="button"
            onClick={() => void locateRoot()}
            className="h-10 rounded-md bg-emerald-500 px-4 text-sm font-medium text-zinc-950 hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            Locate Root
          </button>
        </div>
      </section>
    );
  }

  const ignoredCount = dashboard.projects.filter((project) => project.ignored).length;
  const visibleProjects = dashboard.projects.filter(
    (project) => showIgnored || !project.ignored
  );

  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-5">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold leading-none">Starship</h1>
          <p className="mt-1 truncate text-xs leading-none text-zinc-400">
            {dashboard.rootPath}
          </p>
        </div>
        <div className="ml-4 flex shrink-0 items-center gap-2">
          {ignoredCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowIgnored((current) => !current)}
              className={`h-8 rounded-md border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-300 ${
                showIgnored
                  ? "border-emerald-500/70 text-emerald-200"
                  : "border-zinc-700 text-zinc-100 hover:border-emerald-400 hover:text-emerald-200"
              }`}
            >
              Show ignored ({ignoredCount})
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onNewProject(dashboard.rootPath!)}
            className="h-9 rounded-md bg-emerald-500 px-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            New Project
          </button>
          <button
            type="button"
            onClick={() => void rescan()}
            className="h-8 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            Rescan
          </button>
          <button
            type="button"
            onClick={() => void locateRoot()}
            className="h-8 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            Re-point Root
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
          >
            {error}
          </div>
        ) : null}

        {dashboard.projects.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-zinc-400">No folders found under this root</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full table-fixed border-separate border-spacing-0 text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="border-b border-zinc-800 px-3 py-2 font-medium">
                    Project
                  </th>
                  <th className="w-48 border-b border-zinc-800 px-3 py-2 font-medium">
                    Last Activity
                  </th>
                  <th className="w-24 border-b border-zinc-800 px-3 py-2 font-medium">
                    Status
                  </th>
                  <th className="w-28 border-b border-zinc-800 px-3 py-2 font-medium">
                    Ignore
                  </th>
                  <th className="w-44 border-b border-zinc-800 px-3 py-2 font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleProjects.map((project) => (
                  <tr
                    key={project.path}
                    className={project.ignored ? "text-zinc-500" : "text-zinc-100"}
                  >
                    <td className="border-b border-zinc-900 px-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{project.name}</p>
                        <p className="mt-1 truncate text-xs text-zinc-500">
                          {project.path}
                        </p>
                      </div>
                    </td>
                    <td className="border-b border-zinc-900 px-3 py-3 text-zinc-300">
                      {formatLastActivity(project.lastActivityAt)}
                    </td>
                    <td className="border-b border-zinc-900 px-3 py-3">
                      <div className="flex items-center gap-2">
                        <StatusDot status={statusByProjectId[project.id] ?? "idle"} />
                        <span className="text-xs text-zinc-400">
                          {statusByProjectId[project.id] ?? "idle"}
                        </span>
                      </div>
                    </td>
                    <td className="border-b border-zinc-900 px-3 py-3">
                      <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={project.ignored}
                          disabled={busyPath === project.path}
                          onChange={() => void setIgnored(project)}
                          className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-300"
                        />
                        Ignore
                      </label>
                    </td>
                    <td className="border-b border-zinc-900 px-3 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={project.lastActivityAt !== null}
                          title={
                            project.lastActivityAt !== null
                              ? "Already started - Intent is only shown for projects that haven't been launched yet"
                              : undefined
                          }
                          onClick={() => onEditIntent(project)}
                          className={`h-8 rounded-md border px-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-300 ${
                            project.lastActivityAt !== null
                              ? "cursor-not-allowed border-zinc-800 text-zinc-500 opacity-60"
                              : "border-zinc-700 text-zinc-100 hover:border-emerald-400 hover:text-emerald-200"
                          }`}
                        >
                          Intent
                        </button>
                        <button
                          type="button"
                          onClick={() => void launchProject(project.id)}
                          className="h-8 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                        >
                          Launch
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};

const applyDashboardState = (
  state: MissionDashboardState,
  setDashboard: (state: MissionDashboardState) => void,
  setError: (error: string | null) => void
): void => {
  setDashboard(state);
  setError(state.scanError ?? null);
};

const formatLastActivity = (lastActivityAt: string | null): string => {
  if (!lastActivityAt) {
    return "never";
  }

  const date = new Date(lastActivityAt);
  if (Number.isNaN(date.getTime())) {
    return "never";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
