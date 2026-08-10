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
import { GitTreeOverlay } from "./GitTreeOverlay";
import { InitialPlanOverlay } from "./InitialPlanOverlay";
import { HealthBar } from "./HealthBar";
import { LoadingAnimation } from "./LoadingAnimation";
import { NarrativeJourneyOverlay } from "./NarrativeJourneyOverlay";
import { NotesOverlay } from "./NotesOverlay";
import { ProjectDetailPanel } from "./ProjectDetailPanel";
import { ProjectLogOverlay } from "./ProjectLogOverlay";
import { ProjectSummaryOverlay } from "./ProjectSummaryOverlay";
import { StatTiles } from "./StatTiles";
import { StatusDot } from "./StatusDot";

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
  const [gitTreeProject, setGitTreeProject] = useState<MissionProject | null>(null);
  const [initialPlanProject, setInitialPlanProject] = useState<MissionProject | null>(null);
  const [notesProject, setNotesProject] = useState<MissionProject | null>(null);
  const [projectLogProject, setProjectLogProject] =
    useState<MissionProject | null>(null);
  // Which row's actions show in the detail panel - defaults to the first
  // visible project once the dashboard loads, mirroring the mockup's
  // "always something selected" posture rather than starting empty.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detailPanelVisible, setDetailPanelVisible] = useState(true);

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

  const openGitTree = (project: MissionProject): void => {
    appendActivity({ eventType: "git_tree_opened", projectId: project.id });
    setGitTreeProject(project);
  };

  const openInitialPlan = (project: MissionProject): void => {
    appendActivity({ eventType: "initial_plan_opened", projectId: project.id });
    setInitialPlanProject(project);
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
  // Whichever project the detail panel shows - the explicitly selected one
  // if it's still visible, otherwise the first visible row, so the panel is
  // never left pointing at a project that scrolled out of view (e.g. after
  // toggling "Show ignored" off).
  const selectedProject =
    visibleProjects.find((project) => project.id === selectedProjectId) ??
    visibleProjects[0] ??
    null;

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
            onClick={() => setDetailPanelVisible((current) => !current)}
            className={`h-8 rounded-md border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
              detailPanelVisible
                ? "border-zinc-700 text-zinc-100 hover:border-sky-400 hover:text-sky-200"
                : "border-sky-500/70 text-sky-200"
            }`}
          >
            {detailPanelVisible ? "Hide Details" : "Show Details"}
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
          <>
            <StatTiles projects={dashboard.projects} statusByProjectId={statusByProjectId} />
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1 overflow-x-auto">
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
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProjects.map((project) => (
                      <tr
                        key={project.path}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedProjectId(project.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedProjectId(project.id);
                          }
                        }}
                        className={`cursor-pointer ${
                          project.ignored ? "text-zinc-500" : "text-zinc-100"
                        } ${
                          selectedProject?.path === project.path
                            ? "bg-sky-500/5 outline outline-1 -outline-offset-1 outline-sky-500/70"
                            : "hover:bg-zinc-900/60"
                        }`}
                      >
                        <td className="w-56 overflow-hidden border-b border-zinc-900 px-3 py-3">
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <p className="truncate font-medium">{project.name}</p>
                              {project.hasIntentLedger ? null : (
                                <span
                                  title="No intent captured for this project yet"
                                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                                />
                              )}
                            </div>
                            <p className="mt-1 truncate text-xs text-zinc-500">
                              {project.path}
                            </p>
                            {project.prdSummary ? (
                              <p
                                role="button"
                                tabIndex={0}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openSummary(project);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    event.stopPropagation();
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
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openProjectLog(project);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    event.stopPropagation();
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
                          <HealthBar counts={project.noteStatusCounts} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selectedProject && detailPanelVisible ? (
                <ProjectDetailPanel
                  project={selectedProject}
                  isRunning={runningProjectIds.has(selectedProject.id)}
                  agent={agentByProjectId[selectedProject.id] ?? "claude"}
                  model={modelByProjectId[selectedProject.id] ?? DEFAULT_CLAUDE_MODEL}
                  skipPermissions={skipPermissionsByProjectId[selectedProject.id] ?? false}
                  pendingNoteCount={pendingNoteCount(selectedProject.noteStatusCounts)}
                  onLaunch={() => void launchProject(selectedProject)}
                  onSelectAgent={(agent) => selectAgent(selectedProject.id, agent)}
                  onSelectModel={(model) => selectModel(selectedProject.id, model)}
                  onSetSkipPermissions={(enabled) =>
                    setSkipPermissions(selectedProject.id, enabled)
                  }
                  onOpenIntent={() => openIntent(selectedProject)}
                  onOpenFileMap={() => openFileMap(selectedProject)}
                  onOpenDecisionMap={() => openDecisionMap(selectedProject)}
                  onOpenNarrativeJourney={() => openNarrativeJourney(selectedProject)}
                  onOpenGitTree={() => openGitTree(selectedProject)}
                  onOpenInitialPlan={() => openInitialPlan(selectedProject)}
                  onOpenNotes={() => openNotes(selectedProject)}
                  onToggleIgnored={() => void setIgnored(selectedProject)}
                  isTogglingIgnored={busyPath === selectedProject.path}
                  formatBytes={formatBytes}
                  formatLastActivity={formatLastActivity}
                />
              ) : null}
            </div>
          </>
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
      <GitTreeOverlay
        project={gitTreeProject}
        onClose={() => setGitTreeProject(null)}
      />
      <InitialPlanOverlay
        project={initialPlanProject}
        onClose={() => setInitialPlanProject(null)}
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

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const appendActivity = (request: ActivityAppendRequest): void => {
  void window.starship.activity.append(request).catch(() => undefined);
};
