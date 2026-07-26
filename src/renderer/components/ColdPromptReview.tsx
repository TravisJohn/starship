import { useState } from "react";
import type { Project } from "../../shared/ipc";

type ColdPromptReviewProps = {
  project: Project;
  coldPrompt: string;
  onLaunch: (prompt: string, dangerouslySkipPermissions: boolean) => void;
  onShelf: () => void;
};

export const ColdPromptReview = ({
  project,
  coldPrompt,
  onLaunch,
  onShelf
}: ColdPromptReviewProps): JSX.Element => {
  const [prompt, setPrompt] = useState(coldPrompt);
  const [trustFolder, setTrustFolder] = useState(false);

  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-none">
            {project.name}
          </h1>
          <p className="mt-1 truncate text-xs leading-none text-zinc-400">
            Cold Prompt
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onShelf}
            className="h-8 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => onLaunch(prompt.trim(), trustFolder)}
            disabled={prompt.trim().length === 0}
            className="h-8 rounded-md bg-sky-500 px-3 text-sm font-medium text-zinc-950 hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            Launch Claude
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-5">
        <label className="flex min-h-0 flex-1 flex-col">
          <span className="mb-2 text-sm font-medium text-zinc-200">
            Prompt to fire
          </span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="min-h-0 flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
          />
        </label>

        <div className="mt-4 shrink-0 rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={trustFolder}
              onChange={(event) => setTrustFolder(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-sky-500 focus:ring-sky-300"
            />
            <span className="text-sm text-zinc-300">
              <span className="font-medium text-zinc-100">
                Trust this folder and skip permission prompts
              </span>
              <br />
              <span className="text-xs text-zinc-500">
                Launches with <code className="text-zinc-400">--dangerously-skip-permissions</code>.
                Only enable this for a project whose folder and contents you trust — Claude Code
                will act on file and command requests without asking first.
              </span>
            </span>
          </label>
        </div>
      </div>
    </section>
  );
};
