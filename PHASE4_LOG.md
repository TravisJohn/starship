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
- The task-plan DAG described above (plan → graph, Intent Ledger annotation, task drill-in) was
  **discussed but deliberately not built** — see below for what replaced it.

## File Map — the DAG idea, redesigned (2026-07-13, same-day follow-up)

Discussing the DAG surfaced a real design fork. Initial framing followed the PRD closely: a
task/plan graph built from `TaskCreate`/`TaskUpdate` (including the real `addBlockedBy` dependency
edges found in TicTacToe's second session), annotated against the Intent Ledger, shown as a
toggleable alternative to the Terminal view. Two honest problems with that framing, worked through
in conversation rather than discovered after building:

1. **Structure is often absent, and that's not a defect.** TicTacToe's *first* session had zero
   dependency edges — a flat, correctly-sequential list. Engineering the DAG to look richer than
   the actual plan was would mean either inventing edges Claude never expressed, or padding for
   visual density. Conclusion: annotation quality matters more than topology; a thin, honest DAG
   isn't a problem worth solving. (This reasoning still applies to any *future* task-plan DAG —
   it just no longer needed solving today, see below.)
2. **Travis's actual want, on reflection, was a different graph entirely**: not Claude's task
   list, but a *loose, cross-session file-relationship map* — which files were built because of
   which others, across the project's whole history, downloadable as a standalone artifact,
   checkable mid-development from the Dashboard as well as the Terminal page. This replaced the
   task-DAG idea outright rather than sitting alongside it.

**What shipped**, built by Codex against `CODEX_BRIEF_file_map.md`, reviewed and live-verified
here:
- `findAllTranscriptsForProject` (`dashboard.ts`) — genuinely new capability: reads a project's
  *entire* session history, not just the newest transcript (`findNewestTranscript` refactored to
  be a thin wrapper over this rather than a separate scan).
- `src/main/fileMap.ts` — `buildFileTouchTimeline` walks every transcript chronologically,
  extracting only `Write`/`Edit` tool calls paired with the nearest preceding assistant reasoning
  (reasoning resets at each new transcript boundary — a much later session's file touch shouldn't
  inherit an much earlier, unrelated session's last words). `generateFileMap` computes node order
  deterministically from first-touch time (never asks the LLM to guess ordering — a deliberate,
  agreed deviation from asking an annotation pass to infer structure) and calls one headless
  request for edges + reasons only, bounded to one representative (first) touch per file rather
  than truncating to "most recent" (unlike Briefings, early files matter as much as late ones for
  a whole-project map). Same graceful-degradation posture as everything else: no transcripts →
  honest empty state; headless call fails → nodes with no edges, never an error.
- `renderFileMapHtml` — a genuinely self-contained HTML document (inline SVG + vanilla JS, zero
  external resources), left-to-right by first-touch order, click-a-node/click-an-edge
  interactivity. No React Flow — the PRD named it for an in-app DAG, but a *downloadable* artifact
  can't depend on Starship's React runtime; hand-rolled was the only fit.
- Two entry points sharing one `FileMapView` component: a Terminal-page toggle (CSS
  show/hide, not conditional unmount — the brief was explicit that switching views must not kill
  the live pty) and a Dashboard-level "File Map" button per project (via `FileMapOverlay`,
  matching `ProjectSummaryOverlay`'s exact pattern) that works with **no active Claude session at
  all**, since generation only reads past transcripts.

**Live-verified end-to-end against real data**, not just unit tests (105/105 passing, up from
99): ran the actual `TicTacToe` project (real multi-session history) through the Dashboard's File
Map button with no session running — got back 12 real file nodes and 16 real relationship edges,
correctly ordered, with working click-to-inspect. Downloaded the generated file and opened it in a
genuine standalone Edge browser window (not Starship, not Electron) — fully interactive there too,
confirming it's actually portable. Separately confirmed the Terminal-page toggle: launched a real
session, switched to File Map and back, and the terminal's live content was still present
afterward — the pty was never killed or remounted by the toggle.

**Known gaps carried forward:**
- The file-touch reasoning is only as good as what Claude happened to say in nearby assistant
  text — a session with terse tool-only turns and no narration will produce thin or absent edges
  for that stretch, same honest-emptiness principle as the task-DAG discussion above.
- No caching/persistence of a generated map — it's recomputed each time (cheaply, since
  `runHeadlessClaude`'s content-hash cache means no new LLM call unless the underlying file-touch
  history actually changed since last time).

## Project Log Summary — "where we left off" from PROJECT_LOG.md (2026-07-13, same-day follow-up)

Every real project Travis works on gets a `PROJECT_LOG.md` from his own *global* Claude Code
instructions (separate from anything Starship's per-project `CLAUDE.md` says). Confirmed by
reading six real examples (33 to 479 lines) before designing anything - at least one (`Huddle`)
already contained a literal `### Where to resume next session` section Claude wrote unprompted.
Two-tier design, built by Codex against `CODEX_BRIEF_project_log_summary.md`:
- **Free tier**: `findLatestProjectLogEntry` (`dashboard.ts`) parses every `## YYYY-MM-DD` heading
  and picks the one with the latest actual date - never relies on file position, since real logs
  disagree on convention (`TicTacToe` is chronological; `Huddle` explicitly states "Newest entries
  at the top"). Shown as a second clickable line on the dashboard row, under the PRD summary, at
  zero cost (no LLM call).
- **On-demand tier**: clicking it calls a new headless pass (`projectLogBriefing.ts`, its own
  prompt) that summarizes just that entry at decision altitude, reusing `runHeadlessClaude`'s
  existing cache with no new table - same reasoning as File Map's no-new-table choice. Its
  fallback on failure is deliberately different from Briefings/File-Map: it shows the entry's own
  raw text rather than a generic notice, since there's already a perfectly good human-written
  entry sitting right there.

**A real bug found and fixed during this review, not by Codex's own manual pass** (which it
explicitly flagged as not run): the initial tie-break for same-dated entries was "first occurrence
in the file wins," which is correct for `Huddle`'s convention but *silently backwards* for
`TicTacToe`'s - and both real projects turned out to log every one of their entries **on a single
calendar date** (`TicTacToe`: all four; `Huddle`: all seven), so this wasn't a rare edge case, it
was the norm. Fixed with a layered signal: if a log has 2+ *distinct* dates, compare the first and
last dated heading to detect direction; if every heading shares one date (so that comparison is a
no-op), fall back to scanning the file's own preamble for an explicit stated convention (the exact
"Newest entries at the top" sentence `Huddle` already contains) before defaulting to chronological.
Re-verified live against both real projects after the fix - `TicTacToe` now correctly shows "Phase
1 milestone: playable game complete" (not "PRD approved", the first entry logged that day), and
`Huddle` still correctly shows "Seed + verification pass" (not "Step 1: Project scaffolding", the
oldest). Both generated summaries were genuinely good: Huddle's precisely echoed the log's own
"resume next session" content without being told to look for it specifically.

`npm run test`: 117/117 (up from 105, including two regression tests locking in the same-date
tie-break fix for both real conventions).

**Known gap carried forward:** the preamble-scan fallback is a heuristic, not a guarantee - a
single-date log with no stated convention and no other signal defaults to chronological. This
matches both real projects observed so far but isn't provably correct for a hypothetical
single-date, reverse-chronological log that also states no convention.
