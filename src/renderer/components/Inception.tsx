import { useMemo, useState } from "react";
import type { InceptionInterview, IntentInterview, RequirementsInterview } from "../../shared/ipc";

type InceptionProps = {
  onCancel: () => void;
  onComplete: (interview: InceptionInterview) => void;
};

const emptyIntent: IntentInterview = {
  purpose: "",
  successCriteria: "",
  acceptedTradeoffs: "",
  neverDo: "",
  learningGoal: ""
};

const emptyRequirements: RequirementsInterview = {
  projectName: "",
  parentDirectory: "",
  oneLiner: "",
  firstVersionScope: "",
  audience: "",
  stack: "",
  constraints: "",
  outOfScope: ""
};

export const Inception = ({
  onCancel,
  onComplete
}: InceptionProps): JSX.Element => {
  const [step, setStep] = useState<"intent" | "requirements">("intent");
  const [intent, setIntent] = useState<IntentInterview>(emptyIntent);
  const [requirements, setRequirements] =
    useState<RequirementsInterview>(emptyRequirements);

  const intentComplete = useMemo(
    () =>
      [
        intent.purpose,
        intent.successCriteria,
        intent.acceptedTradeoffs,
        intent.neverDo
      ].every((value) => value.trim().length > 0),
    [intent]
  );

  const requirementsComplete = useMemo(
    () =>
      [
        requirements.projectName,
        requirements.parentDirectory,
        requirements.oneLiner,
        requirements.firstVersionScope,
        requirements.audience,
        requirements.stack,
        requirements.outOfScope
      ].every((value) => value.trim().length > 0),
    [requirements]
  );

  const completeInterview = (): void => {
    onComplete({
      intent: trimIntent(intent),
      requirements: trimRequirements(requirements)
    });
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-5">
        <div>
          <h1 className="text-sm font-semibold leading-none">New Project</h1>
          <p className="mt-1 text-xs leading-none text-zinc-400">
            {step === "intent" ? "Intent Ledger" : "Requirements"}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
        >
          Shelf
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        {step === "intent" ? (
          <IntentStep
            intent={intent}
            onChange={setIntent}
            onNext={() => setStep("requirements")}
            canContinue={intentComplete}
          />
        ) : (
          <RequirementsStep
            requirements={requirements}
            onChange={setRequirements}
            onBack={() => setStep("intent")}
            onComplete={completeInterview}
            canComplete={requirementsComplete}
          />
        )}
      </div>
    </section>
  );
};

type IntentStepProps = {
  intent: IntentInterview;
  onChange: (intent: IntentInterview) => void;
  onNext: () => void;
  canContinue: boolean;
};

const IntentStep = ({
  intent,
  onChange,
  onNext,
  canContinue
}: IntentStepProps): JSX.Element => {
  const setField = (field: keyof IntentInterview, value: string): void => {
    onChange({ ...intent, [field]: value });
  };

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="pt-1">
        <p className="text-xs font-medium uppercase tracking-widest text-emerald-300">
          Intent first
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-normal">
          Capture the constitution before the requirements.
        </h2>
        <p className="mt-4 max-w-md text-sm leading-6 text-zinc-400">
          These answers become the Intent Ledger and are embedded in the files
          and cold prompt that start the build.
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canContinue) {
            onNext();
          }
        }}
      >
        <TextArea
          label="Why should this project exist?"
          value={intent.purpose}
          onChange={(value) => setField("purpose", value)}
          minRows={4}
        />
        <TextArea
          label="What would make this project successful enough to call it real?"
          value={intent.successCriteria}
          onChange={(value) => setField("successCriteria", value)}
          minRows={4}
        />
        <TextArea
          label="What tradeoffs are you already willing to accept?"
          value={intent.acceptedTradeoffs}
          onChange={(value) => setField("acceptedTradeoffs", value)}
          minRows={4}
        />
        <TextArea
          label="What must this project never do or become?"
          value={intent.neverDo}
          onChange={(value) => setField("neverDo", value)}
          minRows={4}
        />
        <TextArea
          label="What should building this teach you?"
          value={intent.learningGoal}
          onChange={(value) => setField("learningGoal", value)}
          minRows={3}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!canContinue}
            className="h-10 rounded-md bg-emerald-500 px-4 text-sm font-medium text-zinc-950 hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            Requirements
          </button>
        </div>
      </form>
    </div>
  );
};

type RequirementsStepProps = {
  requirements: RequirementsInterview;
  onChange: (requirements: RequirementsInterview) => void;
  onBack: () => void;
  onComplete: () => void;
  canComplete: boolean;
};

const RequirementsStep = ({
  requirements,
  onChange,
  onBack,
  onComplete,
  canComplete
}: RequirementsStepProps): JSX.Element => {
  const setField = (
    field: keyof RequirementsInterview,
    value: string
  ): void => {
    onChange({ ...requirements, [field]: value });
  };

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="pt-1">
        <p className="text-xs font-medium uppercase tracking-widest text-sky-300">
          Requirements second
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-normal">
          Define the first executable brief.
        </h2>
        <p className="mt-4 max-w-md text-sm leading-6 text-zinc-400">
          These answers shape the generated PRD, project instructions, and cold
          prompt.
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canComplete) {
            onComplete();
          }
        }}
      >
        <TextInput
          label="What should Starship call this project?"
          value={requirements.projectName}
          onChange={(value) => setField("projectName", value)}
        />
        <TextInput
          label="Where should the project folder be created?"
          value={requirements.parentDirectory}
          onChange={(value) => setField("parentDirectory", value)}
        />
        <TextArea
          label="What is the one-line offer or premise?"
          value={requirements.oneLiner}
          onChange={(value) => setField("oneLiner", value)}
          minRows={3}
        />
        <TextArea
          label="What should the first working version do?"
          value={requirements.firstVersionScope}
          onChange={(value) => setField("firstVersionScope", value)}
          minRows={4}
        />
        <TextArea
          label="Who is it for, even if that is only you?"
          value={requirements.audience}
          onChange={(value) => setField("audience", value)}
          minRows={3}
        />
        <TextArea
          label="What platforms, stack, or constraints are already decided?"
          value={requirements.stack}
          onChange={(value) => setField("stack", value)}
          minRows={3}
        />
        <TextArea
          label="What other constraints should shape the first phase?"
          value={requirements.constraints}
          onChange={(value) => setField("constraints", value)}
          minRows={3}
        />
        <TextArea
          label="What is explicitly out of scope for the first version?"
          value={requirements.outOfScope}
          onChange={(value) => setField("outOfScope", value)}
          minRows={3}
        />
        <div className="flex justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="h-10 rounded-md border border-zinc-700 px-4 text-sm font-medium text-zinc-100 hover:border-emerald-400 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            Intent
          </button>
          <button
            type="submit"
            disabled={!canComplete}
            className="h-10 rounded-md bg-emerald-500 px-4 text-sm font-medium text-zinc-950 hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            Draft Files
          </button>
        </div>
      </form>
    </div>
  );
};

type TextInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

const TextInput = ({
  label,
  value,
  onChange
}: TextInputProps): JSX.Element => (
  <label className="block">
    <span className="text-sm font-medium text-zinc-200">{label}</span>
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-2 h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
    />
  </label>
);

type TextAreaProps = TextInputProps & {
  minRows: number;
};

const TextArea = ({
  label,
  value,
  onChange,
  minRows
}: TextAreaProps): JSX.Element => (
  <label className="block">
    <span className="text-sm font-medium text-zinc-200">{label}</span>
    <textarea
      value={value}
      rows={minRows}
      onChange={(event) => onChange(event.target.value)}
      className="mt-2 w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
    />
  </label>
);

const trimIntent = (intent: IntentInterview): IntentInterview => ({
  purpose: intent.purpose.trim(),
  successCriteria: intent.successCriteria.trim(),
  acceptedTradeoffs: intent.acceptedTradeoffs.trim(),
  neverDo: intent.neverDo.trim(),
  learningGoal: intent.learningGoal.trim()
});

const trimRequirements = (
  requirements: RequirementsInterview
): RequirementsInterview => ({
  projectName: requirements.projectName.trim(),
  parentDirectory: requirements.parentDirectory.trim(),
  oneLiner: requirements.oneLiner.trim(),
  firstVersionScope: requirements.firstVersionScope.trim(),
  audience: requirements.audience.trim(),
  stack: requirements.stack.trim(),
  constraints: requirements.constraints.trim(),
  outOfScope: requirements.outOfScope.trim()
});
