import type { MissionProject, ObservationStatus } from "../../shared/ipc";

type StatTilesProps = {
  projects: MissionProject[];
  statusByProjectId: Record<string, ObservationStatus>;
};

type Tile = {
  label: string;
  sublabel: string;
  count: number;
  glyph: string;
  glyphClass: string;
};

/**
 * Five at-a-glance counts, entirely derived from data the dashboard already
 * fetches (statusByProjectId, project.ignored) - no new field, just a
 * summary row above the table so the overall shape of "how many projects
 * need me right now" doesn't require scanning every row's status dot.
 */
export const StatTiles = ({ projects, statusByProjectId }: StatTilesProps): JSX.Element => {
  const statusOf = (project: MissionProject): ObservationStatus =>
    statusByProjectId[project.id] ?? "idle";

  const active = projects.filter((project) => statusOf(project) === "building").length;
  const needsAttention = projects.filter((project) => statusOf(project) === "decision-needed").length;
  const ignored = projects.filter((project) => project.ignored).length;
  const idle = projects.length - active - needsAttention - ignored;

  const tiles: Tile[] = [
    {
      label: "Total Projects",
      sublabel: "All time",
      count: projects.length,
      glyph: "▤",
      glyphClass: "bg-sky-500/15 text-sky-300"
    },
    {
      label: "Active",
      sublabel: "Currently running",
      count: active,
      glyph: "▶",
      glyphClass: "bg-emerald-500/15 text-emerald-300"
    },
    {
      label: "Idle",
      sublabel: "No recent activity",
      count: idle,
      glyph: "◌",
      glyphClass: "bg-sky-500/15 text-sky-300"
    },
    {
      label: "Needs Attention",
      sublabel: "Take a look",
      count: needsAttention,
      glyph: "!",
      glyphClass: "bg-amber-500/15 text-amber-300"
    },
    {
      label: "Ignored",
      sublabel: "Hidden from view",
      count: ignored,
      glyph: "◐",
      glyphClass: "bg-purple-500/15 text-purple-300"
    }
  ];

  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
        >
          <div className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold ${tile.glyphClass}`}
              aria-hidden="true"
            >
              {tile.glyph}
            </span>
            <span className="text-xl font-semibold leading-none text-zinc-100">
              {tile.count}
            </span>
          </div>
          <p className="mt-2 text-xs font-medium text-zinc-300">{tile.label}</p>
          <p className="text-[11px] text-zinc-500">{tile.sublabel}</p>
        </div>
      ))}
    </div>
  );
};
