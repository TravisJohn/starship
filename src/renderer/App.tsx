import { useState } from "react";
import type {
  InceptionCreateProjectResponse,
  InceptionDraftDocumentsResponse,
  InceptionInterview,
  Project
} from "../shared/ipc";
import { ColdPromptReview } from "./components/ColdPromptReview";
import { Inception } from "./components/Inception";
import { InceptionReview } from "./components/InceptionReview";
import { IntentLedgerEditor } from "./components/IntentLedgerEditor";
import { Shelf } from "./components/Shelf";
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
};

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

  if (activeSession) {
    return (
      <main className="flex h-screen min-h-0 flex-col bg-zinc-950 text-zinc-100">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold leading-none">
              {activeSession.project.name}
            </h1>
            <p className="mt-1 truncate text-xs leading-none text-zinc-400">
              {activeSession.project.path}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveSession(null)}
            className="ml-4 h-8 shrink-0 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            Shelf
          </button>
        </header>
        <section className="min-h-0 flex-1">
          <Terminal
            command="claude"
            args={activeSession.args}
            cwd={activeSession.project.path}
          />
        </section>
      </main>
    );
  }

  if (view === "inception") {
    return (
      <main className="h-screen min-h-0 bg-zinc-950">
        <Inception
          onCancel={() => setView("shelf")}
          onComplete={completeInterview}
          onChooseParentDirectory={() =>
            window.starship.inception.chooseParentDirectory()
          }
        />
      </main>
    );
  }

  if (view === "drafting") {
    return (
      <main className="flex h-screen min-h-0 items-center justify-center bg-zinc-950 text-zinc-100">
        <p className="text-sm text-zinc-300">Drafting project brief</p>
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
          onLaunch={(prompt) =>
            setActiveSession({
              project: createdProject.project,
              args: [prompt]
            })
          }
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
      <Shelf
        onLaunch={(project) => setActiveSession({ project, args: [] })}
        onNewProject={() => setView("inception")}
        onEditIntent={(project) => {
          setIntentProject(project);
          setView("intentLedger");
        }}
      />
    </main>
  );
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
