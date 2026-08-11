import { useState } from "react";
import type { ContextExportRequest } from "../../shared/ipc";
import { LoadingAnimation } from "./LoadingAnimation";

type SessionBriefingScreenProps = {
  project: { id: string; name: string; path: string };
  status: "summarizing" | "ready";
  summary: string | null;
  onContinue: () => void;
};

/**
 * Shown after "Exit & Summarize": the pty is already killed by the time this
 * renders (Terminal unmounts immediately on exit), so this is purely a
 * review step before landing back on the dashboard - never a blocker on the
 * headless call succeeding.
 */
export const SessionBriefingScreen = ({
  project,
  status,
  summary,
  onContinue
}: SessionBriefingScreenProps): JSX.Element => {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  /*
   * Copies the same block the dashboard's Export Context produces - which, by
   * the time this screen is ready, already carries this session's outcomes and
   * next step. The briefing call that populated them has resolved before
   * status becomes "ready", so there is nothing to wait on here.
   *
   * Never fired automatically. The builder has just finished a session and may
   * well have something of their own on the clipboard.
   */
  const copyHandoff = (): void => {
    const request: ContextExportRequest = {
      projectId: project.id,
      projectPath: project.path,
      projectName: project.name
    };

    void window.starship.contextExport
      .build(request)
      .then((result) => window.starship.clipboard.writeText(result.text))
      .then(() => {
        setCopyState("copied");
        window.setTimeout(() => setCopyState("idle"), 2500);
      })
      .catch(() => {
        setCopyState("failed");
        window.setTimeout(() => setCopyState("idle"), 4000);
      });
  };

  return (
    <main className="flex h-screen min-h-0 flex-col items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-xl rounded-lg border border-zinc-800 bg-zinc-900/60 p-6">
        <h1 className="text-sm font-semibold text-zinc-200">{project.name}</h1>
        <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">Since you started this session</p>

        <div className="mt-4 min-h-[4rem] text-sm leading-6 text-zinc-200">
          {status === "summarizing" ? (
            <LoadingAnimation
              label="Summarizing what happened"
              className="h-36"
              mediaClassName="h-28 w-48 max-w-full"
            />
          ) : (
            <p>{summary}</p>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onContinue}
            disabled={status === "summarizing"}
            className="h-9 rounded-md bg-sky-500 px-4 text-sm font-medium text-zinc-950 hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue to Dashboard
          </button>
          <button
            type="button"
            onClick={copyHandoff}
            disabled={status === "summarizing"}
            title="Rules, intent, state and next steps as one block - paste it into whichever tool picks this up next"
            className="h-9 rounded-md border border-zinc-700 px-4 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copyState === "copied"
              ? "Copied"
              : copyState === "failed"
                ? "Couldn't copy"
                : "Copy Handoff"}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Copy Handoff puts this project's rules, intent, state and next step on the
          clipboard for whichever agent picks it up next.
        </p>
      </div>
    </main>
  );
};
