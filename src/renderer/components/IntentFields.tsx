import type { IntentInterview } from "../../shared/ipc";
import { DiscussPanel } from "./DiscussPanel";

const INTENT_QUESTIONS: { field: keyof IntentInterview; label: string }[] = [
  { field: "purpose", label: "Why should this project exist?" },
  {
    field: "successCriteria",
    label: "What would make this project successful enough to call it real?"
  },
  {
    field: "acceptedTradeoffs",
    label: "What tradeoffs are you already willing to accept?"
  },
  { field: "neverDo", label: "What must this project never do or become?" }
];

type IntentFieldsProps = {
  intent: IntentInterview;
  onChange: (intent: IntentInterview) => void;
};

/**
 * The four Intent Ledger questions, each with its own Discuss thread - shared
 * by Inception's intent step (capturing intent for a project about to be
 * created) and the Intent Ledger editor (capturing or revising it for a
 * project that already exists). Both surfaces asked the same four things in
 * different words before this existed; the wording now lives in one place.
 *
 * Deliberately holds no load/save/validation logic - each caller owns that,
 * because their rules differ: Inception requires all four answers before it
 * will advance, while the editor saves partial answers, since intent
 * reconstructed for an already-built project is often only partly recoverable.
 *
 * Discuss stays project-blind here (see DiscussPanel/inceptionDiscuss.ts) - it
 * helps articulate an answer from the conversation alone and never inspects
 * the project, which is the same behavior in both surfaces.
 */
export const IntentFields = ({
  intent,
  onChange
}: IntentFieldsProps): JSX.Element => (
  <>
    {INTENT_QUESTIONS.map(({ field, label }) => (
      <div key={field}>
        <label className="block">
          <span className="text-sm font-medium text-zinc-200">{label}</span>
          <textarea
            value={intent[field]}
            rows={4}
            onChange={(event) =>
              onChange({ ...intent, [field]: event.target.value })
            }
            className="mt-2 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
          />
        </label>
        <DiscussPanel
          field={field}
          fieldLabel={label}
          currentValue={intent[field]}
          onApply={(value) => onChange({ ...intent, [field]: value })}
        />
      </div>
    ))}
  </>
);
