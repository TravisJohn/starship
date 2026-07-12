import type { ObservationStatus } from "../../shared/ipc";

type StatusDotProps = {
  status: ObservationStatus | undefined;
};

const COLOR_BY_STATUS: Record<ObservationStatus, string> = {
  "no-session-detected": "bg-zinc-700",
  idle: "bg-zinc-500",
  building: "bg-sky-400",
  "decision-needed": "bg-amber-400"
};

const LABEL_BY_STATUS: Record<ObservationStatus, string> = {
  "no-session-detected": "No session detected",
  idle: "Idle",
  building: "Building",
  "decision-needed": "Decision needed"
};

export const StatusDot = ({ status }: StatusDotProps): JSX.Element => {
  const resolved = status ?? "no-session-detected";
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${COLOR_BY_STATUS[resolved]}`}
      title={LABEL_BY_STATUS[resolved]}
    />
  );
};
