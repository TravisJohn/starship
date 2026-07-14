import { useEffect, useState } from "react";
import type { FileMapGenerateResponse } from "../../shared/ipc";
import { LoadingAnimation } from "./LoadingAnimation";

type FileMapViewProps = {
  projectId: string;
  projectPath: string;
  projectName: string;
};

export const FileMapView = ({
  projectId,
  projectPath,
  projectName
}: FileMapViewProps): JSX.Element => {
  const [result, setResult] = useState<FileMapGenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    setSavedPath(null);

    void window.starship.fileMap
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
      const response = await window.starship.fileMap.download({
        html: result.html,
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
    <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold leading-none">File Map</h2>
          <p className="mt-1 truncate text-xs text-zinc-500">
            {result ? `${result.fileCount} files in tree` : projectName}
          </p>
        </div>
        <button
          type="button"
          disabled={!result || saving}
          onClick={() => void download()}
          className={`h-8 shrink-0 rounded-md border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
            result && !saving
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
          label="Generating file map"
          className="min-h-0 flex-1"
          mediaClassName="h-36 w-64 max-w-[64vw]"
        />
      ) : null}

      {result ? (
        <iframe
          title={`${projectName} file map`}
          srcDoc={result.html}
          className="min-h-0 flex-1 border-0"
        />
      ) : null}
    </section>
  );
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
