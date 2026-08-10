# Starship Project Log

## 2026-07-29 — Mission Dashboard styling refresh (branch: feature/dashboard-styling-refresh)

Scoped down from an earlier full-mockup proposal (sidebar nav, tags, search,
favorites, editable Health Notes, global Activity/Notes views) to a
styling-only pass on the existing Mission Dashboard - same data, same
navigation model, no new SQLite tables. Done on its own branch specifically
so it's a clean revert if it doesn't earn its keep, rather than touching
`main`.

**What changed:**
- New `StatTiles.tsx`: Total/Active/Idle/Needs Attention/Ignored counts
  above the table, derived entirely from data the dashboard already fetches
  (`statusByProjectId`, `project.ignored`) - no new field.
- New `HealthBar.tsx`: replaces the old per-status pill strip
  (`NoteHealth`, now deleted) with one weighted score (fresh=25/
  implemented=50/tested=75/verified=100, averaged) rendered as a segmented
  bar + percentage + Excellent/Good/Fair/Needs work label. A project with
  zero notes still shows "No notes" rather than a fabricated score.
- New `ProjectDetailPanel.tsx`: the per-row action grid (Launch, File Map,
  Decision Record, Narrative Journey, Notes, Model & Provider selects, Skip
  permissions) moved out of an inline 2-column grid duplicated on every
  table row, into one panel for whichever project is selected. Every
  handler it calls already took a project/projectId before this change -
  this only relocates rendering, not the underlying launch/annotate/notes
  state.
- Table's Ignore checkbox column removed; ignoring now lives as a text
  toggle at the bottom of the detail panel.

**Assumptions made (no explicit sign-off needed, but worth surfacing):**
- Selected project defaults to the first visible row rather than starting
  with nothing selected, so the panel is never empty on load.
- If the selected project gets filtered out (e.g. ignored while selected,
  and "Show ignored" is off), the panel falls back to the new first visible
  project rather than closing - confirmed live via the verify skill, no
  crash.
- Kept the existing Activity heatmap column and the clickable
  PRD-summary/Project-Log-entry links under the project name unchanged;
  the mockup that inspired this pass didn't show either, but neither was
  asked to be cut and both are real existing signal.

**Verified live** via the `verify` skill (Playwright-driven real Electron
launch against a scratch root of empty throwaway project folders, so no
real headless `claude -p` call fired): stat tiles render, row click selects
and highlights, detail panel switches project and fires the same
File Map/Decision Record/Narrative Journey/Notes/Launch behavior as before,
health bar renders correctly including the "No notes" case, ignore-toggle
fallback doesn't crash. Full suite (236 tests) and typecheck both clean
before the live pass.

**Not done, deliberately out of scope for this pass:** sidebar navigation,
tags, search, favorites/star, global (cross-project) Activity/Notes views,
editable Health Notes, the account/workspace chip - all from the original
mockup, parked as a separate, larger decision if wanted later.

## 2026-07-29 — Git Tree action added (same branch)

New "Git Tree" button in the Project Detail Panel, next to Narrative
Journey. Shells out to `git log` (reusing the same spawn/resolveGitCommand
pattern `inception/createProject.ts` already uses for `git init`) and
renders the commit list with the same self-contained-HTML-with-inline-JS
pattern as File Map and Decision Record - no headless LLM call involved at
all, since git already provides structured history data directly.

**Scoping assumption (no explicit sign-off, logged per the "make a
reasonable call" instruction):** this renders a straight, single-lane
commit list (plain `git log` on HEAD, most-recent-first) - not a full
multi-branch graph with lane assignment the way gitk/GitKraken draw one.
A merge commit still appears and is tagged with its parent count, it just
isn't drawn as a second visual lane. Real branch-lane layout is a
meaningfully harder problem than this pass was scoped for; worth a
dedicated decision later if actually wanted.

Verified live via the `verify` skill against a real temp git repo (two
commits): commit list renders with hash/subject/author/date/ref badges,
click-to-detail pane shows full hash and parent list. Also covered with
real (non-mocked) `generateGitTree` tests against a throwaway temp repo,
including one exercising an actual `git merge --no-ff` to confirm
`isMerge`/parent-count detection. Full suite (241 tests, up from 236) and
typecheck clean.

## 2026-07-26 — Decision Record rebuild, verification paused

Code complete and committed: accumulation store, supersedes as its own pass, transcript-slice split reverted. Tests passing, typecheck clean.

Live verification: 1 of 3 generations done. Generation 1 found 21 decisions; flagship (sequential-vs-parallel backfill) correctly merged both reasons, backed by 1 evidence entry. Generation 2 started and was killed partway through; generation 3 never ran.

Paused here deliberately — real headless calls burn tokens fast and the design is already settled from earlier rounds.

When resuming, watch two things across further generations:
1. Does the flagship's evidence count grow past 1, or does it keep citing the same single source?
2. Any near-duplicate decisions with different wording that chose+over matching fails to merge?

## 2026-07-27 — Generation 2 run, accumulation-key problem confirmed

Generation 2 completed cleanly against the persisted store (~596s of real
headless calls; the 3 log-file slices hit cache from generation 1, so only
the transcript slice, merge pass, and supersedes pass actually re-ran
against the model). Accumulated count: 21 → 50 decisions.

Both watch items resolved, and not favorably:

1. **Flagship evidence did not grow.** The original flagship row (`chose:
   "Never run two backfill processes against the same SQLite file at
   once"`) is still stuck at evidence=1. Generation 2 *did* find 3 new
   evidence anchors for the same underlying decision, but under new
   wording (`chose: "Re-run retries sequentially against the SQLite
   file"`), which accumulateDecisionRecord's exact `(chose, over)`
   string-match treats as a distinct decision rather than a merge target.
2. **Near-duplicates dominate the growth.** ~12-13 duplicate pairs found
   across the 50 rows — same decision, reworded, filed as two rows instead
   of one (home/away splits, player-level-as-separate-module, 2000-01
   backfill extension, include-list filter, V3-vs-balldontlie, team-level
   only Phase 1, stop-push-after-2020-21, SQL views, Task Scheduler,
   V3-endpoint list, advanced-metrics-as-is, exclude-rolling-windows,
   stop-retrying-2025-26-gap — several pairs differ only by a trailing
   period). Roughly half of the 50 accumulated rows are duplicates, not
   genuinely new decisions.

Net: accumulation's `(chose, over)` exact-match key is too strict for a
model that reliably reworks phrasing between generations. More
generations will not fix this — it will add more differently-worded
duplicate rows, not consolidate them. Stopping before generation 3 per
plan: this is a design problem in the accumulation matcher, not something
more sampling resolves. Next step is a design decision (fuzzy/semantic
matching on chose+over, or a dedicated cross-generation dedup pass
analogous to the existing cross-slice merge pass) before spending another
real generation run.

## 2026-07-27 — Checkpoint: fix direction agreed, no further real runs yet

No code changes this entry — logging the decision before touching
anything. Generation 2's finding stands: ~50% of the 50 accumulated rows
are duplicates from reworded (chose, over) pairs, and the flagship's new
evidence forked into a second row instead of consolidating into the
original.

Fix direction: don't add a second dedup mechanism. Route accumulation
through the existing cross-slice merge pass instead of adding fuzzy
matching alongside the exact-string key — two matching mechanisms solving
the same problem is itself a duplication bug. Concretely: after each
generation, feed (this generation's decisions) + (all previously stored
decisions) into the same merge call slices already go through today,
producing one candidate list. The merge output replaces the stored set
entirely; nothing is keyed by exact chose/over strings anymore.

Before writing that code: run the 50 existing rows through one merge pass
to get a clean deduplicated baseline, then confirm generation 3
accumulates onto that baseline cleanly.

Holding here per the CLAUDE.md real-headless-call rule — no generation 3,
no further real `claude -p` calls, until this direction is reviewed and
confirmed at check-in.

## 2026-07-27 — Merge-based accumulation fix, code complete

Implemented the agreed direction: `accumulateDecisionRecord`'s exact
`(chose, over)` string-match is gone. Replaced with
`accumulateAcrossGenerations`, which re-offers every previously-stored
decision as a merge candidate (`accumulatedToRawDecision`, reversing
`verifyEvidence`'s ref format back to a raw file/sessionId) and routes
`(stored + this generation's merged candidates)` through the same
`mergeDecisionCandidates` pass slices already use — one deduplication
mechanism instead of two. The merge output is validated once against
current project logs/transcripts and replaces the stored set entirely;
nothing is keyed by exact string equality anymore. `generateDecisionMap`
now costs one extra headless call per generation (the accumulation-merge
pass) whenever there's more than one candidate in the combined stored+new
set.

Also found and fixed unrelated file corruption while editing this region:
three literal null bytes (`\0`) had been sitting inside string-template
spaces in the old `evidenceKey`/`decisionKey` helpers (e.g. `` `${a}\0${b}` ``
instead of `` `${a} ${b}` ``), invisible in the editor's rendered view but
real on disk — confirmed via a byte-level Node scan, not visible via
Grep/ripgrep (which silently reported "no matches" against the file
without flagging it as binary in one path, and correctly flagged
"binary file matches" once given an explicit path). Root cause not
determined; fixed via direct buffer rewrite since the surrounding code was
being deleted anyway. Worth remembering: if a future `Edit` exact-match
fails against text that Read displays correctly, check for embedded null
bytes before assuming the match string is wrong.

Added a regression test (`generateDecisionMap` > "accumulates a reworded
duplicate across generations into one decision via the merge pass, not a
second decision") that reproduces the flagship bug shape directly: two
generations, same underlying decision, reworded between them, mocked merge
pass recognizes and combines — asserts one decision survives with unioned
evidence, not two. Full suite: 233 tests passing, typecheck clean.

Per the paced instructions: proceeding now to Checkpoint A (pass one of
the model comparison, on the current model, against a 50-row baseline
merge) before touching any model setting.

## 2026-07-27 — Checkpoint A: pass one (Sonnet) of the 50-row baseline merge

**Where the 50 rows came from:** the live app's own userData DB
(`%APPDATA%\starship\starship.sqlite`) has no `decision_record_store` table
at all — it hasn't been relaunched since that table was added, so
generation 1/2's real run never wrote there. Recovered the actual 50-row
NoFlightZone snapshot instead from a leftover verify-session temp DB
(`%TEMP%\starship-decision-verify\verify.sqlite`, last touched
2026-07-27T08:15Z, matching generation 2's timestamp) — confirmed by
project name, row count, and content spot-check against the duplicate
pairs generation 2's entry already named.

**The call:** one real `claude -p` call (model: Sonnet — this project's
`.claude/settings.json` `"model"` field, unedited, confirmed as the file
that actually governs headless calls since `getHeadlessCwd()` runs them
with this repo as cwd). Standalone script
(`.scratch-verify/run-merge-pass.js`) that reconstructs the same
candidate-JSON payload `accumulatedToRawDecision` + `mergeDecisionCandidates`
would build in-app, and sends it through the real
`prompts/decision-map-merge.md` template — same prompt, same shape, just
outside Electron so it didn't need a UI-driven session. No write path was
touched; this is read-only against the recovered snapshot, nothing was
written back to any decision_record_store.

**Result: 50 candidates → 34 decisions.** Checked the three named
spots directly:

- **Flagship** (`"Never run two backfill processes against the same
  SQLite file..."` / `"Re-run retries sequentially..."`): merged into
  one row, evidence **1 → 3** (the exact stuck-at-1 symptom from
  generation 2 is gone — the reworded duplicate's 3 anchors are now
  attached to the single surviving row instead of forking a second one).
  `because` now reads: "A parallel retry pair crashed one process with a
  database-is-locked error that aborted the whole range mid-run, while
  sequential re-runs had zero lock issues. Simultaneous requests against
  the API also made throttling worse rather than better." — both original
  reasons present, nothing invented.
- **Include-list/exclude-list:** the 4 reworded near-duplicate rows in the
  50 collapsed to exactly 1, evidence unioned to 7 anchors across
  PROJECT_LOG.md/BACKFILL_LOG.md/DATA_DICTIONARY.md/transcript.
- **V3/V2 endpoint pair:** correctly handled as two genuinely *different*
  decisions, not merged into each other — "nba_api's V3 endpoints over
  balldontlie.io" (evidence 3, itself a merge of 2 raw near-duplicates) and
  "V3 endpoints over V2 endpoints" (evidence 2, a merge of 2 raw
  near-duplicates with a trailing-period-only wording difference) both
  survive as separate rows. This is the exact discrimination the old
  accumulator couldn't make either way (it never even tried, since it
  matched on exact strings) and the merge pass's own judgment — already
  trusted for cross-slice dedup — gets right here too.

Net: 16 of the ~16 duplicate rows generation 2 flagged appear to have
consolidated correctly, with no sign of a wrongful cross-decision merge in
a spot-check of the three named cases. Full pass-one output saved at
`.scratch-verify/pass1-sonnet-decisions.json` (kept alongside the recovered
input at `.scratch-verify/stored-entries.json` for pass two to reuse — not
committed, this is scratch state for the comparison only).

**Stopping here per Checkpoint A.** Not touching the model setting or
running pass two in this entry — that's the next step, on its own.

## 2026-07-27 — Checkpoint B: pass two (Haiku) and the model recommendation

**Correction to Checkpoint A above:** "this project's `.claude/settings.json`"
was wrong — this repo has no project-level `.claude/settings.json` at all.
The config that actually governs `claude -p`'s model (confirmed by checking
`modelUsage` in pass one's raw JSON output: 41,054 of 41,074 output tokens
billed to `claude-sonnet-5`) is Travis's **global**
`C:\Users\User\.claude\settings.json`. Its `"model"` field applies to every
Claude Code session on this machine, not just Starship's headless calls —
flagged to Travis before editing it, since that's a materially bigger blast
radius than "this pipeline's dedup pass." Switched it `"sonnet"` →
`"haiku"` per his go-ahead; confirmed via the same `modelUsage` field that
pass two ran 100% on `claude-haiku-4-5-20251001` (no Sonnet tokens at all).

**Pass two: 50 candidates → 34 decisions** — same count as pass one, but
not the same grouping. Diffing the two outputs' `chose` sets found exactly
3 rows worded differently enough to not string-match, all from the same
cluster of near-identical stop-retrying/cooldown decisions. Named
spot-checks:

- **Flagship:** merged correctly, evidence **1 → 3**, same 3 anchors
  Sonnet found. `because` differs in wording (Haiku kept candidate #1's
  original phrasing rather than re-synthesizing) but covers the same two
  reasons (lock crash + throttling) — not a completeness gap, just a
  different edit of equivalent content.
- **Include-list/exclude-list:** collapsed to 1 row, evidence unioned to
  **6** anchors (Sonnet got 7) — Haiku dropped one of two near-identical
  DATA_DICTIONARY.md anchors that differ only by a trailing clause. Minor;
  nothing fabricated, just one fewer of two overlapping real anchors kept.
- **V3/V2 vs V3-vs-balldontlie:** correctly kept as two separate rows,
  same as Sonnet.

**A finding beyond the three named checks, found by diffing the two full
outputs against each other:** Sonnet's pass one **wrongly merged two
genuinely different decisions** — "Stop the gap-date cleanup after 2
passes" (2026-07-23, PROJECT_LOG.md + BACKFILL_LOG.md) and "Stop retrying
the 2025-26 gap window for the night" (2026-07-20, PROJECT_LOG.md) — into
one combined row. These are separate real incidents on separate dates; the
07-23 raw candidate even says so explicitly in its own `because`: "**Per
the 07-20 lesson**, hammering a connection that's already shown same-day
degradation makes things worse rather than better" — citing the earlier
decision as precedent for a new one, not restating it. Sonnet also failed
to merge the 07-23 event's own legitimate BACKFILL_LOG.md duplicate into
its counterpart, leaving 3 rows across two real decisions instead of 2.
**Haiku got this one right**: 2 clean rows, one per real date/event, each
correctly collapsing its own duplicate pair (`collapsed: 2` each). This
directly contradicts Checkpoint A's "no sign of a wrongful cross-decision
merge" — that claim only checked the three cases named in the original
plan; this one surfaced by diffing the two passes against each other.

**A second finding, also beyond the three named checks:** the merge
prompt's own rule ("`collapsed`: use the highest value among the group,
**never sum**") — Sonnet followed it correctly on every merged row in this
run (every 1+1 group stayed `collapsed: 1`, matching `max`, and the one
pre-existing `collapsed: 7` group stayed 7). **Haiku violated it
systematically**: every one of its 15 merged pairs came out `collapsed: 2`
(1+1 summed, not maxed) — the `×7` group was the only one that happened to
survive at its correct value, because nothing merged into it. This is a
real, repeatable instruction-following miss, not a one-off — it inflates
the "how many times was this decided" UI badge, though it doesn't lose or
corrupt any actual decision content or evidence.

**Numbers:** total evidence entries across all 34 decisions — Sonnet 66,
Haiku 63 (the 3-anchor gap traces to the include-list drop above plus the
wrongful-merge/missed-merge difference redistributing anchors differently
across rows, not a broad pattern of dropped evidence).

### Plain recommendation

Genuinely mixed, and each model's error is a different *kind* of mistake:

- Sonnet's error (wrongly merging two different real decisions into one)
  is the higher-severity failure mode for this task specifically — it
  silently loses a real distinction in project history, which is exactly
  the "plausible-looking but wrong" risk this pipeline has been burned by
  twice before. It happened on the one case in this sample that actually
  required date/precedent reasoning to get right.
- Haiku's error (summing instead of maxing `collapsed`) is lower-severity
  — cosmetic, affects only a display count, never touches evidence or
  decision content — but it was systematic across nearly every merge in
  this run, not a one-off, suggesting Haiku reliably won't follow that
  specific instruction without the prompt being made more explicit (or
  without moving `collapsed` computation to code instead of trusting the
  model for it, which is a low-cost fix either way).

One comparison run is a small sample, and it does not clearly confirm the
original judgment-required categorization for the merge/dedup pass —
if anything, Haiku handled the hardest actual judgment call in this sample
(same-topic, different-date decisions) better than Sonnet did. But it also
doesn't clearly overturn that categorization either, since Haiku's
systematic rule-following miss is a real, repeatable defect of its own.
**Recommendation: don't move the merge/dedup pass to Haiku on this
evidence alone.** The sample is too small and the two error types too
different in kind to declare a winner. If revisiting this, the more
promising fix isn't switching models at all: harden the merge prompt to
explicitly warn against merging decisions that cite each other as dated
precedent, and stop trusting the model for `collapsed` — compute it in
code as `Math.max(...)` over the merged group the way accumulation already
does for evidence. Either change would independently close the one real
defect found on each side, on whichever model ends up running this pass.

**Model setting left on Haiku** (`C:\Users\User\.claude\settings.json`,
global) — not reverting automatically. This is Travis's call for his next
session: revert to Sonnet as the safer default given the merge-error
finding above, or leave on Haiku given the cost delta (pass two:
$0.15 / 188s vs pass one: $1.01 / 348s) and the fact that Haiku's own
error here was lower-severity and independently fixable in code.

**Stopping here per Checkpoint B.** No generation 3, nothing promoted into
any live `decision_record_store` (pass one and pass two both remain
`.scratch-verify/`-only diagnostics), no further real headless calls.
Everything past this point — reverting the model, hardening the merge
prompt, moving `collapsed` to code, running generation 3 — is a decision
for Travis's next session.

## 2026-07-27 — Model reverted, both Checkpoint B bugs fixed (no model chosen)

**Reverted the global model setting** (`C:\Users\User\.claude\settings.json`)
back to `"sonnet"`. It shouldn't sit on Haiku by default between sessions
just because a comparison happened to leave it there. Model choice for the
merge/dedup pass itself stays undecided, per instruction — this entry is
bug fixes only, not a decision either way.

**Fix 1 — same-topic/different-date merges (Sonnet's error).** Added an
explicit carve-out to `prompts/decision-map-merge.md`'s "What to merge"
section, using the actual failure from Checkpoint B as the worked example:
a candidate whose own `because`/evidence cites an earlier decision as
precedent ("per the 07-20 lesson...") is reporting its own separate
occurrence of that policy, not restating the earlier decision - don't
merge on `chose`/`over` similarity alone when that signal is present. This
is a prompt-only fix; there's no code path that does this kind of merging
itself to unit-test, so it can only be verified against a real run (next
comparison, whenever that happens - not in this session).

**Fix 2 — `collapsed` out of model output entirely (Haiku's error).**
Removed the field from both prompts' schemas (`decision-map.md`'s "Fields"
list and `decision-map-merge.md`'s "How to merge a group") and from the
`RawDecision` type in `decisionMap.ts` - the model is never asked for this
number at any stage now, extraction or merge. `collapsed` is instead
computed once, in code, at final validation
(`collapsedFromClusters` in `decisionMap.ts`): the highest
`occurrenceCount` among any `reasoningClusters` entry that one of the
decision's own transcript evidence anchors verbatim-matches, mirroring the
same cluster-membership check `verifyEvidence` already does; `1` when
nothing matches. This is computed fresh from clusters every time
regardless of how many raw candidates or generations fed into a decision,
which is what makes it immune to the summing bug by construction - there's
no group of numbers left for any model to combine, correctly or not.
`accumulatedToRawDecision` no longer carries `collapsed` forward either,
since `RawDecision` has no such field to carry.

Added two regression tests in `decisionMap.test.ts`
(`generateDecisionMapSingleCall`): one confirms a decision backed by a
3-occurrence reasoning cluster gets `collapsed: 3` even when the mocked
model response deliberately reports a bogus `collapsed: 99`; the other
confirms a log-only decision (no cluster match) gets `collapsed: 1` even
when the mock reports `collapsed: 5`. Both prove the field is ignored
outright, not merely validated. Full suite: 235 tests passing (up from
233), typecheck clean.

**Stopping here.** No further real headless calls, no re-running the
Sonnet/Haiku comparison, no model decision. Next step - re-running the
comparison against these two fixes, or deciding a model, or both - is
Travis's call.

## 2026-07-27 — Confirmation generation: first real entry in the live store

Ran the actual `generateDecisionMap` pipeline (compiled from current
`src/`, both Checkpoint B fixes included, model on Sonnet - the global
setting reverted above) against the real live `decision_record_store`
(`%APPDATA%\starship\starship.sqlite`, project `NoFlightZone`,
`598b38a2-0dd8-40ee-90c9-8ba99f4695f9`), not a scratch diagnostic. Called
`generateDecisionMap` directly from a standalone script run via Electron's
own Node runtime (`ELECTRON_RUN_AS_NODE=1`, needed for `better-sqlite3`'s
ABI) rather than driving the UI - same compiled code path, same db, same
real `claude -p` calls, just without a Playwright-driven window.

**First attempt failed partway through**, `extractionError`: `"claude -p
exited with 1: "` (empty stderr). Checked the live `headless_cache` table
before/after: exactly 5 new rows appeared - matching all 4 extraction
slices (3 log files + 1 transcript slice, per the error's own "3 log
file(s)... 64 transcript excerpt(s)" count) plus the cross-slice merge,
all succeeded and cached. The failure was the next real call
(`accumulateAcrossGenerations`, run for the first time against this live
store) or the supersedes pass - not narrowed further than that. Live store
was untouched (still 0 entries) since `generateDecisionMap`'s own
try/catch returns a clean empty-with-error result rather than a partial
write.

**Retried once**, since most of the work was now cached (cheap) and a
clean failure right after shipping new code is exactly the "something
looks broken" case worth one follow-up on. Second attempt succeeded
cleanly in 133s (vs 494s for the failed first attempt, most of which was
now served from cache): **27 decisions**, `extractionError: null`. Treating
the first failure as transient (a single flaky `claude -p` exit, not a
reproduction) rather than a confirmed bug - it didn't recur, and nothing
about the second run's stack trace or shape pointed at the new
accumulation code specifically. Worth watching for a repeat before
concluding either way.

**Live store confirmed: 0 → 27 entries for NoFlightZone.** This is now the
first real, non-scratch content in `decision_record_store`.

Checks:

1. **Flagship correct, not duplicated:** one row - "Run only one backfill
   writer process at a time against the same SQLite file/target... over
   running concurrent backfill write processes" - evidence: 2×
   PROJECT_LOG.md#2026-07-20 + 1 transcript, `because` covers both the
   lock-crash and the throttling reasons. Clean.
2. **Include-list/exclude-list: one row, not duplicated.** Evidence unions
   5 sources (PROJECT_LOG.md ×2, BACKFILL_LOG.md, DATA_DICTIONARY.md,
   transcript). Clean.
3. **No cross-date merges observed** - but this check didn't get a direct
   re-test of the exact failure case. This generation extracted fresh from
   the real current logs/transcripts (not the old 50-row snapshot), and
   this time only found ONE candidate for the "stop after N retry passes"
   pattern (`"Stopped the 2026-07-23 gap cleanup after two retry
   passes"`, BACKFILL_LOG.md only, `date: null`) - the 2026-07-20 sibling
   that caused the original wrongful merge didn't get extracted at all
   this generation (ordinary extraction variance, not a fix outcome
   either way). No decision in this run shows evidence spanning
   obviously-different dates, so there's no *sign* of the bug, but the
   specific pair that triggered it wasn't present to re-trigger it. Real
   confirmation of this fix needs a generation where both siblings get
   extracted again.
4. **`collapsed` counts are sane.** 26 of 27 decisions show `collapsed: 1`;
   the Windows Task Scheduler decision shows `collapsed: 7`, matching its
   known real cluster (7 repeated TaskCreate items) exactly as before -
   except this number is now entirely code-computed
   (`collapsedFromClusters`), never reported by either extraction or merge.

**Stopping here** per the single-confirmation-run instruction. Nothing
looked broken in the final result (the one retry is noted above, not
hidden), so no further runs. Open item for whoever looks at this next:
check 3 wants a generation that actually re-surfaces both dated siblings
to be a real re-test, not just an absence-of-evidence read.

## 2026-07-28 — Fix #1 re-verified: both dated siblings extracted, correctly kept separate

Committed both Checkpoint B fixes (cross-date merge carve-out in
`prompts/decision-map-merge.md`; `collapsed` moved out of model output
into `collapsedFromClusters`) as `1ec90be`. Then re-ran the same real
`generateDecisionMap` pipeline (rebuilt `dist/main` from current `src/`
first) against the live NoFlightZone store via
`.scratch-verify/run-confirmation.js` - one real generation, 772.7s,
`extractionError: null`. Live store: 27 → 32 decisions.

This is the direct re-test the previous entry's check 3 was left wanting:
this generation extracted both dated siblings that caused Sonnet's
wrongful merge in Checkpoint B -
"Wait for a cooldown period... before retrying" (2026-07-20,
transcript-sourced) and "Stopped the 2026-07-23 gap cleanup after two
retry passes" (BACKFILL_LOG.md) - and this time both survive as two
separate rows. The 07-23 row's own `because` still explicitly cites the
earlier one ("Per the lesson from 07-20, hammering a connection that had
already shown same-day degradation...") - the exact precedent-citing
signal the merge-prompt carve-out targets - and the merge pass correctly
did not collapse them. **Fix #1 confirmed working against the case that
motivated it**, not just an absence of the bug in a run that never
exercised it.

No other anomalies in the new 5 decisions (32 - 27): ordinary new
extractions from BACKFILL_LOG.md/transcript content (single-date
immediate-retry exception, row-count-vs-status-label check, overshoot
cutoff strategy, targeted-retry-over-full-pull choice), nothing
resembling a merge error.

**Stopping here** - single real-generation re-test per plan, no further
runs. Model still on Sonnet (reverted last entry); model choice for the
merge/dedup pass remains undecided.

## 2026-07-28 — Overnight housekeeping: scratch cleanup, carve-out regression test

No real headless calls this entry, deliberately - CLAUDE.md bars leaving
loops of real `claude -p` calls running unattended, so tonight's queue was
scoped to non-LLM work only.

**`.scratch-verify/` cleaned up.** Deleted the one-off DB-inspection
scripts (`check-cache*.js`, `check-ledger.js`, `dump-entries.js`,
`inspect-db*.js`), the Sonnet/Haiku comparison's raw dumps
(`pass1-*`/`pass2-*`, `stored-entries.json`, `pass-prompt.txt`), the
one-off `run-merge-pass.js`, and the latest `confirmation-result.json` -
all of it either superseded scratch or fully captured already in this
log's prose. Kept `run-confirmation.js`, the one genuinely reusable
verification-runner script.

**Added a regression test for fix #1's shape**
(`decisionMap.test.ts` > "keeps two same-policy, different-date
candidates as separate decisions when the merge pass says so - doesn't
re-collapse them in code"). The carve-out itself lives entirely in
`prompts/decision-map-merge.md` prose, so this can't test the prompt
- only today's real generation against live NoFlightZone data did that.
What this test pins instead: given a mocked merge response that already
(correctly) keeps two dated-precedent candidates separate, no code path
downstream - validation, evidence-anchor checking - accidentally
re-merges or drops one of them. Modeled directly on the real
07-20/07-23 cooldown-vs-gap-cleanup pair from tonight's confirmation run.
Full suite: 236 tests passing (up from 235), typecheck clean.

**Stopping here for the night.** Nothing further queued; the model
decision and any next real generation are next-session calls.

## 2026-07-28 — Mission Dashboard: Actions column stacked, per-launch model selector

Two refinements to the dashboard row actions, no headless calls involved.

**Actions column restacked into a 2-column grid** (`MissionDashboard.tsx`),
replacing the old single wide `flex flex-wrap` row (`w-[26rem]`/416px) with
`grid grid-cols-2 gap-2` at `w-72`/288px - a real width reduction, not just a
visual rearrange. Grouped as: Agent+Model selects, Skip permissions+Launch,
Intent+File Map, Decision Record+Narrative Journey, with Notes spanning both
columns as the odd one out. Verified visually via the `verify` skill
(Playwright-driven real Electron launch, not just a build check) - confirmed
no label truncation at the chosen width and added `title` tooltips on
Decision Record/Narrative Journey as a safety net regardless.

**Added a per-project Model dropdown** (Sonnet 5 / Opus 5 / Fable 5 /
Haiku 4.5, values are the full canonical model ids) next to the existing
Agent selector. Unlike Agent (still a scaffolded no-op - Codex/Antigravity
are disabled placeholder options that don't wire to anything), Model
actually does something: the selected value is passed as `--model <id>` in
the args `Launch`/`Resume` spawns the `claude` pty with
(`App.tsx`'s `onLaunch` handler). Disabled whenever Agent isn't `"claude"`,
since there's no model list wired for the other agents yet. New
`ClaudeModelKind` type in `shared/ipc.ts`; new `model_selected` activity
event and an updated `launch_fired` description in `ActivityLog.tsx`.

Full suite: 236 tests passing (unchanged - pure UI/wiring, no new test
surface), typecheck clean across shared/main/renderer.

**Also discussed, not built:** whether Codex (or another agent) could feed
Starship's observation pipeline. Conclusion, bookmarked in memory rather
than acted on: embedding another agent's TUI in the same terminal pane would
be cheap (pty spawn is command-agnostic), but Kanban/Timeline/Intent/
Decision Record depend on Claude's own JSONL format - a real scope
expansion, not a refinement. One promising angle for a later session:
`readProjectLogs` just reads `PROJECT_LOG.md` by filename, agent-agnostic -
if another agent is instructed (via its own equivalent of this file, e.g.
Codex's `AGENTS.md`) to maintain that log in the same dated-heading
convention, the *log-sourced* half of Decision Record would already read it
today, zero Starship changes. The *transcript-sourced* half (Kanban,
Timeline, Intent annotation) would still need Claude's raw JSONL - no
amount of "narrate diligently" instruction is a real substitute for that,
since it's self-reported summary rather than a mechanical ground-truth
record. No timeline on this - revisit when there's energy for it.

## 2026-08-06 — Fix: project slug dropped `.` and `_`, blanking observation for affected projects

**Reported symptom:** Wise Cow 2.0 showed no live signals, no "last activity",
and produced nothing on "exit and summarize".

**Root cause.** `slugProjectPath` (`src/main/observation/slug.ts`) reproduced
Claude Code's `~/.claude/projects/<slug>/` directory naming by replacing only
`:`, `\`, `/` and space with `-`. The real rule replaces *every* non-ASCII-
alphanumeric character. Any project whose folder name contained a `.` or `_`
therefore resolved to a directory that does not exist:

    D:\WEB PROJECTS\Wise Cow 2.0  ->  ...-Wise-Cow-2.0   (computed, missing)
                                  ->  ...-Wise-Cow-2-0   (real, 2 transcripts)

Two projects on this machine were affected: `Wise Cow 2.0` and `my_portfolio`.

**Why one bug produced all three symptoms.** Everything downstream resolves
through that one function, and every consumer fails *safe* rather than loud:
`correlateSession` filters candidate transcripts by the target-directory
prefix and simply never matches (stays unresolved — no live signals);
`findAllTranscriptsForProject` swallows the `readdirSync` ENOENT and returns
`[]` (no last activity); `briefing.ts` reads through `findNewestTranscript`,
so it had no transcript to summarize. Nothing errored anywhere — the feature
just went dark for those projects.

**Why it survived Phase 3 verification.** PHASE3_LOG.md recorded the slug as
"correct — manually computed and matched the real directory name exactly."
That was true, but was checked against `D:\WEB PROJECTS\starship`, whose name
contains neither of the two characters that break. Correcting that note.

**Fix.** Rule is now `replace(/[^a-zA-Z0-9]/g, "-")`, verified empirically
against all 24 real project directories on this machine by comparing each
transcript's own `cwd` field to its containing directory name — the new rule
matches all 24, the old rule missed 2. The duplicated copies of the rule in
`templates/permission-hook.cjs` and `scripts/acceptance-phase3.cjs` were
updated in lockstep (the hook names the signal files Starship reads back, so
the pair must agree). No signal files existed on disk, so no old-named data
was orphaned by the change.

**Decision:** kept one shared `slugProjectPath` rather than splitting it into
separate "Claude directory" and "our signal file" functions. The two uses are
genuinely different contracts and a split is defensible, but with no signal
files to preserve there was nothing to gain, and a silently diverging pair is
a worse failure mode than the documented duplication.

Regression tests pin the dot, the underscore, and case preservation. Full
suite 252 passing, typecheck clean.

---

## Intent Ledger: phantom field removed, drift measured

**Removed `learningGoal` from the Intent Ledger surface.** The field was
collected in the Inception wizard's intent step and rendered into PRD.md via
`{{learning_goal}}`, but it had no column in `intent_ledger` and therefore no
downstream reader ever saw it â€” briefing, intent annotation, decision map, and
narrative journey all read the DB row. Decision: delete rather than wire up.

Touched nine sites across four layers: the wizard field and its Discuss panel
(`Inception.tsx`), the `IntentInterview` type (`shared/ipc.ts`), the template
context map (`inception/templates.ts`), the `templates/PRD.md` Â§2 block, the
cold-prompt assembly (`inception/createProject.ts`), one test fixture, and a
descriptive clause in each of `prompts/inception-prd.md` and
`prompts/inception-discuss.md` â€” both prompts told the model the ledger
"includes learning goal", which would have described a field that no longer
exists. The template context map and the PRD template had to change together:
`renderTemplate` reports unfilled placeholders, so editing one alone would
either dangle a context key or surface a missing placeholder.

`PHASE2_LOG.md` still mentions the field and was deliberately left alone â€” it
is a historical record of what Phase 2 built, not current documentation.
Typecheck clean, full suite 252 passing.

**Measured ledger/PRD.md drift before deciding whether to sync them.** Editing
the ledger in-app updates the SQLite row that feeds every prompt, but never
rewrites the project's PRD.md Â§2 â€” the human-facing doc. Added
`scripts/intent-drift.cjs` (`npm run intent:drift`), a strictly read-only
diagnostic: DB opened `readonly + fileMustExist`, PRD files read-only, no fix
mode. It runs under Electron-as-Node because `better-sqlite3` is rebuilt
against Electron's ABI by the postinstall hook.

Similarity uses a token-level Dice coefficient rather than Levenshtein:
for prose, character distance overstates drift when a sentence is merely
reordered, while word overlap tracks how much meaning is still shared.
Unrendered `{{placeholder}}` values are reported as their own state rather
than scored as 0% â€” "never filled in" is a different problem from "drifted".

**Result across 31 projects:** 28 comparable field pairs, 24 exact, 4 drifted,
mean similarity 93.1%. Drift is concentrated, not diffuse â€” Bakas accounts for
three of the four (successCriteria 46.2%, acceptedTradeoffs 30.9%, neverDo
58.9%) and is the only project whose ledger and PRD were edited on different
days. Beacon's single drifted field is additive: the PRD has an extra
paragraph the ledger lacks. No conclusion drawn yet; the sync question is
still open.

---

## Intent Ledger backfill: dry run says there is nothing to backfill

Investigated backfilling `intent_ledger` rows from PRD.md Â§2 for projects
lacking one. Added `scripts/intent-backfill-dryrun.cjs`
(`npm run intent:backfill-dryrun`), read-only with no insert mode at all, which
imports the Â§2 parser, DB resolution, and project query from
`intent-drift.cjs` rather than growing a second copy of the label rules
(`intent-drift.cjs` now exports them and guards `main()` behind
`require.main === module`).

**Result: 0 of 24 candidates are backfillable.** 18 have no PRD.md on disk;
6 have a PRD.md that predates the template and carries no Intent Ledger
section. Not one project has a filled-in Â§2 without a DB row â€” the two
populations are disjoint. Backfill is not a viable source of ledger data;
these projects were added to the shelf directly rather than created through
Inception, so their intent was never captured anywhere.

**Parser defect found and fixed.** `parseIntentSection` matched any heading
*containing* "intent ledger", so this repo's own PRD matched
`### Phase 2 â€” Inception & the Intent Ledger` â€” a cross-reference, not a
section â€” and reported a found-but-empty Â§2 for `starship`. The heading rule is
now anchored after optional numbering (`## 2. Intent Ledger`), which still
tolerates renumbering and trailing qualifiers but rejects cross-references.
Drift totals are unchanged by the fix (28 pairs, 24 exact, 93.1% mean),
confirming it only corrected the false positive.

Correcting an earlier note in this log's previous entry: the count of projects
without a ledger row is 24 of 31, not 19.

---

## Session close â€” Intent Ledger cleanup, drift instrumentation, backfill ruled out

Consolidated summary of this session. The two entries above record the work as
it happened; this entry closes the session and captures two things not logged
elsewhere â€” the decision to keep the drift diagnostic permanently, and one open
question carried forward.

**1. `learningGoal` removed.** Nine edits across four layers (wizard field and
its Discuss panel, `IntentInterview` type, template context map, PRD template
Â§2, cold-prompt assembly, one test fixture, two prompt templates). The field
was captured at Inception and rendered into PRD.md but had no `intent_ledger`
column, so no downstream reader ever saw it â€” a phantom. Typecheck clean,
252 tests passing. `PHASE2_LOG.md` left untouched as historical record.

**2. `scripts/intent-drift.cjs` â€” kept permanently as a project-health
metric, not a one-off.** Read-only diagnostic (`npm run intent:drift`)
comparing each `intent_ledger` row against its project's PRD.md Â§2, scored by
token-level Dice coefficient. Runs under Electron-as-Node because
`better-sqlite3` carries Electron's ABI. Treating this as standing
instrumentation has a consequence worth stating: the Â§2 parser and the label
vocabulary are now a maintained contract, so changing the PRD template's Â§2
labels means updating the parser in lockstep, exactly as the removal of
`{{learning_goal}}` did.

**3. Â§2 heading parser false positive, fixed.** The parser matched any heading
*containing* "intent ledger", so this repo's own PRD matched
`### Phase 2 â€” Inception & the Intent Ledger` â€” a cross-reference â€” and
reported a found-but-empty section for `starship`. Heading matching is now
anchored after optional numbering. **All previously reported numbers survived
the fix unchanged: 28 comparable pairs, 24 exact, 4 drifted, 93.1% mean.** The
rendered output is not identical, and should not be â€” the `starship` row
correctly changed from "section found" to "no Intent Ledger section". That row
was the bug; the numbers were never wrong.

**4. Backfill ruled out.** Dry run across the 24 ledger-less projects
(`npm run intent:backfill-dryrun`, no insert mode) found **0 backfillable**:
18 have no PRD.md at all, 6 have a PRD.md predating the Â§2 template. There is
no recoverable intent data in either form. Projects with ledgers and projects
with a filled Â§2 are the same 7 projects â€” the populations are disjoint,
because every ledger was written by Inception and nothing else has ever
written one.

**5. Open decision, carried forward â€” no action taken.** Should projects added
directly to the shelf (bypassing Inception) get an intent-capture step, or is
ledger-less-by-design correct for that path? The drift data makes the stakes
concrete: 24 of 31 projects currently have every headless prompt assembled with
`intentLedger: null`, so annotation, briefing, decision map, and narrative
journey all run without intent context for the large majority of the shelf.
Deferred to a future session.

## 2026-08-07 — Intent Ledger retrofit for existing projects

**Decision, closing the open question above.** The shelf was never meant to be
a permanent intake path — it is pre-Inception backlog. All new projects go
through Inception; the shelf gets no intent-capture logic of its own. Instead,
intent can now be retrofitted onto an already-shelved project on demand,
reusing Inception's existing intent step rather than adding a parallel flow.

**What changed:**
- `ProjectDetailPanel.tsx`: the Intent action is no longer disabled once a
  project has activity. That gate (`project.lastActivityAt !== null`) encoded
  the assumption that intent is only captured before the first launch, which
  is exactly the assumption this decision reverses — and it was the one thing
  actually blocking retrofit, since most shelved projects have prior activity.
- New `IntentFields.tsx`: the four Intent Ledger questions plus their Discuss
  threads, extracted from Inception's intent step and now shared with the
  Intent Ledger editor. The two surfaces previously asked the same four things
  in different words; the wording lives in one place now. It holds no
  load/save/validation logic, because the callers' rules genuinely differ —
  Inception requires all four answers to advance, the editor saves partials.
- `IntentLedgerEditor.tsx`: uses the shared fields, and shows a "no intent
  captured yet" empty state framing partial answers as acceptable. Intent
  reconstructed after the fact is often only partly recoverable, and a
  half-answered ledger beats none.
- `hasIntentLedger` added to `MissionProject`, fed by a new batched
  `db.getProjectIdsWithIntentLedger` (same shape as `getNoteStatusCounts` —
  one query for the whole shelf, presence only, never the ledger's contents).
  Surfaced as an amber dot on the shelf row and the Intent button, so "which
  projects still need this" is answerable without opening each one.

**Deliberately not done:**
- *Project-aware Discuss.* Discuss stays project-blind: it never inspects the
  project and helps only from the conversation. Considered and declined —
  archaeological inference isn't needed for a shelf whose projects the builder
  already knows the purpose of.
- *Provenance flag.* Nothing distinguishes a ledger authored at Inception from
  one retrofitted later. Noted as a possible future column; not added.
- *Writing intent into project files.* A retrofitted ledger lives in Starship's
  SQLite only. Unlike Inception, which injects intent into the PRD.md and
  CLAUDE.md it generates, retrofit never touches an existing project's files —
  prime directive 1. Consequence, accepted knowingly: retrofitted intent
  reaches Starship's own briefings and annotations (`briefing.ts` already reads
  the ledger and tolerates null) but is invisible to Claude Code itself on
  relaunch, since it is in no file Claude reads and there is no cold prompt on
  a relaunch. Exporting it into a session is a manual, user-driven step.

**Tests:** 5 new cases in `db.test.ts` covering ledger presence — absent for a
never-Inception project, present after retrofit, present for a partially
answered ledger, batched separation of projects with and without, and the
empty-list case. The test fake gained `projects` and `intent_ledger` support.
Full suite: 257 passing. The `IntentFields` extraction itself is covered only
by typecheck — the renderer has no component test infrastructure, and adding
it was out of scope for this change.

**Verified in the running app** (Playwright Electron driver, throwaway SQLite
path): 19/19 checks. The Intent action opens on a project with real prior
activity — the case the old gate blocked; the shelf dot count moved 31 → 30
after a retrofit with the retrofitted row specifically losing its dot; a
partial save round-tripped; and Inception's intent step still renders all four
questions with a Discuss thread each. No headless `claude -p` call fired at any
point — the editor is a pure DB read/write and Discuss only fires on an
explicit Send.

## 2026-08-07 — Every headless feature was broken, silently

**Found by the CONTINUITY.md verification run, not by anything failing loudly.**
The first live run against Sinulid fell to the degraded path with
`Headless Claude returned non-object JSON.` One minimal diagnostic call
(`printf ... | claude.exe -p --output-format json`) showed why:

`claude -p --output-format json` now emits a **JSON array of stream events** —
`system`/init, `rate_limit_event`, `assistant`, then `result` — instead of a
single result object. `extractDraft` parsed the array, failed `isObject`, and
threw before ever looking at the payload, which sits on the trailing `result`
element.

**Blast radius: all nine callers of `runHeadlessClaude`** — session briefings,
File Map, Decision Map, Narrative Journey, Intent annotation, Inception
drafting, Inception Discuss, and project-log summaries.

**Why it went unnoticed, which is the part worth remembering.** Every one of
these degrades gracefully by design — Discuss answers "Couldn't reach the
assistant right now", `projectLogBriefing` silently falls back to the raw body,
`decisionMap` returns empty — and the content-hash `headless_cache` kept serving
older results for any prompt that had run before. Graceful degradation plus
caching is exactly the combination that turns a total outage into something that
looks like a quiet day. Worth remembering the next time a feature "still seems
fine".

**Fix:** `resolveResultEnvelope` accepts *both* shapes — the array (taking the
last `type: "result"` event) and the legacy single object. Deliberately not a
swap of one hard assumption for another, so a CLI change in either direction
cannot repeat this. A stream carrying no result event now throws a distinct,
accurate error rather than the misleading "non-object JSON".

Six tests cover it, written against the array shape **captured from a real run**
rather than an invented fixture: both envelopes, trailing-result selection,
in-envelope errors, the no-result-event case, and nested-JSON unwrapping.

**Two cosmetic bugs, both found only because the run used real project data:**
- `readPrdSummary` swallowed the `---` rule that Sinulid's PRD puts between its
  one-liner and the next heading, surfacing as a stray "---" mid-sentence. It now
  skips horizontal rules — which also fixes the shelf row, where the same stray
  text was showing.
- `describeDurableState` prefixed a date onto a project-log title that already
  began with one ("2026-07-25: 2026-07-25 - Phase 1 ..."), since
  `extractDatedHeadings` keeps the whole heading as the title.

**Live verification, second run: the normal path works.** Activity logged
`continuity_written`, all five sections populated from a real transcript, five
DECIDED bullets exactly at the cap, correct provenance line, and **0 non-ASCII
bytes** in 3,897. The rewrite also incidentally confirmed the clobber guard's
other branch: the degraded file from the first run was Starship-authored, so it
was correctly replaced rather than preserved.

Suite: **305 passing**, typecheck clean.

**Open, for Travis's judgment:** the note is structurally compliant but came out
at 3.9 KB — larger than either hand-drafted example — because nothing constrains
*bullet length*. The rules cap sections, bullets and characters, not verbosity.
See the next entry if a length rule gets added.
