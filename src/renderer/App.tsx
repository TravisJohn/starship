import { useState } from "react";
import type { InceptionInterview, Project } from "../shared/ipc";
import { Inception } from "./components/Inception";
import { Shelf } from "./components/Shelf";
import { Terminal } from "./components/Terminal";

type AppView = "shelf" | "inception";

export const App = (): JSX.Element => {
  const [view, setView] = useState<AppView>("shelf");
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [_pendingInterview, setPendingInterview] =
    useState<InceptionInterview | null>(null);

  const completeInterview = (interview: InceptionInterview): void => {
    setPendingInterview(interview);
    setView("shelf");
  };

  if (activeProject) {
    return (
      <main className="flex h-screen min-h-0 flex-col bg-zinc-950 text-zinc-100">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold leading-none">
              {activeProject.name}
            </h1>
            <p className="mt-1 truncate text-xs leading-none text-zinc-400">
              {activeProject.path}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveProject(null)}
            className="ml-4 h-8 shrink-0 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            Shelf
          </button>
        </header>
        <section className="min-h-0 flex-1">
          <Terminal command="claude" cwd={activeProject.path} />
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
        />
      </main>
    );
  }

  return (
    <main className="h-screen min-h-0 bg-zinc-950">
      <Shelf
        onLaunch={setActiveProject}
        onNewProject={() => setView("inception")}
      />
    </main>
  );
};
