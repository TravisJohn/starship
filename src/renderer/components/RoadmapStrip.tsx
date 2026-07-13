import { useEffect, useState } from "react";
import type { PrdPhase } from "../../shared/ipc";

type RoadmapStripProps = {
  projectPath: string;
};

/**
 * Every phase listed in the project's own PRD.md, shown as a constant
 * reminder that more exists beyond whatever Claude's Kanban currently shows
 * completed - deliberately not styled or labeled as tracked tasks, and
 * deliberately not claiming to know which phase is "current" (see
 * readPrdPhases in dashboard.ts for why).
 */
export const RoadmapStrip = ({ projectPath }: RoadmapStripProps): JSX.Element | null => {
  const [phases, setPhases] = useState<PrdPhase[]>([]);

  useEffect(() => {
    let cancelled = false;
    setPhases([]);

    void window.starship.project
      .getPhases({ projectPath })
      .then((result) => {
        if (!cancelled) {
          setPhases(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPhases([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  if (phases.length === 0) {
    return null;
  }

  return (
    <section className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-4 py-2">
      <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Roadmap (from PRD.md)
      </h2>
      <ol className="flex gap-2 overflow-x-auto pb-1">
        {phases.map((phase, index) => (
          <li
            key={`${index}-${phase.title}`}
            title={phase.body}
            className="shrink-0 whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-xs text-zinc-400"
          >
            {phase.title}
          </li>
        ))}
      </ol>
    </section>
  );
};
