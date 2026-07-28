# Starship Project Log

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
