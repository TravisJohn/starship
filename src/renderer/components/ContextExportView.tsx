import { useEffect, useState } from "react";
import type { ContextExportRequest, ContextExportResult } from "../../shared/ipc";

type ContextExportViewProps = {
  request: ContextExportRequest;
};

/**
 * Shows the whole block before it is copied. Starship never hands anything off
 * unseen - the same reasoning that governs injected prompts applies here, since
 * this block becomes another agent's opening instructions.
 */
export const ContextExportView = ({ request }: ContextExportViewProps): JSX.Element => {
  const [result, setResult] = useState<ContextExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { projectId, projectPath, projectName } = request;

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    setCopied(false);

    void window.starship.contextExport
      .build({ projectId, projectPath, projectName })
      .then((response) => {
        if (!cancelled) {
          setResult(response);
        }
      })
      .catch((buildError: unknown) => {
        if (!cancelled) {
          setError(stringifyError(buildError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, projectPath, projectName]);

  const copy = (): void => {
    if (!result) {
      return;
    }

    void window.starship.clipboard.writeText(result.text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold leading-none">Context Export</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Rules, intent, state and next steps in one block. Paste it as the opening
              message of a new session, in any tool.
            </p>
          </div>
          <button
            type="button"
            onClick={copy}
            disabled={!result}
            className={`h-8 shrink-0 rounded-md px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
              result
                ? "bg-sky-500 text-zinc-950 hover:bg-sky-400"
                : "cursor-not-allowed border border-zinc-800 text-zinc-500"
            }`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {result ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-zinc-500">{formatBytes(result.bytes)}</span>
            {result.missingSections.length > 0 ? (
              <span className="text-amber-300">
                Not recorded: {result.missingSections.join(", ")}
              </span>
            ) : null}
            {result.trimNotice ? (
              <span className="text-amber-300">{result.trimNotice}</span>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error ? (
          <p className="text-sm text-red-300">{error}</p>
        ) : result ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-300">
            {result.text}
          </pre>
        ) : (
          <p className="text-sm text-zinc-500">Assembling...</p>
        )}
      </div>
    </section>
  );
};

const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
