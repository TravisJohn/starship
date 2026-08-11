import { useEffect, useState } from "react";
import type {
  ActiveSessionPanel,
  InceptionCreateProjectResponse,
  InceptionDraftDocumentsResponse,
  InceptionInterview,
  ObservationSnapshot,
  ObservationStatus,
  Project,
  SessionBriefing
} from "../shared/ipc";
import { ColdPromptReview } from "./components/ColdPromptReview";
import { DecisionMapView } from "./components/DecisionMapView";
import { DevSidebar } from "./components/DevSidebar";
import { FileMapView } from "./components/FileMapView";
import { Inception } from "./components/Inception";
import { InceptionReview } from "./components/InceptionReview";
import { IntentLedgerEditor } from "./components/IntentLedgerEditor";
import { IntentPanel } from "./components/IntentPanel";
import { LoadingAnimation } from "./components/LoadingAnimation";
import { MissionDashboard } from "./components/MissionDashboard";
import { RoadmapStrip } from "./components/RoadmapStrip";
import { SessionBriefingScreen } from "./components/SessionBriefingScreen";
import { StatusDot } from "./components/StatusDot";
import { SubagentStrip } from "./components/SubagentStrip";
import { Terminal } from "./components/Terminal";
import { TimelinePanel } from "./components/TimelinePanel";

type AppView =
  | "shelf"
  | "inception"
  | "drafting"
  | "review"
  | "coldPrompt"
  | "intentLedger";

type ActiveSession = {
  project: Project;
  args: string[];
  dangerouslySkipPermissions?: boolean;
};

type ExitFlow = {
  project: Project;
  status: "summarizing" | "ready";
  summary: string | null;
};

/**
 * How many Claude sessions Starship keeps alive at once. Each running
 * session pins a live xterm buffer + scrollback in the renderer, so this is
 * a memory/clarity ceiling, not a technical one - node-pty and the
 * observation pipeline (src/main/observation/) already key everything by
 * session id and happily run more.
 */
const MAX_ACTIVE_SESSIONS = 3;

export const App = (): JSX.Element => {
  const [view, setView] = useState<AppView>("shelf");
  // Every launched-and-not-yet-closed session, oldest first. Sessions
  // persist here (and their Terminal stays mounted, see the render below)
  // across "Back to Dashboard" - only closeSession/exitAndSummarize remove
  // an entry, which is what actually kills its pty.
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  // Which running session (by project id) is currently in the foreground.
  // null means the dashboard (or another pre-launch screen) is showing -
  // sessions keep running regardless.
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null);
  const [sessionPanelByProjectId, setSessionPanelByProjectId] = useState<
    Record<string, ActiveSessionPanel>
  >({});
  const [observationByProjectId, setObservationByProjectId] = useState<
    Record<string, ObservationSnapshot>
  >({});
  const [briefingByProjectId, setBriefingByProjectId] = useState<
    Record<string, SessionBriefing>
  >({});
  const [showBriefingByProjectId, setShowBriefingByProjectId] = useState<
    Record<string, boolean>
  >({});
  const [devSidebarVisibleByProjectId, setDevSidebarVisibleByProjectId] = useState<
    Record<string, boolean>
  >({});
  const [launchLimitNotice, setLaunchLimitNotice] = useState<string | null>(null);
  const [pendingInterview, setPendingInterview] =
    useState<InceptionInterview | null>(null);
  const [drafts, setDrafts] = useState<InceptionDraftDocumentsResponse | null>(
    null
  );
  const [createdProject, setCreatedProject] =
    useState<InceptionCreateProjectResponse | null>(null);
  const [intentProject, setIntentProject] = useState<Project | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [inceptionRootPath, setInceptionRootPath] = useState<string | null>(null);
  const [statusByProjectId, setStatusByProjectId] = useState<Record<string, ObservationStatus>>({});
  const [exitFlow, setExitFlow] = useState<ExitFlow | null>(null);

  useEffect(() => {
    return window.starship.observation.onSnapshot((snapshot) => {
      setStatusByProjectId((current) => ({ ...current, [snapshot.projectId]: snapshot.status }));
      setObservationByProjectId((current) => ({ ...current, [snapshot.projectId]: snapshot }));
    });
  }, []);

  const fetchLatestBriefing = (projectId: string): void => {
    void window.starship.briefing
      .getLatest({ projectId })
      .then((briefing) => {
        if (briefing) {
          setBriefingByProjectId((current) => ({ ...current, [projectId]: briefing }));
          setShowBriefingByProjectId((current) => ({ ...current, [projectId]: true }));
        }
      })
      .catch(() => {
        // Not knowing "since last time" isn't worth surfacing as an error.
      });
  };

  // Single entry point for every "start this project" action (dashboard
  // launch and fresh-project cold prompt alike). Re-focuses an
  // already-running project instead of double-launching it, and enforces
  // MAX_ACTIVE_SESSIONS before adding a new one.
  const launchSession = (session: ActiveSession): void => {
    const projectId = session.project.id;

    if (activeSessions.some((existing) => existing.project.id === projectId)) {
      setFocusedProjectId(projectId);
      setView("shelf");
      setCreatedProject(null);
      return;
    }

    if (activeSessions.length >= MAX_ACTIVE_SESSIONS) {
      setLaunchLimitNotice(
        `${MAX_ACTIVE_SESSIONS} sessions are already running. Close one (from the running-sessions strip, or File > Close Session) before starting another.`
      );
      return;
    }

    setSessionPanelByProjectId((current) => ({ ...current, [projectId]: "terminal" }));
    setDevSidebarVisibleByProjectId((current) => ({ ...current, [projectId]: true }));
    setActiveSessions((current) => [...current, session]);
    setFocusedProjectId(projectId);
    setView("shelf");
    setCreatedProject(null);
    fetchLatestBriefing(projectId);
  };

  const forgetSession = (projectId: string): void => {
    setSessionPanelByProjectId((current) => omit(current, projectId));
    setObservationByProjectId((current) => omit(current, projectId));
    setBriefingByProjectId((current) => omit(current, projectId));
    setShowBriefingByProjectId((current) => omit(current, projectId));
    setDevSidebarVisibleByProjectId((current) => omit(current, projectId));
  };

  // Removing the entry unmounts that session's <Terminal>, whose own
  // cleanup effect kills the pty - this is the one and only kill path, kept
  // symmetric with the mount-time spawn in Terminal.tsx.
  const closeSession = (projectId: string): void => {
    setActiveSessions((current) => current.filter((session) => session.project.id !== projectId));
    forgetSession(projectId);
    setFocusedProjectId((current) => (current === projectId ? null : current));
  };

  const exitAndSummarize = (): void => {
    const session = activeSessions.find((entry) => entry.project.id === focusedProjectId);
    if (!session) {
      return;
    }

    const project = session.project;
    // Kill the pty immediately (unmounting Terminal) - never make leaving
    // wait on a headless call succeeding.
    closeSession(project.id);
    setView("shelf");
    setCreatedProject(null);
    setExitFlow({ project, status: "summarizing", summary: null });

    void window.starship.briefing
      .generate({ projectId: project.id, projectPath: project.path })
      .then((briefing) => {
        setExitFlow({ project, status: "ready", summary: briefing.summary });
      })
      .catch((error: unknown) => {
        setExitFlow({
          project,
          status: "ready",
          summary: `Couldn't generate a summary: ${stringifyError(error)}`
        });
      });
  };

  const focusedSession =
    activeSessions.find((session) => session.project.id === focusedProjectId) ?? null;

  // Keeps the native File/Edit/View/Window menu (src/main/menu.ts) in sync
  // with the *focused* session - background sessions don't affect it.
  useEffect(() => {
    void window.starship.menu.setSessionState({
      active: focusedSession !== null,
      projectName: focusedSession?.project.name ?? null,
      panel: (focusedProjectId && sessionPanelByProjectId[focusedProjectId]) || "terminal",
      devSidebarVisible: focusedProjectId
        ? (devSidebarVisibleByProjectId[focusedProjectId] ?? true)
        : true
    });
  }, [focusedSession, focusedProjectId, sessionPanelByProjectId, devSidebarVisibleByProjectId]);

  // The View menu's panel items and File menu's session actions replaced
  // the old floating button row - this is where their clicks land.
  useEffect(() => {
    return window.starship.menu.onAction((action) => {
      if (action.type === "setPanel") {
        if (focusedProjectId) {
          setSessionPanelByProjectId((current) => ({
            ...current,
            [focusedProjectId]: action.panel
          }));
        }
      } else if (action.type === "backToDashboard") {
        setFocusedProjectId(null);
      } else if (action.type === "closeSession") {
        if (focusedProjectId) {
          closeSession(focusedProjectId);
        }
      } else if (action.type === "exitAndSummarize") {
        exitAndSummarize();
      } else if (action.type === "toggleDevSidebar") {
        if (focusedProjectId) {
          setDevSidebarVisibleByProjectId((current) => ({
            ...current,
            [focusedProjectId]: !(current[focusedProjectId] ?? true)
          }));
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedProjectId, activeSessions]);

  const completeInterview = (interview: InceptionInterview): void => {
    setPendingInterview(interview);
    setCreateError(null);
    setView("drafting");
    void window.starship.inception
      .draftDocuments({ interview })
      .then((nextDrafts) => {
        setDrafts(nextDrafts);
        setView("review");
      })
      .catch((error: unknown) => {
        setCreateError(stringifyError(error));
        setView("inception");
      });
  };

  const createProject = (prd: string, claude: string): void => {
    if (!pendingInterview) {
      return;
    }

    setCreating(true);
    setCreateError(null);
    void window.starship.inception
      .createProject({ interview: pendingInterview, prd, claude })
      .then((result) => {
        setCreatedProject(result);
        setView("coldPrompt");
      })
      .catch((error: unknown) => {
        setCreateError(stringifyError(error));
      })
      .finally(() => {
        setCreating(false);
      });
  };

  const runningProjectIds = new Set(activeSessions.map((session) => session.project.id));

  const renderPrimaryView = (): JSX.Element | null => {
    if (exitFlow) {
      return (
        <SessionBriefingScreen
          project={exitFlow.project}
          status={exitFlow.status}
          summary={exitFlow.summary}
          onContinue={() => setExitFlow(null)}
        />
      );
    }

    if (view === "inception") {
      return (
        <main className="h-screen min-h-0 bg-zinc-950">
          <Inception
            rootPath={inceptionRootPath}
            initialInterview={pendingInterview}
            onCancel={() => {
              setPendingInterview(null);
              setView("shelf");
            }}
            onComplete={completeInterview}
          />
        </main>
      );
    }

    if (view === "drafting") {
      return (
        <main className="flex h-screen min-h-0 items-center justify-center bg-zinc-950 text-zinc-100">
          <LoadingAnimation label="Drafting project brief" />
        </main>
      );
    }

    if (view === "review" && pendingInterview && drafts) {
      return (
        <main className="h-screen min-h-0 bg-zinc-950">
          <InceptionReview
            interview={pendingInterview}
            drafts={drafts}
            onBack={() => setView("inception")}
            onCreate={createProject}
            busy={creating}
            error={createError}
          />
        </main>
      );
    }

    if (view === "coldPrompt" && createdProject) {
      return (
        <main className="h-screen min-h-0 bg-zinc-950">
          <ColdPromptReview
            project={createdProject.project}
            coldPrompt={createdProject.coldPrompt}
            onShelf={() => setView("shelf")}
            onLaunch={(prompt, dangerouslySkipPermissions) => {
              launchSession({
                project: createdProject.project,
                args: dangerouslySkipPermissions
                  ? ["--dangerously-skip-permissions", prompt]
                  : [prompt],
                dangerouslySkipPermissions
              });
            }}
          />
        </main>
      );
    }

    if (view === "intentLedger" && intentProject) {
      return (
        <main className="h-screen min-h-0 bg-zinc-950">
          <IntentLedgerEditor
            project={intentProject}
            onClose={() => setView("shelf")}
          />
        </main>
      );
    }

    return (
      <main className="flex h-screen min-h-0 flex-col bg-zinc-950">
        {activeSessions.length > 0 ? (
          <div
            key="running-sessions-strip"
            className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2"
          >
            <span className="text-xs font-medium text-zinc-500">
              Running ({activeSessions.length}/{MAX_ACTIVE_SESSIONS}):
            </span>
            {activeSessions.map((session) => (
              <div
                key={session.project.id}
                className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 py-1 pl-2 pr-1 text-xs"
              >
                <StatusDot status={statusByProjectId[session.project.id] ?? "idle"} />
                <button
                  type="button"
                  onClick={() => setFocusedProjectId(session.project.id)}
                  className="text-zinc-200 hover:text-sky-300"
                >
                  {session.project.name}
                </button>
                <button
                  type="button"
                  onClick={() => closeSession(session.project.id)}
                  aria-label={`Close ${session.project.name}`}
                  title="Close session"
                  className="rounded px-1 text-zinc-500 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div key="dashboard-wrap" className="min-h-0 flex-1">
          <MissionDashboard
            onLaunch={(project, options) => {
              launchSession({
                project,
                args: [
                  ...(options.dangerouslySkipPermissions ? ["--dangerously-skip-permissions"] : []),
                  "--model",
                  options.model
                ],
                dangerouslySkipPermissions: options.dangerouslySkipPermissions
              });
            }}
            onNewProject={(rootPath) => {
              setInceptionRootPath(rootPath);
              setPendingInterview(null);
              setView("inception");
            }}
            onEditIntent={(project) => {
              setIntentProject(project);
              setView("intentLedger");
            }}
            statusByProjectId={statusByProjectId}
            runningProjectIds={runningProjectIds}
          />
        </div>
      </main>
    );
  };

  return (
    <>
      {activeSessions.map((session) => {
        const projectId = session.project.id;
        const isFocused = focusedProjectId === projectId;
        const panel = sessionPanelByProjectId[projectId] ?? "terminal";
        const observation = observationByProjectId[projectId] ?? null;
        const briefing = briefingByProjectId[projectId] ?? null;
        const showBriefing = showBriefingByProjectId[projectId] ?? false;
        const devSidebarVisible = devSidebarVisibleByProjectId[projectId] ?? true;

        return (
          <main
            key={projectId}
            className={`h-screen min-h-0 flex-col bg-zinc-950 pb-3 text-zinc-100 ${
              isFocused ? "flex" : "hidden"
            }`}
          >
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
              <div className="flex min-w-0 items-center gap-2">
                <StatusDot status={observation?.status} />
                <div className="min-w-0">
                  <h1 className="truncate text-sm font-semibold leading-none">
                    {session.project.name}
                  </h1>
                  <p className="mt-1 truncate text-xs leading-none text-zinc-400">
                    {observation?.status === "decision-needed" && observation.decision
                      ? observation.decision.summary
                      : session.project.path}
                  </p>
                </div>
              </div>
            </header>
            {briefing && showBriefing ? (
              <div className="flex items-start justify-between gap-3 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2 text-xs text-zinc-300">
                <p className="min-w-0">
                  <span className="font-semibold text-zinc-400">Since last time: </span>
                  {briefing.summary}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setShowBriefingByProjectId((current) => ({ ...current, [projectId]: false }))
                  }
                  aria-label="Dismiss"
                  className="shrink-0 text-zinc-500 hover:text-zinc-300"
                >
                  ✕
                </button>
              </div>
            ) : null}
            <RoadmapStrip projectPath={session.project.path} />
            <SubagentStrip agents={observation?.subagents ?? []} />
            <section
              className={`min-h-0 min-w-0 flex-1 ${panel === "terminal" ? "flex" : "hidden"}`}
            >
              <div className="min-h-0 min-w-0 flex-1">
                <Terminal
                  command="claude"
                  args={session.args}
                  cwd={session.project.path}
                  projectId={session.project.id}
                  projectName={session.project.name}
                />
              </div>
              {devSidebarVisible ? <DevSidebar projectId={session.project.id} /> : null}
            </section>
            <section
              className={`min-h-0 min-w-0 flex-1 ${panel === "fileMap" ? "block" : "hidden"}`}
            >
              <FileMapView
                projectId={session.project.id}
                projectPath={session.project.path}
                projectName={session.project.name}
              />
            </section>
            <section
              className={`min-h-0 min-w-0 flex-1 ${panel === "intent" ? "block" : "hidden"}`}
            >
              <IntentPanel
                projectId={session.project.id}
                projectPath={session.project.path}
                projectName={session.project.name}
                tasks={observation?.kanban ?? []}
              />
            </section>
            <section
              className={`min-h-0 min-w-0 flex-1 ${panel === "timeline" ? "block" : "hidden"}`}
            >
              <TimelinePanel projectId={session.project.id} />
            </section>
            <section
              className={`min-h-0 min-w-0 flex-1 ${panel === "decisionMap" ? "block" : "hidden"}`}
            >
              <DecisionMapView
                projectId={session.project.id}
                projectPath={session.project.path}
                projectName={session.project.name}
              />
            </section>
          </main>
        );
      })}
      {focusedProjectId === null ? renderPrimaryView() : null}
      {launchLimitNotice ? (
        <div className="fixed right-4 top-4 z-50 flex max-w-sm items-start gap-3 rounded-md border border-amber-700/50 bg-amber-950/90 px-4 py-3 text-sm text-amber-200 shadow-lg">
          <p className="min-w-0">{launchLimitNotice}</p>
          <button
            type="button"
            onClick={() => setLaunchLimitNotice(null)}
            aria-label="Dismiss"
            className="shrink-0 text-amber-400 hover:text-amber-100"
          >
            ✕
          </button>
        </div>
      ) : null}
    </>
  );
};

const omit = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) {
    return record;
  }
  const next = { ...record };
  delete next[key];
  return next;
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
