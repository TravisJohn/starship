import { NOTE_STATUS_ORDER, type NoteStatus } from "../shared/ipc";

export { NOTE_STATUS_ORDER };

export const NOTE_STATUS_META: Record<
  NoteStatus,
  { label: string; icon: string; badgeClass: string }
> = {
  fresh: { label: "Fresh", icon: "○", badgeClass: "border-zinc-600 text-zinc-400" },
  implemented: { label: "Implemented", icon: "◐", badgeClass: "border-sky-500 text-sky-300" },
  tested: { label: "Tested", icon: "◕", badgeClass: "border-amber-500 text-amber-300" },
  verified: { label: "Verified", icon: "●", badgeClass: "border-emerald-500 text-emerald-300" }
};

export const nextNoteStatus = (status: NoteStatus): NoteStatus => {
  const index = NOTE_STATUS_ORDER.indexOf(status);
  return NOTE_STATUS_ORDER[(index + 1) % NOTE_STATUS_ORDER.length];
};
