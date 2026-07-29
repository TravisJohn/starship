import { NOTE_STATUS_ORDER } from "../noteStatus";
import type { MissionProject } from "../../shared/ipc";

/**
 * Weight per lifecycle stage, in NOTE_STATUS_ORDER's own progression
 * (fresh -> implemented -> tested -> verified) - stage N of 4 is worth
 * N*25%, so a project whose notes are all "verified" scores 100, all
 * "fresh" scores 25. This replaces the old per-status pill strip with one
 * number, but is still sourced from the exact same noteStatusCounts data -
 * no new field, just a different reduction of it.
 */
const STAGE_WEIGHT: Record<string, number> = {
  fresh: 25,
  implemented: 50,
  tested: 75,
  verified: 100
};

const SEGMENT_COUNT = 6;

type HealthLevel = { label: string; barClass: string; textClass: string };

/**
 * Thresholds chosen so "Excellent" means genuinely mostly-verified (>=90),
 * not just "better than half" - a project with a pile of merely-tested
 * notes should read as Good, not Excellent.
 */
const levelForScore = (score: number): HealthLevel => {
  if (score >= 90) {
    return { label: "Excellent", barClass: "bg-emerald-500", textClass: "text-emerald-300" };
  }
  if (score >= 70) {
    return { label: "Good", barClass: "bg-emerald-500", textClass: "text-emerald-300" };
  }
  if (score >= 40) {
    return { label: "Fair", barClass: "bg-amber-500", textClass: "text-amber-300" };
  }
  return { label: "Needs work", barClass: "bg-red-500", textClass: "text-red-300" };
};

export const HealthBar = ({
  counts
}: {
  counts: MissionProject["noteStatusCounts"];
}): JSX.Element => {
  const total = NOTE_STATUS_ORDER.reduce((sum, status) => sum + counts[status], 0);

  if (total === 0) {
    return <span className="text-xs text-zinc-600">No notes</span>;
  }

  const score = Math.round(
    NOTE_STATUS_ORDER.reduce((sum, status) => sum + STAGE_WEIGHT[status] * counts[status], 0) / total
  );
  const level = levelForScore(score);
  const filledSegments = Math.round((score / 100) * SEGMENT_COUNT);

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <div className="flex gap-0.5">
          {Array.from({ length: SEGMENT_COUNT }).map((_, index) => (
            <span
              key={index}
              className={`h-2 w-2.5 rounded-sm ${
                index < filledSegments ? level.barClass : "bg-zinc-800"
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-medium text-zinc-300">{score}%</span>
      </div>
      <p className={`mt-0.5 text-xs ${level.textClass}`}>{level.label}</p>
    </div>
  );
};
