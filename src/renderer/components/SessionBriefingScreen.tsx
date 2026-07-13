type SessionBriefingScreenProps = {
  projectName: string;
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
  projectName,
  status,
  summary,
  onContinue
}: SessionBriefingScreenProps): JSX.Element => {
  return (
    <main className="flex h-screen min-h-0 flex-col items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-xl rounded-lg border border-zinc-800 bg-zinc-900/60 p-6">
        <h1 className="text-sm font-semibold text-zinc-200">{projectName}</h1>
        <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">Since you started this session</p>

        <div className="mt-4 min-h-[4rem] text-sm leading-6 text-zinc-200">
          {status === "summarizing" ? (
            <p className="text-zinc-400">Summarizing what happened…</p>
          ) : (
            <p>{summary}</p>
          )}
        </div>

        <button
          type="button"
          onClick={onContinue}
          disabled={status === "summarizing"}
          className="mt-6 h-9 rounded-md bg-emerald-500 px-4 text-sm font-medium text-zinc-950 hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue to Dashboard
        </button>
      </div>
    </main>
  );
};
