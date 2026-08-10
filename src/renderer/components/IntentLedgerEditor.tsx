import { useEffect, useState } from "react";
import type { IntentInterview, Project } from "../../shared/ipc";
import { IntentFields } from "./IntentFields";
import { LoadingAnimation } from "./LoadingAnimation";

type IntentLedgerEditorProps = {
  project: Project;
  onClose: () => void;
};

const emptyLedger: IntentInterview = {
  purpose: "",
  successCriteria: "",
  acceptedTradeoffs: "",
  neverDo: ""
};

/**
 * Captures or revises the Intent Ledger for a project that already exists -
 * including shelved projects that predate Inception and so never had intent
 * captured at all. Asks the same four questions as Inception's intent step
 * (see IntentFields), but unlike Inception it saves partial answers: intent
 * reconstructed after the fact is often only partly recoverable, and a
 * half-answered ledger is worth more than none.
 *
 * Writes to Starship's own database only. It never touches the project's
 * files, so a ledger captured here informs Starship's briefings and
 * annotations but is not visible to Claude Code itself.
 */
export const IntentLedgerEditor = ({
  project,
  onClose
}: IntentLedgerEditorProps): JSX.Element => {
  const [fields, setFields] = useState<IntentInterview>(emptyLedger);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [hasLedger, setHasLedger] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    void window.starship.intent
      .getLedger({ projectId: project.id })
      .then((ledger) => {
        if (cancelled) {
          return;
        }

        setHasLedger(ledger !== null);
        if (ledger) {
          setFields({
            purpose: ledger.purpose,
            successCriteria: ledger.successCriteria,
            acceptedTradeoffs: ledger.acceptedTradeoffs,
            neverDo: ledger.neverDo
          });
        } else {
          setFields(emptyLedger);
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
  }, [project.id]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const ledger = await window.starship.intent.saveLedger({
        projectId: project.id,
        purpose: fields.purpose.trim(),
        successCriteria: fields.successCriteria.trim(),
        acceptedTradeoffs: fields.acceptedTradeoffs.trim(),
        neverDo: fields.neverDo.trim()
      });
      setFields({
        purpose: ledger.purpose,
        successCriteria: ledger.successCriteria,
        acceptedTradeoffs: ledger.acceptedTradeoffs,
        neverDo: ledger.neverDo
      });
      setSavedAt(ledger.updatedAt);
      setHasLedger(true);
    } catch (saveError) {
      setError(stringifyError(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-none">
            {project.name}
          </h1>
          <p className="mt-1 truncate text-xs leading-none text-zinc-400">
            Intent Ledger
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300"
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            className="h-8 rounded-md bg-sky-500 px-3 text-sm font-medium text-zinc-950 hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            Save
          </button>
        </div>
      </header>

      {error ? (
        <div className="border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-sm text-red-100">
          {error}
        </div>
      ) : null}
      {savedAt ? (
        <div className="border-b border-sky-500/30 bg-sky-500/10 px-5 py-2 text-sm text-sky-100">
          Intent updated.
        </div>
      ) : null}

      <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 overflow-auto p-5">
        {loading ? (
          <LoadingAnimation
            label="Loading intent"
            className="h-full"
            mediaClassName="h-36 w-64 max-w-[64vw]"
          />
        ) : (
          <>
            {!hasLedger ? (
              <div className="mb-5 rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                <p className="text-sm font-medium text-zinc-100">
                  No intent captured for this project yet.
                </p>
                <p className="mt-1 text-sm leading-6 text-zinc-400">
                  Answer what you can — partial answers save fine, and you can
                  come back and sharpen them later.
                </p>
              </div>
            ) : null}
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <IntentFields intent={fields} onChange={setFields} />
            </form>
          </>
        )}
      </div>
    </section>
  );
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
