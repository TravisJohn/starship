import { useEffect, useState } from "react";
import type { InitialPlanResult } from "../../shared/ipc";
import { MarkdownView } from "./MarkdownView";

type InitialPlanViewProps = {
  projectPath: string;
  projectName: string;
};

export const InitialPlanView = ({
  projectPath,
  projectName
}: InitialPlanViewProps): JSX.Element => {
  const [result, setResult] = useState<InitialPlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);

    void window.starship.project
      .getInitialPlan({ projectPath })
      .then((response) => {
        if (!cancelled) {
          setResult(response);
        }
      })
      .catch((getError: unknown) => {
        if (!cancelled) {
          setError(stringifyError(getError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-3">
        <h2 className="truncate text-sm font-semibold leading-none">Initial Plan</h2>
        <p className="mt-1 truncate text-xs text-zinc-500">
          What Claude proposed in its first reply to the cold prompt, captured as-is.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          className="m-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
        >
          {error}
        </div>
      ) : null}

      {!result && !error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="text-sm text-zinc-400">Loading…</p>
        </div>
      ) : null}

      {result && !result.markdown ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center">
          <p className="text-sm text-zinc-400">
            No plan captured yet for {projectName} — this fills in once Claude replies to the
            cold prompt in a launched session.
          </p>
        </div>
      ) : null}

      {result?.markdown ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <MarkdownView>{result.markdown}</MarkdownView>
        </div>
      ) : null}
    </section>
  );
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
