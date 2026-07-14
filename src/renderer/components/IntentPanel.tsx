import { useState } from "react";
import type { IntentAnnotationResult, KanbanTaskDto, TaskAnnotation } from "../../shared/ipc";

type IntentPanelProps = {
  projectId: string;
  projectPath: string;
  tasks: KanbanTaskDto[];
};

const SERVES_INTENT_LABEL: Record<TaskAnnotation["servesIntent"], string> = {
  purpose: "Purpose",
  successCriteria: "Success Criteria",
  acceptedTradeoffs: "Accepted Tradeoff",
  neverDo: "Never Do",
  none: ""
};

/**
 * Click-triggered only - never auto-fetches on mount or when `tasks`
 * changes. The Kanban ticks continuously during a live session; refiring a
 * headless call on every tick would be a headless call running in a loop,
 * which CLAUDE.md bans outright. The builder re-checks explicitly when they
 * want a fresh read, same posture as Exit & Summarize and the Project Log
 * Summary click.
 */
export const IntentPanel = ({ projectId, projectPath, tasks }: IntentPanelProps): JSX.Element => {
  const [result, setResult] = useState<IntentAnnotationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await window.starship.intent.annotate({ projectId, projectPath, tasks });
      setResult(response);
    } catch (checkError: unknown) {
      setError(stringifyError(checkError));
    } finally {
      setLoading(false);
    }
  };

  const annotationByTaskId = new Map(
    (result?.perTask ?? []).map((annotation) => [annotation.taskId, annotation])
  );

  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold leading-none">Intent</h2>
          <p className="mt-1 truncate text-xs text-zinc-500">
            Why the current plan is ordered this way, and whether it serves your stated intent.
          </p>
        </div>
        <button
          type="button"
          disabled={tasks.length === 0 || loading}
          onClick={() => void check()}
          className={`h-8 shrink-0 whitespace-nowrap rounded-md border px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
            tasks.length > 0 && !loading
              ? "border-zinc-700 text-zinc-100 hover:border-sky-400 hover:text-sky-200"
              : "cursor-not-allowed border-zinc-800 text-zinc-500"
          }`}
        >
          {loading ? "Checking…" : result ? "Re-check Against Intent" : "Check Against Intent"}
        </button>
      </header>

      {error ? (
        <div
          role="alert"
          className="m-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
        >
          {error}
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="text-sm text-zinc-400">No tasks yet — nothing to check against intent.</p>
        </div>
      ) : (
        <div className="flex-1 space-y-4 p-4">
          {result ? (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                result.overall.concerns
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-200"
              }`}
            >
              <p className="font-medium">{result.overall.verdict}</p>
              {result.overall.concerns ? (
                <p className="mt-1 text-amber-200">{result.overall.concerns}</p>
              ) : null}
            </div>
          ) : null}

          <ul className="space-y-2">
            {tasks.map((task) => {
              const annotation = annotationByTaskId.get(task.id);
              const chipLabel = annotation ? SERVES_INTENT_LABEL[annotation.servesIntent] : "";
              const flagged = annotation?.servesIntent === "neverDo" || Boolean(annotation?.note);

              return (
                <li
                  key={task.id}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    flagged
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-zinc-800 bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-100">{task.label}</span>
                    {chipLabel ? (
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          annotation?.servesIntent === "neverDo"
                            ? "border-amber-500/50 text-amber-200"
                            : "border-zinc-700 text-zinc-400"
                        }`}
                      >
                        {chipLabel}
                      </span>
                    ) : null}
                  </div>
                  {annotation ? (
                    <p className="mt-1 text-xs text-zinc-400">
                      {annotation.rationale ?? "No rationale recorded for this task."}
                    </p>
                  ) : null}
                  {annotation?.note ? (
                    <p className="mt-1 text-xs font-medium text-amber-200">{annotation.note}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
