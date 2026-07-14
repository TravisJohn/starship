import { useState } from "react";
import type { DiscussMessage, IntentInterview } from "../../shared/ipc";

type DiscussPanelProps = {
  field: keyof IntentInterview;
  fieldLabel: string;
  currentValue: string;
  onApply: (rewrite: string) => void;
};

/**
 * Multi-turn but never automatic - every turn is its own explicit "Send"
 * click, same posture as every other headless-call feature in this app.
 * Each call resends the full thread since `claude -p` has no session-resume
 * concept here; see intentDiscuss.ts. A proposed rewrite is only ever a
 * suggestion - applying it into the field is a separate, explicit click.
 */
export const DiscussPanel = ({
  field,
  fieldLabel,
  currentValue,
  onApply
}: DiscussPanelProps): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<DiscussMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [proposedRewrite, setProposedRewrite] = useState<string | null>(null);

  const send = async (): Promise<void> => {
    const message = draft.trim();
    if (!message || sending) {
      return;
    }

    const history = messages;
    setMessages([...history, { role: "user", text: message }]);
    setDraft("");
    setSending(true);

    try {
      const response = await window.starship.intent.discuss({
        field,
        fieldLabel,
        currentValue,
        history,
        message
      });
      setMessages((current) => [...current, { role: "assistant", text: response.reply }]);
      setProposedRewrite(response.proposedRewrite);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: "Couldn't reach the assistant right now." }
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="text-xs font-medium text-sky-300 hover:text-sky-200 focus:outline-none"
      >
        {open ? "Hide Discuss" : "Discuss"}
      </button>

      {open ? (
        <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
          {messages.length === 0 ? (
            <p className="text-xs text-zinc-500">
              Not sure how to answer? Talk it through here.
            </p>
          ) : (
            <ul className="space-y-2">
              {messages.map((message, index) => (
                <li
                  key={index}
                  className={`rounded-md px-2 py-1.5 text-xs ${
                    message.role === "user"
                      ? "bg-zinc-800 text-zinc-100"
                      : "bg-sky-500/10 text-sky-100"
                  }`}
                >
                  {message.text}
                </li>
              ))}
            </ul>
          )}

          {proposedRewrite ? (
            <div className="mt-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-2 text-xs text-sky-100">
              <p className="font-medium">Proposed rewrite</p>
              <p className="mt-1">{proposedRewrite}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onApply(proposedRewrite);
                    setProposedRewrite(null);
                  }}
                  className="h-6 rounded-md bg-sky-500 px-2 text-[11px] font-medium text-zinc-950 hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300"
                >
                  Use this
                </button>
                <button
                  type="button"
                  onClick={() => setProposedRewrite(null)}
                  className="h-6 rounded-md border border-zinc-700 px-2 text-[11px] font-medium text-zinc-200 hover:border-sky-400 hover:text-sky-200 focus:outline-none"
                >
                  Keep discussing
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-2 flex gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask for help articulating this..."
              className="h-8 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
            />
            <button
              type="button"
              disabled={sending || draft.trim().length === 0}
              onClick={() => void send()}
              className="h-8 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-100 hover:border-sky-400 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-500"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
