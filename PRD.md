# Starship — Product Requirements Document

**Version:** 2.0
**Owner:** Travis
**Status:** Approved for Phase 1
**Supersedes:** v1.0 (Foreman)

---

## 1. One-liner

Starship closes the distance between an idea and running software, keeping strategic intent visible in both directions: the builder's intent flows down into every artifact Claude Code executes against, and Claude's reasoning flows back up to the builder — always at decision altitude, never at terminal altitude.

## 2. Thesis

Agentic coding has made *execution* cheap and *understanding* scarce. The bottleneck is no longer writing code; it is (a) the ritual of turning an idea into something an agent can execute well (folder, CLAUDE.md, PRD, git, cold prompt), and (b) staying meaningfully in command while the agent works — knowing not what file changed, but what decision was made, why, and whether it still serves the original intent.

Existing tools solve status ("what is the agent doing?"). Starship solves command ("do I agree with where this is going?"). The user of Starship is an architect, not an operator.

## 3. The two gaps

**The friction gap (idea → execution).** Eight manual steps across five surfaces before an agent writes its first line. Cost: startup energy, which kills more side projects than difficulty does.

**The understanding gap (execution → comprehension).** The agent plans, sequences, and trades off — but that reasoning is buried in scrollback. The builder ships software they cannot narrate. Cost: no transferable judgement, no compounding skill, weak interview stories.

Starship exists to close both, in one window.

## 4. Goals

1. An idea becomes an executing, well-briefed Claude Code session in under 5 minutes, with the builder's intent (purpose, success definition, constraints, tradeoffs accepted) captured explicitly at inception — not just requirements.
2. Every plan Claude produces is rendered with its strategic shape visible: what depends on what, why this order, what tradeoff each branch takes, and how it maps back to the stated intent.
3. All communication from Starship to the builder is at decision altitude (see §6.2). The terminal remains available for anyone who wants detail; Starship never pushes detail.
4. Every project accumulates a replayable decision narrative — the story of how idea became reality — as a by-product of normal use.
5. Building Starship itself teaches its builder Claude Code internals (JSONL transcripts, hooks, headless mode, TodoWrite/Task semantics, ConPTY) to interview depth.

## 5. Non-goals

- Not a product. Single user, local-first, no accounts, telemetry, or cloud.
- Not an agent. Starship never edits code, never acts autonomously, never answers prompts on Claude's behalf.
- Not a terminal replacement, and not a permissions babysitter. The builder chooses their own permission mode; Starship does not nag about operational settings.
- Not a status dashboard. If a feature only reports *what* without *why*, it is out of scope or belongs in the terminal.
- No competing state. Claude Code owns all task/plan state; Starship observes.

## 6. Core principles

### 6.1 Zero agency
Only Claude Code acts. Starship launches, observes, and explains. All LLM use is stateless single-shot summarisation/annotation.

### 6.2 Altitude discipline (new in v2)
Starship speaks in intent, decisions, tradeoffs, and dependencies. It never surfaces operational minutiae (file counts, tool-call logs, permission settings) as primary content. Test for every surface: *"Does this help the builder decide or understand — or merely inform?"* Merely-informing content is demoted to the terminal or a collapsed detail view.

Examples:
- Bad briefing: "Phase complete. 14 tool calls. 3 files changed."
- Good briefing: "Phase 1.4 complete. One decision to review: fences are stored as edge-lists rather than tile flags, trading save-file size for simpler collision logic. This constrains how gates work in Phase 1.5."

### 6.3 Intent is a first-class artifact (new in v2)
At inception, Starship captures an **Intent Ledger** per project: why this exists, what success looks like, which tradeoffs the builder accepts, and what must never happen. The ledger is embedded in the generated PRD/CLAUDE.md/cold prompt, and every later annotation and briefing is generated *against* it — so the DAG doesn't just explain Claude's plan, it relates the plan to the builder's stated intent, and briefings can flag drift ("this decision deviates from your stated constraint X").

### 6.4 Terminal is sacred; observation over ownership
Unchanged from v1: the embedded terminal is real Claude Code and always authoritative; all visual state derives read-only from `~/.claude/projects/**/*.jsonl` and hooks; Starship writes nothing into Claude's state directory.

## 7. Experience

- **Project Shelf:** card per project — name, one-line "where the idea stands" (from the latest briefing), status dot (idle / building / decision-needed). The amber state is explicitly *decision-needed*, not *waiting*: it means the builder's judgement is required, and the notification says what the decision is about.
- **Inception (idea → commissioned build):** a short interview that captures the Intent Ledger first, requirements second. Output: PRD + CLAUDE.md drafts from Travis's templates, side-by-side review, then one commit action (folder, files, git init + first commit, cold prompt composed with the intent embedded, shown for edit, fired).
- **Build Room:** three panes. Terminal (left) — full detail lives here, by choice. Kanban (centre) — Claude's real task state, live. Intent panel (right) — the plan as a DAG annotated with *why*, each node relatable back to the Intent Ledger; clicking any task shows the decision it embodied, not the diff it produced.
- **Briefings & Timeline:** on session end (or on demand), a decision-altitude briefing per §6.2. The Timeline assembles briefings into the project's narrative: idea → decisions → reality. This is the replay surface and the interview-prep machine.

## 8. Architecture

Unchanged from v1 except where noted:

- **Stack:** Electron + React 18 + TS + Tailwind; Zustand; xterm.js ↔ node-pty (ConPTY) over typed IPC; chokidar tailing JSONL append-only; better-sqlite3 for disposable derived cache; React Flow for the DAG.
- **New table: `intent_ledger`** (project_id, purpose, success_criteria, accepted_tradeoffs, never_do, created/updated) — written at inception, editable, injected into every annotation/briefing prompt.
- **LLM calls:** headless `claude -p --output-format json` (no API key). Three call types — inception drafting, plan annotation, briefings — all now receive the Intent Ledger as context. Cached by content hash; graceful degradation to raw data on failure.
- **Prompt injection:** user-triggered only; every injected prompt shown before firing.

## 9. Phases (sequenced to retire uncertainty, not to demo value)

The ordering principle: each phase answers the biggest open question standing between the idea and reality. This PRD's own sequencing models the discipline Starship teaches.

### Phase 1 — Go/No-Go (the Shell)
**Strategic question:** can Claude Code's interactive TUI live inside our window at all?
- Electron shell, Project Shelf (manual folder add), embedded xterm.js terminal launching `claude` via node-pty/ConPTY.
- **Acceptance:** one complete real Claude Code session inside Starship with correct colours, resize, scrollback, Ctrl+C.
- **Named pivot:** if the TUI fights the embedded terminal irrecoverably, Starship pivots from *shell* to *companion* — observer panes beside the builder's own terminal. Same soul, different body. The pivot decision is made at the end of this phase, not deferred.

### Phase 2 — Inception & the Intent Ledger
**Strategic question:** can the idea→execution ritual collapse to minutes without losing the builder's authorship?
- Interview (intent first, then requirements) → Intent Ledger persisted → PRD/CLAUDE.md drafts from templates → review → commit action → cold prompt fired.
- **Acceptance:** new project from click to executing cold prompt in <5 minutes; the Intent Ledger visibly present in the generated PRD and cold prompt.

### Phase 3 — Observation
**Strategic question:** can we reconstruct Claude's real task state reliably from the outside?
- JSONL tailing + parser (versioned adapter, tolerant); kanban from TodoWrite; subagent strip from Task calls; status engine with *decision-needed* detection; OS notifications phrased at decision altitude.
- **Acceptance:** kanban lags reality by <2s in a live session; a real permission prompt produces a notification that names the decision, not just "waiting".

### Phase 4 — Command (strategic context)
**Strategic question:** can the reasoning be surfaced well enough that the builder never reads scrollback to answer "why"?
- Plan detection → DAG; annotation pass against the Intent Ledger (why this order, what tradeoff, which intent item it serves); task drill-in as decisions; session briefings per §6.2; Timeline.
- **Acceptance:** for a real multi-phase session, Travis answers "why is step 4 before step 5?" and "does this plan serve my stated intent?" from the Intent panel alone.

### Phase 5 — parked (rule-based auto-approval). Do not build without explicit instruction.

## 10. Risks

| Risk | Mitigation |
|---|---|
| ConPTY/TUI incompatibility | Phase 1 is the go/no-go; companion pivot is pre-named and pre-scoped |
| JSONL schema drift across Claude Code versions | Versioned parser adapter; tolerant parsing; pinned tested version in CLAUDE.md |
| Annotations degrade into operational noise | §6.2 altitude test applied to every prompt template; briefing prompts explicitly forbid file/tool-count framing |
| Intent Ledger becomes stale ceremony | Ledger is editable from the Build Room; briefings that reference stale intent will surface the mismatch naturally |
| Quota burn | Content-hash caching; once-per-session-end briefings; manual annotate button |
| Productisation creep | §5 is binding |

## 11. Success criteria

1. Starship is the default way every new side project starts within 2 weeks of Phase 2.
2. After a month, Travis can replay any project's idea→reality narrative from the Timeline, and can answer "why" for any node of any plan without opening scrollback.
3. Travis can articulate, at interview depth: the two-gaps thesis, altitude discipline, risk-first sequencing, the non-agentic boundary, and the Claude Code internals that make observation possible.
