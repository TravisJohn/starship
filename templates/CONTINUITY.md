# CONTINUITY.md — the cross-agent handoff template

The artifact this describes is a thin, provider-agnostic continuity note.
Whichever agent just finished working (Claude Code, Codex, Antigravity)
writes it at session end; Travis pastes it as the opening message of the
next session, whichever tool that is.

It is **not** a `*_HANDOVER.md` document. Those are deep, topic-scoped
audits written on demand and they run to hundreds of lines. This is one
short note per session, and it is **overwritten every time, never
appended** — that is the structural reason it stays thin. `PROJECT_LOG.md`
is the artifact that accumulates, and it stays exactly as it is.

## Rules

- Plain ASCII text. No tables, no code fences, no em dashes, no curly
  quotes, no emoji, no box-drawing characters. It gets pasted through three
  terminals and must survive every encoding on the way.
- One level of `- ` bullets at most.
- Write for a reader with no access to this session's transcript and no
  knowledge of the tool that produced it.
- Never include: reasoning trails, self-corrections, `file:line` references,
  tool-call narration, or meta-commentary about the agent's own process.
- Never fabricate. If a section has nothing real in it, say so plainly
  rather than padding it out.
- State outcomes, not steps. "Retrofit is possible now" beats "edited
  ProjectDetailPanel.tsx, ran tests, updated the log".

## Shape

```
HANDOFF - <project name>
Session ended <YYYY-MM-DD>. Produced by <agent>.

WHERE THIS IS
<The state of the project in a few lines. Use a phase only if the project
actually tracks phases; many don't, and a stale phase number is worse than
a plain description of what is live and what isn't.>

THIS SESSION
- <What changed, as outcomes.>

DECIDED - do not reopen without cause
- <Settled choices the next agent should not relitigate.>

NEVER - hard constraints
- <Lines that must not be crossed. Pull from the project's Intent Ledger.>

NEXT
<The single next thing, and what it is waiting on.>
```

## Why DECIDED and NEVER are separate

They are different weight classes. A DECIDED item is a reversible design
choice that could be reopened with cause. A NEVER item cannot be crossed at
all. Merging them buries the second kind in the first, and the NEVER list is
precisely what a fresh agent in an unfamiliar tool is most likely to violate.

A project with no Intent Ledger will have a thin or empty NEVER section.
That is correct and honest, not a defect — and it is a good moment to
capture intent for that project before handing it to another agent.

## The five-bullet cap on DECIDED

At most five bullets. The filter is **what the stated NEXT actually needs** —
not "the most important decisions in this project". Those are different
lists, and the second one is always longer.

Related decisions of the same kind group into one bullet: four choices about
one model call's parameters are one bullet, not four. A bullet that becomes
six unrelated clauses is a section header pretending to be a bullet — split
the note or cut the weakest items instead.

If five grouped bullets genuinely cannot cover what the next step needs,
the signal is that NEXT is too big. It is a session's worth of design
decisions rather than a handoff, and it should be split before it is
written down.
