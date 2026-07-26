import { useEffect, useState } from "react";
import type { Note } from "../../shared/ipc";
import { NOTE_STATUS_META, nextNoteStatus } from "../noteStatus";

type NotesPanelProps = {
  projectId: string;
};

type Draft = {
  text: string;
  content: string;
};

const emptyDraft: Draft = { text: "", content: "" };

/**
 * A personal, human-owned scratchpad attached to a project - deliberately
 * separate from Kanban's Claude-owned, read-only task state. Reachable both
 * from the Dashboard (no active session required) and the Terminal page's
 * lower-right sidebar, so an idea can be captured without breaking flow.
 * Each note has a short subject (the at-a-glance line) and a longer content
 * body underneath it - not just a single-line checklist item.
 */
export const NotesPanel = ({ projectId }: NotesPanelProps): JSX.Element => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void window.starship.notes
      .list({ projectId })
      .then((result) => {
        if (!cancelled) {
          setNotes(result);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(stringifyError(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const addNote = async (): Promise<void> => {
    const text = draft.text.trim();
    if (!text || adding) {
      return;
    }

    setAdding(true);
    setError(null);
    try {
      const note = await window.starship.notes.add({
        projectId,
        text,
        content: draft.content.trim()
      });
      setNotes((current) => [...current, note]);
      setDraft(emptyDraft);
    } catch (addError: unknown) {
      setError(stringifyError(addError));
    } finally {
      setAdding(false);
    }
  };

  const advanceStatus = async (note: Note): Promise<void> => {
    const nextStatus = nextNoteStatus(note.status);
    setNotes((current) =>
      current.map((item) => (item.id === note.id ? { ...item, status: nextStatus } : item))
    );
    try {
      await window.starship.notes.setStatus({ noteId: note.id, status: nextStatus });
    } catch (statusError: unknown) {
      setNotes((current) =>
        current.map((item) => (item.id === note.id ? { ...item, status: note.status } : item))
      );
      setError(stringifyError(statusError));
    }
  };

  const startEdit = (note: Note): void => {
    setEditingId(note.id);
    setEditingDraft({ text: note.text, content: note.content });
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setEditingDraft(emptyDraft);
  };

  const saveEdit = async (): Promise<void> => {
    const text = editingDraft.text.trim();
    if (!editingId || !text) {
      return;
    }

    const noteId = editingId;
    setSaving(true);
    setError(null);
    try {
      const updated = await window.starship.notes.update({
        noteId,
        text,
        content: editingDraft.content.trim()
      });
      setNotes((current) => current.map((item) => (item.id === noteId ? updated : item)));
      cancelEdit();
    } catch (saveError: unknown) {
      setError(stringifyError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async (noteId: string): Promise<void> => {
    const previous = notes;
    setNotes((current) => current.filter((item) => item.id !== noteId));
    if (editingId === noteId) {
      cancelEdit();
    }
    try {
      await window.starship.notes.delete({ noteId });
    } catch (deleteError: unknown) {
      setNotes(previous);
      setError(stringifyError(deleteError));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="shrink-0 space-y-2 border-b border-zinc-800 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void addNote();
        }}
      >
        <input
          value={draft.text}
          onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
          placeholder="Subject"
          className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
        />
        <textarea
          value={draft.content}
          onChange={(event) =>
            setDraft((current) => ({ ...current, content: event.target.value }))
          }
          placeholder="Write more about it..."
          rows={2}
          className="w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs leading-5 text-zinc-100 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={adding || draft.text.trim().length === 0}
            className="h-7 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-500"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
      </form>

      {error ? (
        <div
          role="alert"
          className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
        >
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="text-xs text-zinc-500">Loading notes</p>
        ) : notes.length === 0 ? (
          <p className="text-xs text-zinc-500">No notes yet.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => {
              const isEditing = editingId === note.id;

              return (
                <li
                  key={note.id}
                  className="group rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs"
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        autoFocus
                        value={editingDraft.text}
                        onChange={(event) =>
                          setEditingDraft((current) => ({ ...current, text: event.target.value }))
                        }
                        className="w-full rounded border border-sky-400 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-100 outline-none"
                      />
                      <textarea
                        value={editingDraft.content}
                        onChange={(event) =>
                          setEditingDraft((current) => ({
                            ...current,
                            content: event.target.value
                          }))
                        }
                        rows={3}
                        className="w-full resize-y rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-xs leading-5 text-zinc-100 outline-none focus:border-sky-400"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="h-6 rounded-md border border-zinc-700 px-2 text-[11px] font-medium text-zinc-200 hover:border-sky-400 hover:text-sky-200 focus:outline-none"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={saving || editingDraft.text.trim().length === 0}
                          className="h-6 rounded-md bg-sky-500 px-2 text-[11px] font-medium text-zinc-950 hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
                        >
                          {saving ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => void advanceStatus(note)}
                        title={`${NOTE_STATUS_META[note.status].label} — click to advance to ${
                          NOTE_STATUS_META[nextNoteStatus(note.status)].label
                        }`}
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs leading-none focus:outline-none focus:ring-2 focus:ring-sky-300 ${
                          NOTE_STATUS_META[note.status].badgeClass
                        }`}
                      >
                        {NOTE_STATUS_META[note.status].icon}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(note)}
                        className="min-w-0 flex-1 break-words text-left"
                      >
                        <p
                          className={
                            note.status === "verified"
                              ? "text-zinc-500 line-through"
                              : "font-medium text-zinc-200"
                          }
                        >
                          {note.text}
                        </p>
                        {note.content ? (
                          <p
                            className={`mt-1 whitespace-pre-wrap ${
                              note.status === "verified" ? "text-zinc-600 line-through" : "text-zinc-400"
                            }`}
                          >
                            {note.content}
                          </p>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteNote(note.id)}
                        aria-label="Delete note"
                        className="shrink-0 text-zinc-600 opacity-0 hover:text-amber-300 focus:opacity-100 focus:outline-none group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
