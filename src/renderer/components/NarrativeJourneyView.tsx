import { useEffect, useState } from "react";
import type { NarrativeJourneyGenerateResponse } from "../../shared/ipc";
import { LoadingAnimation } from "./LoadingAnimation";

type NarrativeJourneyViewProps = {
  projectId: string;
  projectPath: string;
  projectName: string;
};

/**
 * Plain React, unlike File Map/Decision Map's generated-HTML-in-an-iframe
 * pattern - there's no canvas/SVG layout involved here, just prose, so a
 * normal component is simpler and there's nothing worth exporting as a
 * standalone interactive page (Download still saves the same text as
 * portable markdown).
 */
export const NarrativeJourneyView = ({
  projectId,
  projectPath,
  projectName
}: NarrativeJourneyViewProps): JSX.Element => {
  const [result, setResult] = useState<NarrativeJourneyGenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    setSavedPath(null);

    void window.starship.narrativeJourney
      .generate({ projectId, projectPath })
      .then((response) => {
        if (!cancelled) {
          setResult(response);
        }
      })
      .catch((generateError: unknown) => {
        if (!cancelled) {
          setError(stringifyError(generateError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, projectPath]);

  const download = async (): Promise<void> => {
    if (!result) {
      return;
    }

    setSaving(true);
    setSavedPath(null);
    try {
      const response = await window.starship.narrativeJourney.download({
        markdown: result.markdown,
        projectName
      });
      if (response.savedPath) {
        setSavedPath(response.savedPath);
      }
    } catch (downloadError: unknown) {
      setError(stringifyError(downloadError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold leading-none">Narrative Journey</h2>
          <p className="mt-1 truncate text-xs text-zinc-500">
            This project's whole history, told as one story - idea to where it stands now.
          </p>
        </div>
        <button
          type="button"
          disabled={!result || result.chapters.length === 0 || saving}
          onClick={() => void download()}
          className={`h-8 shrink-0 whitespace-nowrap rounded-md border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
            result && result.chapters.length > 0 && !saving
              ? "border-zinc-700 text-zinc-100 hover:border-sky-400 hover:text-sky-200"
              : "cursor-not-allowed border-zinc-800 text-zinc-500"
          }`}
        >
          {saving ? "Saving" : "Download"}
        </button>
      </header>

      {savedPath ? (
        <p className="shrink-0 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2 text-xs text-zinc-300">
          Saved to {savedPath}
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="m-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
        >
          {error}
        </div>
      ) : null}

      {!result && !error ? (
        <LoadingAnimation
          label="Writing this project's story"
          className="min-h-0 flex-1"
          mediaClassName="h-36 w-64 max-w-[64vw]"
        />
      ) : null}

      {result && result.chapters.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="text-sm text-zinc-400">
            Nothing to tell yet - this fills in once a few Exit &amp; Summarize sessions have run.
          </p>
        </div>
      ) : null}

      {result && result.chapters.length > 0 ? (
        <div className="flex-1 space-y-6 p-6">
          {result.chapters.map((chapter, index) => (
            <article key={index}>
              <h3 className="text-sm font-semibold text-sky-200">{chapter.title}</h3>
              <p className="mt-2 text-sm leading-7 text-zinc-200">{chapter.narrative}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
