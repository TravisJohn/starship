import { useEffect, useRef, useState } from "react";
import type { ActivityLogEntry } from "../../shared/ipc";

type ActivityLogProps = {
  projectId: string;
};

export const ActivityLog = ({ projectId }: ActivityLogProps): JSX.Element => {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    shouldAutoScrollRef.current = true;
    setEntries([]);

    void window.starship.activity
      .list({ projectId })
      .then((initialEntries) => {
        if (!cancelled) {
          setEntries((current) =>
            mergeEntries(
              initialEntries.filter((entry) => matchesProject(entry, projectId)),
              current
            )
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([]);
        }
      });

    const unsubscribe = window.starship.activity.onAppended((entry) => {
      if (!matchesProject(entry, projectId)) {
        return;
      }

      shouldAutoScrollRef.current = isScrolledToBottom(listRef.current);
      setEntries((current) => mergeEntries(current, [entry]));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [projectId]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current || !listRef.current) {
      return;
    }

    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [entries]);

  return (
    <section className="h-32 shrink-0 border-b border-zinc-800 bg-zinc-950">
      <div className="flex h-full min-h-0 flex-col px-4 py-2">
        <div className="mb-1 flex shrink-0 items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Activity
          </h2>
          <span className="text-xs text-zinc-600">{entries.length}</span>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pr-2">
          {entries.length === 0 ? (
            <p className="py-3 text-xs text-zinc-500">No activity yet</p>
          ) : (
            <ol className="space-y-1">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="grid grid-cols-[5.5rem_1fr] gap-2 text-xs leading-5"
                >
                  <time className="font-mono text-zinc-600">
                    {formatActivityTime(entry.ts)}
                  </time>
                  <span className="min-w-0 truncate text-zinc-300">
                    {describeActivity(entry)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
};

const matchesProject = (entry: ActivityLogEntry, projectId: string): boolean =>
  entry.projectId === null || entry.projectId === projectId;

const mergeEntries = (
  current: ActivityLogEntry[],
  incoming: ActivityLogEntry[]
): ActivityLogEntry[] => {
  const byId = new Map<number, ActivityLogEntry>();
  for (const entry of current) {
    byId.set(entry.id, entry);
  }
  for (const entry of incoming) {
    byId.set(entry.id, entry);
  }

  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
};

const isScrolledToBottom = (element: HTMLDivElement | null): boolean => {
  if (!element) {
    return true;
  }

  return element.scrollHeight - element.scrollTop - element.clientHeight <= 8;
};

const formatActivityTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
};

const describeActivity = (entry: ActivityLogEntry): string => {
  const detail = isRecord(entry.detail) ? entry.detail : {};

  switch (entry.eventType) {
    case "root_located": {
      const rootPath = getString(detail, "rootPath");
      return rootPath ? `root set to ${rootPath}` : "root located";
    }
    case "project_ignored":
      return getBoolean(detail, "ignored") ? "project ignored" : "project unignored";
    case "intent_opened":
      return "intent opened";
    case "summary_overlay_opened":
      return "summary opened";
    case "file_map_opened":
      return "file map opened";
    case "project_log_opened":
      return "project log opened";
    case "agent_selected":
      return `agent set to ${getString(detail, "agent") ?? "claude"}`;
    case "model_selected":
      return `model set to ${getString(detail, "model") ?? "claude-sonnet-5"}`;
    case "skip_permissions_toggled":
      return `skip-permissions ${getBoolean(detail, "enabled") ? "on" : "off"}`;
    case "launch_fired": {
      const agent = getString(detail, "agent") ?? "claude";
      const model = getString(detail, "model");
      const skip = getBoolean(detail, "dangerouslySkipPermissions") ? "on" : "off";
      return `launched ${agent}${model ? ` (${model})` : ""} (skip-permissions: ${skip})`;
    }
    default:
      return entry.eventType.replace(/_/g, " ");
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getString = (
  record: Record<string, unknown>,
  key: string
): string | null => {
  const value = record[key];
  return typeof value === "string" ? value : null;
};

const getBoolean = (record: Record<string, unknown>, key: string): boolean =>
  record[key] === true;
