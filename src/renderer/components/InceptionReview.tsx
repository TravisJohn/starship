import { useState } from "react";
import type {
  InceptionDraftDocumentsResponse,
  InceptionInterview
} from "../../shared/ipc";

type InceptionReviewProps = {
  interview: InceptionInterview;
  drafts: InceptionDraftDocumentsResponse;
  onBack: () => void;
  onCreate: (prd: string, claude: string) => void;
  busy: boolean;
  error: string | null;
};

export const InceptionReview = ({
  drafts,
  onBack,
  onCreate,
  busy,
  error
}: InceptionReviewProps): JSX.Element => {
  const [prd, setPrd] = useState(drafts.prd);
  const [claude, setClaude] = useState(drafts.claude);

  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-5">
        <div>
          <h1 className="text-sm font-semibold leading-none">Review Drafts</h1>
          <p className="mt-1 text-xs leading-none text-zinc-400">
            PRD.md and CLAUDE.md
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="h-8 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:cursor-not-allowed disabled:text-zinc-500"
          >
            Inception
          </button>
          <button
            type="button"
            onClick={() => onCreate(prd, claude)}
            disabled={busy || prd.trim().length === 0 || claude.trim().length === 0}
            className="h-8 rounded-md bg-emerald-500 px-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            Create Project
          </button>
        </div>
      </header>

      {drafts.usedFallback ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-sm text-amber-100">
          Drafting fell back to the filled templates.
        </div>
      ) : null}
      {error ? (
        <div className="border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-5 lg:grid-cols-2">
        <Editor label="PRD.md" value={prd} onChange={setPrd} />
        <Editor label="CLAUDE.md" value={claude} onChange={setClaude} />
      </div>
    </section>
  );
};

type EditorProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

const Editor = ({ label, value, onChange }: EditorProps): JSX.Element => (
  <label className="flex min-h-0 flex-col">
    <span className="mb-2 text-sm font-medium text-zinc-200">{label}</span>
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-0 flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-900 px-3 py-3 font-mono text-sm leading-6 text-zinc-100 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
    />
  </label>
);
