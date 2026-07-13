# Starship Phase 2 Log

Phase 2 scope: Interview (intent first, then requirements) → Intent Ledger persisted →
PRD/CLAUDE.md drafts from Travis's templates → review → commit action (folder, git init,
first commit) → cold prompt composed with the intent embedded, fired.

**Note on this log:** Phase 2 was built and committed (`af99db1` through `3fd3ff2`) without a
`PHASE2_LOG.md` at the time, breaking from the T1-per-task logging convention `PHASE1_LOG.md`
established. This entry reconstructs the record retrospectively from the commit history and
current source, so it documents *what shipped and why the code reads the way it does*, not a
contemporaneous decision trail. Treat the "Decisions" sections as inferred from the diffs, not
as verbatim reasoning captured at build time.

## What shipped

### Intent Ledger persistence (`af99db1`)
- `intent_ledger` table added to `db.ts`: purpose, success criteria, accepted tradeoffs,
  never-do, keyed by project id, per PRD §8.
- Editable after creation (`ef4a855` adds the edit path) — matches PRD §6.3's mitigation for
  "ledger becomes stale ceremony": the ledger lives in the Build Room, not just at inception.

### Inception interview flow (`ab17973`)
- Renderer-side interview captures intent (purpose, success criteria, accepted tradeoffs,
  never-do, learning goal) before requirements (project name, one-liner, audience, first-version
  scope, out-of-scope, stack, constraints) — intent-first ordering matches PRD §7.

### Templates + drafting (`995c506`, `90acd07`)
- `src/main/inception/templates.ts` reads Travis's templates from `templates/PRD.md` /
  `templates/CLAUDE.md` (or `STARSHIP_TEMPLATE_DIR` for tests), fills `{{placeholder}}` tokens
  from the interview, and reports any placeholder the interview didn't cover
  (`missingPlaceholders`) rather than silently leaving `{{...}}` in the output.
- `src/main/inception/headlessClaude.ts` shells out to `claude -p --output-format json`
  (no API key, no SDK loop — per the fixed stack). Requests are cached by
  `sha256(namespace + prompt)` in SQLite (`getHeadlessCache`/`saveHeadlessCache`), satisfying
  PRD §8's "cached by content hash."
- `src/main/inception/draftDocuments.ts` sends the rendered template + Intent Ledger + raw
  requirements as JSON payload to two prompt templates (`prompts/inception-prd.md`,
  `prompts/inception-claude.md`). Both prompt files explicitly forbid operational framing and
  keep the Intent Ledger visible — the altitude rule from CLAUDE.md is enforced in the prompt
  text itself, not just left to convention.
- **Graceful degradation is load-bearing, not incidental.** If the headless call throws for
  either document, `draftInceptionDocuments` catches it per-document, falls back to the
  *rendered template* (no LLM pass) for that one document, and returns `usedFallback: true` plus
  the error text. The caller/UI can see and surface that a draft is templated rather than
  Claude-authored. This is precisely the behavior the acceptance harness caught today (see
  below) — it is a designed fallback path, not a crash.

### Project creation + cold prompt (`18adf35`)
- `createInceptionProject` requires a located root (`db.getRootPath()`), sanitizes the project
  name into a filesystem-safe folder name, refuses to create into a non-empty existing
  directory, writes `PRD.md`/`CLAUDE.md`, runs `git init` + `git add` + a first commit
  (`chore: initial project brief`, authored as `Travis <travis@starship.local>` so acceptance
  runs don't depend on the real machine's global git identity), then persists the project and
  Intent Ledger row.
- `composeColdPrompt` builds the fired prompt as: read PRD/CLAUDE.md first, the full Intent
  Ledger inline (purpose/success/tradeoffs/never-do/learning goal), the one-liner and
  first-version scope, then an explicit instruction to present a phased plan and wait for
  approval before writing code. This is the "intent visibly present in the... cold prompt"
  acceptance bar from PRD §9 satisfied structurally — every fired prompt carries the ledger
  verbatim, it can't drift silently.
- Per CLAUDE.md's "every injected prompt is shown to the user before firing" — the compose step
  is separate from the fire step, implying a review surface exists in the renderer
  (`ColdPromptReview.tsx`) between the two.

### Acceptance harness (`3fd3ff2`)
- `scripts/acceptance-phase2.cjs` drives the real app: locate root → run Inception through the
  UI → real headless Claude drafting calls → verify the ledger appears in generated docs → fire
  the cold prompt into a live Claude session.

## Known risks carried forward
- **Headless drafting depends on an interactive-session-free, authenticated `claude` CLI being
  reachable at spawn time.** There's no explicit timeout on `spawnClaude`; a hung or
  rate-limited CLI process would hang the drafting promise rather than failing fast into the
  fallback path.
- **Fallback is silent to the builder unless the UI surfaces `usedFallback`/`errors`.** Worth
  confirming `Inception.tsx` actually renders that to Travis — a templated PRD masquerading as a
  Claude-authored one violates "keeping strategic intent visible," not just an internal detail.
- **`STARSHIP_CLAUDE_COMMAND`/`STARSHIP_TEMPLATE_DIR`/`STARSHIP_PROMPT_DIR` env overrides exist
  only for test isolation** — confirmed unused in the packaged production path other than as an
  escape hatch; no risk unless someone sets them by accident in a normal run.

## Acceptance status
- **Not confirmed passing.** Re-run today (2026-07-13) against the live app:
  `acceptance-phase2.cjs` failed with `Headless drafting fell back to templates` — the real
  `claude -p` call inside the harness's temp workspace did not return a usable draft, so both
  documents took the template-only fallback path described above. This is the *documented*
  degradation behavior working as designed, not a new bug, but it means the harness's actual
  goal — proving the live headless-Claude drafting path produces a real draft, not just a
  filled template — is unverified right now.
- Suspected cause: environmental. The same terminal session showed a Claude Fable 5 promotional
  banner and "3 MCP servers need authentication" at prompt time, either of which could make a
  headless `-p` call fail, time out, or return non-JSON output that `extractDraft` rejects.
  Not yet root-caused against `spawnClaude`'s actual stderr from a failing run.
- No go/no-go recorded for Phase 2. Unit tests for the parser/template/ledger logic are green;
  the live drafting path and the "<5 minutes idea-to-cold-prompt" UX bar have not been
  re-verified end-to-end since this log was written.
