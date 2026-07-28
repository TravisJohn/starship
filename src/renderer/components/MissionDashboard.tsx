import { useEffect, useState } from "react";
import type {
  AgentKind,
  ActivityAppendRequest,
  ClaudeModelKind,
  MissionDashboardState,
  MissionProject,
  ObservationStatus,
  Project
} from "../../shared/ipc";
import { DecisionMapOverlay } from "./DecisionMapOverlay";
import { FileMapOverlay } from "./FileMapOverlay";
import { LoadingAnimation } from "./LoadingAnimation";
import { NarrativeJourneyOverlay } from "./NarrativeJourneyOverlay";
import { NOTE_STATUS_META, NOTE_STATUS_ORDER } from "../noteStatus";
import { NotesOverlay } from "./NotesOverlay";
import { ProjectLogOverlay } from "./ProjectLogOverlay";
import { ProjectSummaryOverlay } from "./ProjectSummaryOverlay";
import { StatusDot } from "./StatusDot";

/** Label shown in the model dropdown, keyed by the exact id passed to `claude --model`. */
const CLAUDE_MODEL_OPTIONS: { value: ClaudeModelKind; label: string }[] = [
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-opus-5", label: "Opus 5" },
  { value: "claude-fable-5", label: "Fable 5" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" }
];
const DEFAULT_CLAUDE_MODEL: ClaudeModelKind = "claude-sonnet-5";

type MissionDashboardProps = {
  onLaunch: (
    project: Project,
    options: { agent: AgentKind; model: ClaudeModelKind; dangerouslySkipPermissions: boolean }
  ) => void;
  onNewProject: (rootPath: string) => void;
  onEditIntent: (project: Project) => void;
  /** Live status for Starship-launched sessions in this app run. Rows with no live entry render idle. */
  statusByProjectId: Record<string, ObservationStatus>;
  /** Projects with a session currently running in the background (kept alive after "Back to Dashboard") - their row shows "Resume" instead of "Launch". */
  runningProjectIds: ReadonlySet<string>;
};

const emptyState: MissionDashboardState = {
  rootPath: null,
  projects: []
};

export const MissionDashboard = ({
  onLaunch,
  onNewProject,
  onEditIntent,
  statusByProjectId,
  runningProjectIds
}: MissionDashboardProps): JSX.Element => {
  const [dashboard, setDashboard] = useState<MissionDashboardState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [summaryProject, setSummaryProject] = useState<MissionProject | null>(null);
  const [agentByProjectId, setAgentByProjectId] = useState<Record<string, AgentKind>>(
    {}
  );
  const [modelByProjectId, setModelByProjectId] = useState<
    Record<string, ClaudeModelKind>
  >({});
  const [skipPermissionsByProjectId, setSkipPermissionsByProjectId] = useState<
    Record<string, boolean>
  >({});
  const [fileMapProject, setFileMapProject] = useState<MissionProject | null>(null);
  const [decisionMapProject, setDecisionMapProject] = useState<MissionProject | null>(null);
  const [narrativeJourneyProject, setNarrativeJourneyProject] = useState<MissionProject | null>(
    null
  );
  const [notesProject, setNotesProject] = useState<MissionProject | null>(null);
  const [projectLogProject, setProjectLogProject] =
    useState<MissionProject | null>(null);

  useEffect(() => {
    let cancelled = false;

    const MIN_LOADING_MS = 2500;
    const minDelay = new Promise<void>((resolve) => {
      window.setTimeout(resolve, MIN_LOADING_MS);
    });

    const fetchState = window.starship.dashboard
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
      });

    void Promise.all([fetchState, minDelay]).then(() => {
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
      if (state.rootPath) {
        appendActivity({
          eventType: "root_located",
          detail: { rootPath: state.rootPath }
        });
      }
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
      appendActivity({
        eventType: "project_ignored",
        projectId: updated.id,
        detail: { ignored: updated.ignored }
      });
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

  const launchProject = async (missionProject: MissionProject): Promise<void> => {
    setError(null);

    const agent = agentByProjectId[missionProject.id] ?? "claude";
    const model = modelByProjectId[missionProject.id] ?? DEFAULT_CLAUDE_MODEL;
    const dangerouslySkipPermissions =
      skipPermissionsByProjectId[missionProject.id] ?? false;

    try {
      const { project } = await window.starship.dashboard.launch({
        projectId: missionProject.id
      });
      appendActivity({
        eventType: "launch_fired",
        projectId: missionProject.id,
        detail: { agent, model, dangerouslySkipPermissions }
      });
      onLaunch(project, { agent, model, dangerouslySkipPermissions });
    } catch (launchError: unknown) {
      setError(stringifyError(launchError));
    }
  };

  const openIntent = (project: MissionProject): void => {
    appendActivity({ eventType: "intent_opened", projectId: project.id });
    onEditIntent(project);
  };

  const openSummary = (project: MissionProject): void => {
    appendActivity({ eventType: "summary_overlay_opened", projectId: project.id });
    setSummaryProject(project);
  };

  const openFileMap = (project: MissionProject): void => {
    appendActivity({ eventType: "file_map_opened", projectId: project.id });
    setFileMapProject(project);
  };

  const openDecisionMap = (project: MissionProject): void => {
    appendActivity({ eventType: "decision_map_opened", projectId: project.id });
    setDecisionMapProject(project);
  };

  const openNarrativeJourney = (project: MissionProject): void => {
    appendActivity({ eventType: "narrative_journey_opened", projectId: project.id });
    setNarrativeJourneyProject(project);
  };

  const openNotes = (project: MissionProject): void => {
    appendActivity({ eventType: "notes_opened", projectId: project.id });
    setNotesProject(project);
  };

  // Notes are edited inside the overlay with no live push back to the
  // dashboard row - refresh just that one row's data (cached size, so this
  // stays cheap) when the overlay closes, so the pending-note badge
  // reflects whatever changed without requiring a full Rescan.
  const closeNotes = (): void => {
    const project = notesProject;
    setNotesProject(null);
    if (!project) {
      return;
    }

    void window.starship.dashboard
      .refreshProject({ projectId: project.id })
      .then((updated) => {
        setDashboard((current) => ({
          ...current,
          projects: current.projects.map((item) =>
            item.id === updated.id ? updated : item
          )
        }));
      })
      .catch(() => {
        // Non-critical - the badge just stays as it was; next full
        // load/rescan will catch up.
      });
  };

  const openProjectLog = (project: MissionProject): void => {
    appendActivity({ eventType: "project_log_opened", projectId: project.id });
    setProjectLogProject(project);
  };

  const selectAgent = (projectId: string, agent: AgentKind): void => {
    setAgentByProjectId((current) => ({
      ...current,
      [projectId]: agent
    }));
    appendActivity({
      eventType: "agent_selected",
      projectId,
      detail: { agent }
    });
  };

  const selectModel = (projectId: string, model: ClaudeModelKind): void => {
    setModelByProjectId((current) => ({
      ...current,
      [projectId]: model
    }));
    appendActivity({
      eventType: "model_selected",
      projectId,
      detail: { model }
    });
  };

  const setSkipPermissions = (projectId: string, enabled: boolean): void => {
    setSkipPermissionsByProjectId((current) => ({
      ...current,
      [projectId]: enabled
    }));
    appendActivity({
      eventType: "skip_permissions_toggled",
      projectId,
      detail: { enabled }
    });
  };

  if (loading) {
    return (
      <LoadingAnimation
        label="Loading dashboard"
        className="h-full bg-black text-zinc-100"
        mediaClassName="h-48 w-80 max-w-[72vw]"
      />
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
            className="h-10 rounded-md bg-sky-500 px-4 text-sm font-medium text-zinc-950 hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300"
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
              className={`h-8 rounded-md border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
                showIgnored
                  ? "border-sky-500/70 text-sky-200"
                  : "border-zinc-700 text-zinc-100 hover:border-sky-400 hover:text-sky-200"
              }`}
            >
              Show ignored ({ignoredCount})
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onNewProject(dashboard.rootPath!)}
            className="h-9 rounded-md bg-sky-500 px-3 text-sm font-medium text-zinc-950 hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            New Project
          </button>
          <button
            type="button"
            onClick={() => void rescan()}
            className="h-8 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            Rescan
          </button>
          <button
            type="button"
            onClick={() => void locateRoot()}
            className="h-8 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
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
            <table className="w-full table-fixed border-separate border-spacing-0 text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="w-56 overflow-hidden border-b border-zinc-800 px-3 py-2 font-medium">
                    Project
                  </th>
                  <th className="w-40 overflow-hidden border-b border-zinc-800 px-3 py-2 font-medium">
                    Last Activity
                  </th>
                  <th className="w-20 overflow-hidden border-b border-zinc-800 px-3 py-2 font-medium">
                    Size
                  </th>
                  <th className="w-32 overflow-hidden border-b border-zinc-800 px-3 py-2 font-medium">
                    Activity
                  </th>
                  <th className="w-24 overflow-hidden border-b border-zinc-800 px-3 py-2 font-medium">
                    Status
                  </th>
                  <th className="w-32 overflow-hidden border-b border-zinc-800 px-3 py-2 font-medium">
                    Health
                  </th>
                  <th className="w-16 overflow-hidden border-b border-zinc-800 px-3 py-2 font-medium">
                    Ignore
                  </th>
                  <th className="w-72 overflow-hidden border-b border-zinc-800 px-3 py-2 font-medium">
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
                    <td className="w-56 overflow-hidden border-b border-zinc-900 px-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{project.name}</p>
                        <p className="mt-1 truncate text-xs text-zinc-500">
                          {project.path}
                        </p>
                        {project.prdSummary ? (
                          <p
                            role="button"
                            tabIndex={0}
                            onClick={() => openSummary(project)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openSummary(project);
                              }
                            }}
                            className="mt-1 cursor-pointer truncate text-xs text-sky-200 hover:text-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-300"
                          >
                            {project.prdSummary}
                          </p>
                        ) : null}
                        {project.projectLogEntry ? (
                          <p
                            role="button"
                            tabIndex={0}
                            onClick={() => openProjectLog(project)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openProjectLog(project);
                              }
                            }}
                            className="mt-1 cursor-pointer truncate text-xs text-sky-200 hover:text-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-300"
                          >
                            {project.projectLogEntry.title}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="w-40 overflow-hidden border-b border-zinc-900 px-3 py-3 text-zinc-300">
                      {formatLastActivity(project.lastActivityAt)}
                    </td>
                    <td className="w-20 overflow-hidden border-b border-zinc-900 px-3 py-3 text-zinc-300">
                      {formatBytes(project.sizeBytes)}
                    </td>
                    <td className="w-32 overflow-hidden border-b border-zinc-900 px-3 py-3">
                      <ActivityHeatmap days={project.activityHeatmap} />
                    </td>
                    <td className="w-24 overflow-hidden border-b border-zinc-900 px-3 py-3">
                      <div className="flex items-center gap-2">
                        <StatusDot status={statusByProjectId[project.id] ?? "idle"} />
                        <span className="text-xs text-zinc-400">
                          {statusByProjectId[project.id] ?? "idle"}
                        </span>
                      </div>
                    </td>
                    <td className="w-32 overflow-hidden border-b border-zinc-900 px-3 py-3">
                      <NoteHealth counts={project.noteStatusCounts} />
                    </td>
                    <td className="w-16 overflow-hidden border-b border-zinc-900 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={project.ignored}
                        disabled={busyPath === project.path}
                        onChange={() => void setIgnored(project)}
                        aria-label="Ignore"
                        className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-sky-500 focus:ring-sky-300"
                      />
                    </td>
                    <td className="w-72 overflow-hidden border-b border-zinc-900 px-3 py-3">
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={agentByProjectId[project.id] ?? "claude"}
                          onChange={(event) =>
                            selectAgent(project.id, event.target.value as AgentKind)
                          }
                          className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs font-medium text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-300"
                        >
                          <option value="claude">Claude</option>
                          <option value="codex" disabled>
                            Codex
                          </option>
                          <option value="antigravity" disabled>
                            Antigravity
                          </option>
                        </select>
                        <select
                          value={modelByProjectId[project.id] ?? DEFAULT_CLAUDE_MODEL}
                          onChange={(event) =>
                            selectModel(project.id, event.target.value as ClaudeModelKind)
                          }
                          disabled={(agentByProjectId[project.id] ?? "claude") !== "claude"}
                          title="Model used for this project's next Launch/Resume"
                          className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs font-medium text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {CLAUDE_MODEL_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <label className="inline-flex h-8 w-full items-center gap-2 whitespace-nowrap text-xs text-zinc-300">
                          <input
                            type="checkbox"
                            checked={skipPermissionsByProjectId[project.id] ?? false}
                            onChange={(event) =>
                              setSkipPermissions(project.id, event.target.checked)
                            }
                            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-sky-500 focus:ring-sky-300"
                          />
                          <span className="truncate">Skip permissions</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => void launchProject(project)}
                          className="h-8 w-full rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
                        >
                          {runningProjectIds.has(project.id) ? "Resume" : "Launch"}
                        </button>
                        <button
                          type="button"
                          disabled={project.lastActivityAt !== null}
                          title={
                            project.lastActivityAt !== null
                              ? "Already started - Intent is only shown for projects that haven't been launched yet"
                              : undefined
                          }
                          onClick={() => openIntent(project)}
                          className={`h-8 w-full truncate rounded-md border px-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
                            project.lastActivityAt !== null
                              ? "cursor-not-allowed border-zinc-800 text-zinc-500 opacity-60"
                              : "border-zinc-700 text-zinc-100 hover:border-sky-400 hover:text-sky-200"
                          }`}
                        >
                          Intent
                        </button>
                        <button
                          type="button"
                          onClick={() => openFileMap(project)}
                          className="h-8 w-full truncate rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
                        >
                          File Map
                        </button>
                        <button
                          type="button"
                          title="Decision Record"
                          onClick={() => openDecisionMap(project)}
                          className="h-8 w-full truncate rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
                        >
                          Decision Record
                        </button>
                        <button
                          type="button"
                          title="Narrative Journey"
                          onClick={() => openNarrativeJourney(project)}
                          className="h-8 w-full truncate rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
                        >
                          Narrative Journey
                        </button>
                        <button
                          type="button"
                          onClick={() => openNotes(project)}
                          className="col-span-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
                        >
                          Notes
                          {pendingNoteCount(project.noteStatusCounts) > 0 ? (
                            <span
                              title={`${pendingNoteCount(project.noteStatusCounts)} note${
                                pendingNoteCount(project.noteStatusCounts) === 1 ? "" : "s"
                              } not yet verified`}
                              className={`flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${noteCountBadgeClasses(
                                pendingNoteCount(project.noteStatusCounts)
                              )}`}
                            >
                              {pendingNoteCount(project.noteStatusCounts)}
                            </span>
                          ) : null}
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
      <ProjectSummaryOverlay
        project={summaryProject}
        onClose={() => setSummaryProject(null)}
      />
      <FileMapOverlay
        project={fileMapProject}
        onClose={() => setFileMapProject(null)}
      />
      <DecisionMapOverlay
        project={decisionMapProject}
        onClose={() => setDecisionMapProject(null)}
      />
      <NarrativeJourneyOverlay
        project={narrativeJourneyProject}
        onClose={() => setNarrativeJourneyProject(null)}
      />
      <NotesOverlay
        project={notesProject}
        onClose={closeNotes}
      />
      <ProjectLogOverlay
        project={projectLogProject}
        onClose={() => setProjectLogProject(null)}
      />
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

/** Notes not yet fully verified - the still-open action items for a project. */
const pendingNoteCount = (counts: MissionProject["noteStatusCounts"]): number =>
  counts.fresh + counts.implemented + counts.tested;

/**
 * Green -> amber -> red "how much is piling up here" signal for pending
 * (not-yet-verified) notes - a verified note doesn't count, so this is
 * specifically an action-item temperature, not a raw note count.
 */
const noteCountBadgeClasses = (count: number): string => {
  if (count >= 5) {
    return "bg-red-500 text-zinc-950";
  }
  if (count >= 3) {
    return "bg-amber-500 text-zinc-950";
  }
  return "bg-emerald-500 text-zinc-950";
};

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) {
    return "unknown";
  }

  if (bytes === 0) {
    return "0 KB";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
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

const HEATMAP_LEVELS = [
  "bg-zinc-800",
  "bg-sky-900",
  "bg-sky-700",
  "bg-sky-500"
];

const ActivityHeatmap = ({
  days
}: {
  days: MissionProject["activityHeatmap"];
}): JSX.Element => (
  <div className="flex items-center gap-1">
    {days.map((day) => {
      const level = day.count === 0 ? 0 : Math.min(day.count, HEATMAP_LEVELS.length - 1);
      return (
        <span
          key={day.date}
          title={`${day.date}: ${day.count} session${day.count === 1 ? "" : "s"}`}
          className={`h-3 w-3 rounded-sm ${HEATMAP_LEVELS[level]}`}
        />
      );
    })}
  </div>
);

/**
 * Per-project build-health strip: how many notes sit at each lifecycle
 * stage (fresh -> implemented -> tested -> verified). A project that's all
 * verified reads as healthy at a glance; one with a pile of fresh/untested
 * notes reads as at-risk, without needing to open the Notes overlay.
 */
const NoteHealth = ({ counts }: { counts: MissionProject["noteStatusCounts"] }): JSX.Element => {
  const total = NOTE_STATUS_ORDER.reduce((sum, status) => sum + counts[status], 0);
  if (total === 0) {
    return <span className="text-xs text-zinc-600">No notes</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {NOTE_STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
        <span
          key={status}
          title={`${counts[status]} ${NOTE_STATUS_META[status].label.toLowerCase()}`}
          className={`flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium ${NOTE_STATUS_META[status].badgeClass}`}
        >
          <span aria-hidden="true">{NOTE_STATUS_META[status].icon}</span>
          {counts[status]}
        </span>
      ))}
    </div>
  );
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const appendActivity = (request: ActivityAppendRequest): void => {
  void window.starship.activity.append(request).catch(() => undefined);
};
