import type { AgentKind, ClaudeModelKind, MissionProject } from "../../shared/ipc";

/**
 * Same green -> amber -> red "how much is piling up" thresholds the table
 * row's Notes badge used before this panel existed - preserved here rather
 * than flattened to one color, since the temperature (not just the count)
 * was the point of the badge.
 */
const noteCountBadgeClass = (count: number): string => {
  if (count >= 5) {
    return "bg-red-500 text-zinc-950";
  }
  if (count >= 3) {
    return "bg-amber-500 text-zinc-950";
  }
  return "bg-emerald-500 text-zinc-950";
};

const CLAUDE_MODEL_OPTIONS: { value: ClaudeModelKind; label: string }[] = [
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-opus-5", label: "Opus 5" },
  { value: "claude-fable-5", label: "Fable 5" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" }
];

type ProjectDetailPanelProps = {
  project: MissionProject;
  isRunning: boolean;
  agent: AgentKind;
  model: ClaudeModelKind;
  skipPermissions: boolean;
  pendingNoteCount: number;
  onLaunch: () => void;
  onSelectAgent: (agent: AgentKind) => void;
  onSelectModel: (model: ClaudeModelKind) => void;
  onSetSkipPermissions: (enabled: boolean) => void;
  onOpenIntent: () => void;
  onOpenFileMap: () => void;
  onOpenDecisionMap: () => void;
  onOpenNarrativeJourney: () => void;
  onOpenGitTree: () => void;
  onOpenNotes: () => void;
  onToggleIgnored: () => void;
  isTogglingIgnored: boolean;
  formatBytes: (bytes: number | null) => string;
  formatLastActivity: (lastActivityAt: string | null) => string;
};

/**
 * The per-project action surface, moved out of the table row it used to
 * live inline in (one dense 2-column grid per visible row) into a single
 * panel for whichever project is selected. Every handler here already took
 * a project/projectId before this change - this only relocates where the
 * buttons render, not how the underlying launch/annotate/notes state works.
 */
export const ProjectDetailPanel = ({
  project,
  isRunning,
  agent,
  model,
  skipPermissions,
  pendingNoteCount,
  onLaunch,
  onSelectAgent,
  onSelectModel,
  onSetSkipPermissions,
  onOpenIntent,
  onOpenFileMap,
  onOpenDecisionMap,
  onOpenNarrativeJourney,
  onOpenGitTree,
  onOpenNotes,
  onToggleIgnored,
  isTogglingIgnored,
  formatBytes,
  formatLastActivity
}: ProjectDetailPanelProps): JSX.Element => {
  const intentDisabled = project.lastActivityAt !== null;

  return (
    <aside className="w-80 shrink-0 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-100">{project.name}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{project.path}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onLaunch}
          className="h-9 rounded-md bg-sky-500 text-sm font-medium text-zinc-950 hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          {isRunning ? "Resume" : "Launch"}
        </button>
        <button
          type="button"
          onClick={onOpenFileMap}
          className="h-9 rounded-md border border-zinc-700 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          File Map
        </button>
        <button
          type="button"
          title={
            intentDisabled
              ? "Already started - Intent is only shown for projects that haven't been launched yet"
              : undefined
          }
          disabled={intentDisabled}
          onClick={onOpenIntent}
          className={`h-9 rounded-md border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-300 ${
            intentDisabled
              ? "cursor-not-allowed border-zinc-800 text-zinc-500 opacity-60"
              : "border-zinc-700 text-zinc-100 hover:border-sky-400 hover:text-sky-200"
          }`}
        >
          Intent
        </button>
        <button
          type="button"
          title="Decision Record"
          onClick={onOpenDecisionMap}
          className="h-9 rounded-md border border-zinc-700 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          Decision Record
        </button>
        <button
          type="button"
          title="Narrative Journey"
          onClick={onOpenNarrativeJourney}
          className="h-9 rounded-md border border-zinc-700 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          Narrative Journey
        </button>
        <button
          type="button"
          title="Git Tree"
          onClick={onOpenGitTree}
          className="h-9 rounded-md border border-zinc-700 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          Git Tree
        </button>
        <button
          type="button"
          onClick={onOpenNotes}
          className="col-span-2 flex h-9 items-center justify-center gap-1.5 rounded-md border border-zinc-700 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          Notes
          {pendingNoteCount > 0 ? (
            <span
              title={`${pendingNoteCount} note${pendingNoteCount === 1 ? "" : "s"} not yet verified`}
              className={`flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${noteCountBadgeClass(
                pendingNoteCount
              )}`}
            >
              {pendingNoteCount}
            </span>
          ) : null}
        </button>
      </div>

      <div className="mt-5">
        <p className="text-xs font-medium uppercase text-zinc-500">Model &amp; Provider</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <select
              value={agent}
              onChange={(event) => onSelectAgent(event.target.value as AgentKind)}
              className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs font-medium text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              <option value="claude">Claude</option>
              <option value="codex" disabled>
                Codex
              </option>
              <option value="antigravity" disabled>
                Antigravity
              </option>
            </select>
            <p className="mt-1 text-[11px] text-zinc-500">AI Model</p>
          </div>
          <div>
            <select
              value={model}
              onChange={(event) => onSelectModel(event.target.value as ClaudeModelKind)}
              disabled={agent !== "claude"}
              title="Model used for this project's next Launch/Resume"
              className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs font-medium text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {CLAUDE_MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-zinc-500">Provider / Version</p>
          </div>
        </div>
        <label className="mt-3 inline-flex items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={skipPermissions}
            onChange={(event) => onSetSkipPermissions(event.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-sky-500 focus:ring-sky-300"
          />
          Skip permissions
        </label>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-zinc-800 pt-3 text-xs">
        <div>
          <p className="text-zinc-500">Last Activity</p>
          <p className="mt-0.5 text-zinc-300">{formatLastActivity(project.lastActivityAt)}</p>
        </div>
        <div>
          <p className="text-zinc-500">Size</p>
          <p className="mt-0.5 text-zinc-300">{formatBytes(project.sizeBytes)}</p>
        </div>
        <div>
          <p className="text-zinc-500">Created</p>
          <p className="mt-0.5 text-zinc-300">{formatLastActivity(project.createdAt)}</p>
        </div>
      </div>

      <button
        type="button"
        disabled={isTogglingIgnored}
        onClick={onToggleIgnored}
        className="mt-3 text-xs text-zinc-500 underline-offset-2 hover:text-sky-300 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        {project.ignored ? "Un-ignore project" : "Ignore project"}
      </button>
    </aside>
  );
};
