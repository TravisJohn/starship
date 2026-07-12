import { useEffect, useState } from "react";
import type { IntentLedgerInput, Project } from "../../shared/ipc";

type IntentLedgerEditorProps = {
  project: Project;
  onClose: () => void;
};

type LedgerFields = Omit<IntentLedgerInput, "projectId">;

const emptyLedger: LedgerFields = {
  purpose: "",
  successCriteria: "",
  acceptedTradeoffs: "",
  neverDo: ""
};

export const IntentLedgerEditor = ({
  project,
  onClose
}: IntentLedgerEditorProps): JSX.Element => {
  const [fields, setFields] = useState<LedgerFields>(emptyLedger);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
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

  const setField = (field: keyof LedgerFields, value: string): void => {
    setFields((current) => ({ ...current, [field]: value }));
  };

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
            className="h-8 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            Shelf
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            className="h-8 rounded-md bg-emerald-500 px-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
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
        <div className="border-b border-emerald-500/30 bg-emerald-500/10 px-5 py-2 text-sm text-emerald-100">
          Intent updated.
        </div>
      ) : null}

      <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 overflow-auto p-5">
        {loading ? (
          <p className="text-sm text-zinc-400">Loading intent</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <TextArea
              label="Why this exists"
              value={fields.purpose}
              onChange={(value) => setField("purpose", value)}
            />
            <TextArea
              label="What success looks like"
              value={fields.successCriteria}
              onChange={(value) => setField("successCriteria", value)}
            />
            <TextArea
              label="Tradeoffs accepted"
              value={fields.acceptedTradeoffs}
              onChange={(value) => setField("acceptedTradeoffs", value)}
            />
            <TextArea
              label="Must never do"
              value={fields.neverDo}
              onChange={(value) => setField("neverDo", value)}
            />
          </form>
        )}
      </div>
    </section>
  );
};

type TextAreaProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

const TextArea = ({ label, value, onChange }: TextAreaProps): JSX.Element => (
  <label className="block">
    <span className="text-sm font-medium text-zinc-200">{label}</span>
    <textarea
      value={value}
      rows={5}
      onChange={(event) => onChange(event.target.value)}
      className="mt-2 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
    />
  </label>
);

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
