import { useEffect, useState } from "react";
import type { SessionBriefingHistoryEntry } from "../../shared/ipc";

type TimelinePanelProps = {
  projectId: string;
};

/**
 * The idea->reality narrative from PRD §7: every past "Exit & Summarize"
 * briefing for this project, oldest first, never backfilled. Just a DB read
 * (no headless call), so it's safe to fetch on mount/tab-switch rather than
 * needing a click-trigger like Intent's annotation pass.
 */
export const TimelinePanel = ({ projectId }: TimelinePanelProps): JSX.Element => {
  const [entries, setEntries] = useState<SessionBriefingHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);

    void window.starship.briefing
      .listHistory({ projectId })
      .then((history) => {
        if (!cancelled) {
          setEntries(history);
        }
      })
      .catch((historyError: unknown) => {
        if (!cancelled) {
          setError(stringifyError(historyError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto bg-zinc-950 text-zinc-100">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-3">
        <h2 className="truncate text-sm font-semibold leading-none">Timeline</h2>
        <p className="mt-1 truncate text-xs text-zinc-500">
          Every "Exit &amp; Summarize" for this project, in order - idea to decisions to reality.
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

      {entries === null && !error ? (
        <p className="p-4 text-sm text-zinc-500">Loading…</p>
      ) : null}

      {entries !== null && entries.length === 0 ? (
        <p className="p-4 text-sm text-zinc-500">
          Nothing here yet - the Timeline fills in as you use Exit &amp; Summarize at the end of
          each session.
        </p>
      ) : null}

      {entries !== null && entries.length > 0 ? (
        <ol className="flex flex-col divide-y divide-zinc-800">
          {entries.map((entry) => (
            <li key={entry.id} className="px-4 py-3">
              <p className="text-xs text-zinc-500">{formatTimestamp(entry.createdAt)}</p>
              <p className="mt-1 text-sm leading-6 text-zinc-200">{entry.summary}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
};

const formatTimestamp = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      });
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
