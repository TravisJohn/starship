# Starship Phase 4 Log

Phase 4 scope per PRD §9 ("Command"): plan detection → DAG; annotation pass against the Intent
Ledger; task drill-in as decisions; session briefings per §6.2; Timeline. Strategic question: can
the reasoning be surfaced well enough that the builder never reads scrollback to answer "why"?

**Note on how this phase actually started:** there was no formal go/no-go ceremony moving from
Phase 3 to Phase 4 — Travis raised two concrete Terminal-page gaps (no exit action, no signal that
more phases exist beyond what's currently tracked) mid-conversation, and the first of those turned
out to be exactly the "Briefings" capability PRD §7 already named. Logged here rather than
retroactively pretending a clean phase boundary occurred that didn't.

## What shipped (2026-07-13)

### Roadmap strip (additive, not itself Phase 4 core, but PRD-derived context)
- `readPrdPhases` (`src/main/dashboard.ts`) — reads a project's own PRD.md, finds its `## N.
  Phases` heading tolerant of numbering/casing drift (same approach as the existing one-liner
  extraction), and splits it into per-phase `{title, body}` entries at each `### Phase N — ...`
  sub-heading.
- Deliberately does **not** attempt to identify which phase is "current" — nothing in the
  transcript reliably signals phase completion, and a confidently-wrong guess would be worse than
  the honest gap it's meant to close. This was an explicit, discussed tradeoff (Travis chose the
  "show the whole roadmap, don't guess" option over attempting inference).
- `RoadmapStrip.tsx` renders every phase as a compact, visually separate strip on the Terminal
  page — styled distinctly from the Kanban so it can't be mistaken for Claude's own tracked
  tasks. New IPC channel `project:getPhases`.
- Verified against the real `TicTacToe` project (which genuinely has 3 phases: the game itself,
  a scoreboard, deploying online) — correctly extracts all three with full body text.

### Session Briefings ("Exit & Summarize") — PRD §7's named Phase 4 capability
The Terminal page previously had a bare "Dashboard" button with no exit semantics and no
recollection of what happened in a session. Replaced with **Exit & Summarize**, matching the
design already scoped earlier in this conversation before Phase 3 verification took priority.

- `prompts/briefing.md` (new) — decision-altitude summarization prompt, explicitly forbidding
  operational framing per §6.2, relating the session back to the Intent Ledger where relevant,
  instructed to say plainly when there's nothing to report rather than padding. Same rule
  structure as the existing Inception prompts.
- `src/main/briefing.ts` (new) — `buildSessionNarrative` reads the project's newest transcript
  (via `findNewestTranscript`, extracted from `dashboard.ts`'s existing "last activity" scan so
  both share one implementation) and produces a condensed, readable narrative: the builder's own
  prompts, Claude's text responses, and a one-line mention of each tool used. Deliberately a
  **separate, simpler reader** from `parser/parseLine.ts` — that parser serves the Kanban/status
  engine's structured event needs and is heavily depended-on/tested; the briefing needs prose, not
  structured events, and mixing the two concerns risked destabilizing already-solid machinery for
  no benefit. Bounded to the most recent ~12,000 characters so an unusually long session can't
  blow through the headless call's context or cost.
- `generateSessionBriefing` composes the narrative + Intent Ledger into the prompt, calls the
  existing `runHeadlessClaude` (generalized beyond Inception, unmodified), and saves the result.
  Falls back to a plain, honest notice (never a fabricated summary) if there's no transcript yet
  or the headless call fails — same graceful-degradation posture as Inception's drafting pass.
- New `session_briefings` table (`db.ts`) — one row per project, latest briefing only. A Timeline
  assembling a full history of briefings is explicitly later PRD scope (§7), not this pass.
- New IPC: `briefing:generate` (fires on Exit & Summarize) and `briefing:getLatest` (fetched when
  a Terminal session starts, to show a dismissible "Since last time: ..." banner).
- Renderer flow: clicking Exit & Summarize kills the pty immediately (Terminal unmounts right
  away, same as the old Dashboard button) — the summary is never a blocker on leaving. A
  transitional `SessionBriefingScreen` shows "Summarizing…" then the result, with a "Continue to
  Dashboard" action.

**Live-verified end-to-end**, not just unit-tested: launched a real project, had a real short
Claude Code exchange, clicked Exit & Summarize, and got back a genuinely good, honest summary
("Trivial smoke-test session — a one-line hello exchange with no tools used, no files touched,
and no decisions made. Nothing to relate to the Intent Ledger; there's simply no substance
here.") — then confirmed that exact summary reappeared as the "Since last time" banner on
relaunching the same project. `npm run test`: 99/99 (up from 83; new coverage for
`readPrdPhases`, `buildSessionNarrative`, and the `session_briefings` DB methods — the "briefing
prompt-assembly must have unit tests" line already sitting in CLAUDE.md's Commands section,
written before either of these existed).

## Known gaps / deliberate simplifications
- **"Since last time" only reflects sessions actually exited via Exit & Summarize.** If a session
  ends by just closing Starship or killing the process another way, that activity won't be
  captured until the *next* Exit & Summarize captures it retroactively (since briefing generation
  always summarizes the newest transcript, not specifically "the one just exited"). Acceptable
  for v1 given the trigger is now an explicit, deliberate action rather than automatic-on-every-
  exit, but worth remembering if this surprises anyone later.
- **No Timeline yet** — only the latest briefing per project is kept. Assembling a full history is
  named, later PRD scope, not attempted here.
- **Roadmap strip has no completion signal at all**, by design (see above) — it is pure reference
  context, not a progress tracker.
- The DAG itself (plan → graph, Intent Ledger annotation, task drill-in) is **not started**. Real
  transcript data exists to build it from — TicTacToe's second session used real `TaskUpdate
  addBlockedBy` dependency edges between tasks, not just flat sequential completion — but nothing
  in Starship parses that field yet (`taskShape.ts`'s `interpretTaskUpdateInput` currently
  discards any `TaskUpdate` call that isn't a `{taskId, status}` pair). This is the next real
  conversation.
