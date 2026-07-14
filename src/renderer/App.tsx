import { useCallback, useEffect, useRef, useState } from "react";
import type {
  InceptionCreateProjectResponse,
  InceptionDraftDocumentsResponse,
  InceptionInterview,
  ObservationSnapshot,
  ObservationStatus,
  Project,
  SessionBriefing
} from "../shared/ipc";
import { ActivityLog } from "./components/ActivityLog";
import { ColdPromptReview } from "./components/ColdPromptReview";
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

type ActiveSessionPanel = "terminal" | "fileMap" | "intent";

export const App = (): JSX.Element => {
  const [view, setView] = useState<AppView>("shelf");
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
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
  const [activePtySessionId, setActivePtySessionId] = useState<string | null>(null);
  const activePtySessionIdRef = useRef<string | null>(null);
  const [observation, setObservation] = useState<ObservationSnapshot | null>(null);
  const [statusByProjectId, setStatusByProjectId] = useState<Record<string, ObservationStatus>>({});
  const [exitFlow, setExitFlow] = useState<ExitFlow | null>(null);
  const [lastBriefing, setLastBriefing] = useState<SessionBriefing | null>(null);
  const [showLastBriefing, setShowLastBriefing] = useState(false);
  const [activeSessionPanel, setActiveSessionPanel] =
    useState<ActiveSessionPanel>("terminal");

  useEffect(() => {
    activePtySessionIdRef.current = activePtySessionId;
  }, [activePtySessionId]);

  useEffect(() => {
    return window.starship.observation.onSnapshot((snapshot) => {
      setStatusByProjectId((current) => ({ ...current, [snapshot.projectId]: snapshot.status }));
      if (snapshot.ptySessionId === activePtySessionIdRef.current) {
        setObservation(snapshot);
      }
    });
  }, []);

  // Stable identity across renders - Terminal's mount effect depends on this
  // prop, and an inline arrow here would re-fire that effect (and its
  // setObservation(null) reset) on every render this component causes,
  // including the very observation updates it's supposed to be receiving.
  const handleTerminalSessionId = useCallback((sessionId: string) => {
    setObservation(null);
    setActivePtySessionId(sessionId);
  }, []);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    let cancelled = false;
    setLastBriefing(null);
    setShowLastBriefing(false);

    void window.starship.briefing
      .getLatest({ projectId: activeSession.project.id })
      .then((briefing) => {
        if (!cancelled && briefing) {
          setLastBriefing(briefing);
          setShowLastBriefing(true);
        }
      })
      .catch(() => {
        // Not knowing "since last time" isn't worth surfacing as an error.
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession?.project.id]);

  // Quick escape for a session with nothing worth summarizing (e.g. an
  // accidental launch) - kills the pty via the same Terminal-unmount path
  // as exitAndSummarize, but skips the headless briefing call entirely.
  const exitToDashboard = (): void => {
    if (!activeSession) {
      return;
    }

    setActiveSession(null);
    setActivePtySessionId(null);
    setObservation(null);
    setView("shelf");
    setCreatedProject(null);
    setActiveSessionPanel("terminal");
  };

  const exitAndSummarize = (): void => {
    if (!activeSession) {
      return;
    }

    const project = activeSession.project;
    // Kill the pty immediately (unmounting Terminal) - never make leaving
    // wait on a headless call succeeding.
    setActiveSession(null);
    setActivePtySessionId(null);
    setObservation(null);
    // Whatever view led here (fresh Inception's "coldPrompt", or the
    // dashboard) is stale once exitFlow clears - reset to the dashboard so
    // the fallthrough after exitFlow doesn't land on a leftover screen.
    setView("shelf");
    setCreatedProject(null);
    setActiveSessionPanel("terminal");
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

  if (exitFlow) {
    return (
      <SessionBriefingScreen
        projectName={exitFlow.project.name}
        status={exitFlow.status}
        summary={exitFlow.summary}
        onContinue={() => setExitFlow(null)}
      />
    );
  }

  if (activeSession) {
    return (
      <main className="flex h-screen min-h-0 flex-col bg-zinc-950 pb-3 text-zinc-100">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <StatusDot status={observation?.status} />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-none">
                {activeSession.project.name}
              </h1>
              <p className="mt-1 truncate text-xs leading-none text-zinc-400">
                {observation?.status === "decision-needed" && observation.decision
                  ? observation.decision.summary
                  : activeSession.project.path}
              </p>
            </div>
          </div>
          <div className="ml-4 flex shrink-0 items-center gap-2">
            <div className="flex h-8 overflow-hidden rounded-md border border-zinc-700">
              <button
                type="button"
                onClick={() => setActiveSessionPanel("terminal")}
                className={`px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
                  activeSessionPanel === "terminal"
                    ? "bg-sky-500 text-zinc-950"
                    : "text-zinc-100 hover:text-sky-200"
                }`}
              >
                Terminal
              </button>
              <button
                type="button"
                onClick={() => setActiveSessionPanel("fileMap")}
                className={`border-l border-zinc-700 px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
                  activeSessionPanel === "fileMap"
                    ? "bg-sky-500 text-zinc-950"
                    : "text-zinc-100 hover:text-sky-200"
                }`}
              >
                File Map
              </button>
              <button
                type="button"
                onClick={() => setActiveSessionPanel("intent")}
                className={`border-l border-zinc-700 px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
                  activeSessionPanel === "intent"
                    ? "bg-sky-500 text-zinc-950"
                    : "text-zinc-100 hover:text-sky-200"
                }`}
              >
                Intent
              </button>
            </div>
            <button
              type="button"
              onClick={exitToDashboard}
              className="h-8 shrink-0 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              Back to Dashboard
            </button>
            <button
              type="button"
              onClick={exitAndSummarize}
              className="h-8 shrink-0 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              Exit &amp; Summarize
            </button>
          </div>
        </header>
        {lastBriefing && showLastBriefing ? (
          <div className="flex items-start justify-between gap-3 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2 text-xs text-zinc-300">
            <p className="min-w-0">
              <span className="font-semibold text-zinc-400">Since last time: </span>
              {lastBriefing.summary}
            </p>
            <button
              type="button"
              onClick={() => setShowLastBriefing(false)}
              aria-label="Dismiss"
              className="shrink-0 text-zinc-500 hover:text-zinc-300"
            >
              ✕
            </button>
          </div>
        ) : null}
        <RoadmapStrip projectPath={activeSession.project.path} />
        <ActivityLog projectId={activeSession.project.id} />
        <SubagentStrip agents={observation?.subagents ?? []} />
        <section
          className={`min-h-0 min-w-0 flex-1 ${
            activeSessionPanel === "terminal" ? "flex" : "hidden"
          }`}
        >
          <div className="min-h-0 min-w-0 flex-1">
            <Terminal
              command="claude"
              args={activeSession.args}
              cwd={activeSession.project.path}
              projectId={activeSession.project.id}
              projectName={activeSession.project.name}
              onSessionId={handleTerminalSessionId}
            />
          </div>
          <DevSidebar
            status={observation?.status ?? "no-session-detected"}
            tasks={observation?.kanban ?? []}
            projectId={activeSession.project.id}
          />
        </section>
        <section
          className={`min-h-0 min-w-0 flex-1 ${
            activeSessionPanel === "fileMap" ? "block" : "hidden"
          }`}
        >
          <FileMapView
            projectId={activeSession.project.id}
            projectPath={activeSession.project.path}
            projectName={activeSession.project.name}
          />
        </section>
        <section
          className={`min-h-0 min-w-0 flex-1 ${
            activeSessionPanel === "intent" ? "block" : "hidden"
          }`}
        >
          <IntentPanel
            projectId={activeSession.project.id}
            projectPath={activeSession.project.path}
            tasks={observation?.kanban ?? []}
          />
        </section>
      </main>
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
          onLaunch={(prompt) => {
            setActiveSessionPanel("terminal");
            setActiveSession({
              project: createdProject.project,
              args: [prompt]
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
    <main className="h-screen min-h-0 bg-zinc-950">
      <MissionDashboard
        onLaunch={(project, options) => {
          setActiveSessionPanel("terminal");
          setActiveSession({
            project,
            args: options.dangerouslySkipPermissions
              ? ["--dangerously-skip-permissions"]
              : [],
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
      />
    </main>
  );
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
