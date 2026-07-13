# Codex build brief — "Where we left off" from PROJECT_LOG.md

**Repo:** Starship (Electron + React 18 + TS + Tailwind, better-sqlite3, typed IPC). Read
`CLAUDE.md` at the repo root in full before touching anything — it is binding, not background.
Also skim `PHASE4_LOG.md` for the Roadmap-strip, Session-Briefing, and File-Map features that
shipped just before this one — this brief follows their exact patterns (graceful degradation,
content-hash caching via `runHeadlessClaude`, decision-altitude prompt rules, tolerant markdown
parsing) rather than inventing new ones.

## What this is, in one paragraph

Every real project Travis works on ends up with a `PROJECT_LOG.md` at its root — not from
Starship's own generated `CLAUDE.md`, but from Travis's separate *global* Claude Code instructions
("create a PROJECT_LOG.md... log every major decision, milestone, and change"), which apply
regardless of what any specific project's own CLAUDE.md says. This is a real, rich, human-readable
narrative Claude itself curates — confirmed by reading six real examples, ranging from 33 to 479
lines, and at least one (`Huddle`) already contains a literal `### Where to resume next session`
section written by Claude on its own initiative. This feature surfaces that on the Mission
Dashboard as a two-tier thing: a free, always-visible "last logged milestone" title per project
row, and a click-triggered, cached, decision-altitude summary of that milestone in an overlay.

**The one real complication, discovered before writing this brief, not after:** the log's entry
order is not consistent between projects. `TicTacToe`'s is chronological (oldest first);
`Huddle`'s explicitly states "Newest entries at the top" and is reverse-chronological. Any
"grab the top/bottom entry" approach would be wrong for one of the two conventions. The fix:
parse every dated heading, compare actual dates, and take whichever is chronologically last —
never rely on file position.

---

## Current state (read before editing)

- `src/main/dashboard.ts` — home for `readPrdSummary` and `readPrdPhases`, both of which read a
  project's own `PRD.md` with tolerant heading regexes and graceful `null`/`[]` fallbacks on any
  failure (missing file, missing heading, empty body). `readPrdPhases` in particular already
  contains the exact "collect heading's body until the next heading of equal-or-shallower depth"
  boundary logic you need to reuse here (same file, different source document). Read both
  functions fully before writing `findLatestProjectLogEntry` — you are extending this file's
  existing style, not inventing a new one.
- `src/main/briefing.ts` and `src/main/fileMap.ts` — both are the closest analogs for the new
  headless-summarization pass here. Note that `fileMap.ts` deliberately does **not** import
  `briefing.ts`'s private helpers (its own `stripCodeFence`/`readPromptTemplate`/etc. are
  self-contained duplicates) — follow that same precedent for the new file in this brief. Small
  duplicated private helpers across these modules are an accepted tradeoff here, not something to
  "clean up" by introducing cross-module coupling.
- `src/main/inception/headlessClaude.ts` — `runHeadlessClaude(db, { cacheNamespace, prompt, cwd })`
  is fully generic, content-hash cached in the `headless_cache` table. Reuse directly with a new
  `cacheNamespace`. **No new DB table needed for this feature** — unlike Session Briefings (which
  need to show something passively on next open, hence a persisted "latest" row), this is
  click-triggered only; the existing cache is sufficient, same reasoning as why File Map needed no
  new table.
- `src/renderer/components/ProjectSummaryOverlay.tsx` — the exact overlay pattern to copy
  (backdrop blur, centered panel, Escape/click-outside dismiss, a heading + body + Close button).
  This feature's overlay is closer in shape to this one than to `FileMapOverlay` (no iframe, no
  download, just text and a loading state).
- `src/renderer/components/MissionDashboard.tsx` — the `prdSummary` clickable line (in the Project
  cell, under the name/path) is the exact pattern the new "last logged milestone" line follows —
  same cell, one more line, same click-affordance styling (`role="button"`, `tabIndex`, Enter/Space
  keydown handling — copy that block, don't reinvent it).
- `src/shared/ipc.ts` / `src/main/preload.ts` — follow the exact existing pattern for every new
  type and channel (see `briefing:generate` or `fileMap:generate` as the closest analogs).

---

## Part 1 — Backend: shared extraction (`src/main/dashboard.ts`)

### `findLatestProjectLogEntry`

```ts
export type ProjectLogEntry = {
  date: string;   // the raw YYYY-MM-DD matched, for sorting/comparison only
  title: string;  // the full heading line's text after "## ", as-is - do not
                  // try to strip the date or reformat it (see below)
  body: string;
};

export const findLatestProjectLogEntry = (projectPath: string): ProjectLogEntry | null => { ... }
```

Logic:
1. Read `path.join(projectPath, "PROJECT_LOG.md")`. Missing file, unreadable, or empty content →
   `null` (same defensive `try { fs.readFileSync } catch { return null }` pattern already used
   everywhere else in this file).
2. Find every heading line matching a dated pattern: `/^##\s+(\d{4}-\d{2}-\d{2})/` (a `##`-level
   heading starting with an ISO date — confirmed this matches both real examples: `## 2026-07-13
   — PRD approved` and `## 2026-06-22 (evening) — Seed + verification pass...`). Do **not** assume
   deeper heading levels (`###`) are entry boundaries — those are sub-sections *within* an entry
   (see `Huddle`'s `### Done & verified working` / `### Where to resume next session`), not
   separate entries.
3. Among all matches, pick the one with the **lexicographically greatest date string** (ISO
   `YYYY-MM-DD` sorts correctly as plain string comparison — no need for `Date` parsing). If there's
   a tie, keep whichever occurs first in the file (arbitrary but deterministic - document this
   choice in a comment, don't spend effort on a "smarter" tiebreak).
4. For the winning heading: `title` = everything after `## ` on that line, trimmed, **as-is** — do
   not attempt to strip the date, strip trailing emoji, or reformat it. Real examples mix
   parentheticals, em-dashes, and emoji in ways that would make surgical cleanup fragile; showing
   the raw heading text is honest and matches how `readPrdSummary` already treats extracted text.
5. `body` = every non-blank line between this heading and the next `##`-level heading (or end of
   file) — reuse `readPrdPhases`'s exact boundary-scanning approach (heading-depth comparison via
   `match(/^(#+)\s/)`), joined the same way `readPrdSummary` joins its collected lines (single
   spaces, collapsed whitespace) - a plain paragraph is fine, it's LLM input, not something
   rendered directly.
6. If no dated heading is found anywhere → `null`. Do not fall back to "the first heading
   regardless of format" or similar — an honest `null` (nothing shown) is correct per this
   project's established "don't guess" discipline; a project with a `PROJECT_LOG.md` that doesn't
   follow the dated-heading convention just doesn't get this feature yet.

Add tests to `src/main/dashboard.test.ts` (mirror `readPrdPhases`'s existing test style/fixtures
exactly): a chronological log (oldest-first, `TicTacToe`-shaped) correctly picks the *last*
heading; a reverse-chronological log (newest-first, `Huddle`-shaped, explicitly stating "Newest
entries at the top" in the fixture) correctly picks the *first* heading — **both must resolve to
the entry with the latest date, proving the function doesn't rely on file position at all**;
missing file → `null`; a file with headings but none dated → `null`; a single-entry file; entry
`body` correctly stops at the next `##` heading and does not swallow content past it (including a
case with a `###` sub-heading inside the body, which must **not** be treated as a boundary).

### Wire into `decorateProjects`

Add `projectLogEntry: findLatestProjectLogEntry(project.path)` alongside the existing
`lastActivityAt`/`prdSummary` fields. Add `ProjectLogEntry` to the `MissionProject` type in
`src/shared/ipc.ts` (`projectLogEntry: ProjectLogEntry | null`) — this is eagerly computed for
every project on every dashboard load/rescan, same as `prdSummary` already is, since it's a cheap
synchronous file read with no LLM call involved.

---

## Part 2 — Backend: the on-demand summary (`src/main/projectLogBriefing.ts`, new file)

### Prompt (`prompts/project-log-summary.md`, new)

Same rule structure as `prompts/briefing.md` — decision altitude, no fabrication, JSON-only
output. Given one dated entry (title + body, not the whole log — Huddle's is 479 lines total but
you only need its most recent entry, which is self-contained), produce a short "where things left
off, what's likely next" summary:

```
You are Starship's project-log summarization pass.

Rules:
- Stateless single-shot summarization only. Do not use tools. Do not inspect files. Do not execute commands.
- You are given one dated entry from a project's own running decision log - its title and full body text. This is Claude's own prior narration, not a raw transcript - treat it as already-curated context, not something to second-guess.
- Speak at decision altitude: what was decided or completed, what (if anything) is explicitly left for next time, what a builder should know before diving back in. Never restate file/tool-call operational detail as the primary point, even if the entry itself contains some.
- If the entry already states what to resume next, lead with that - don't bury a builder's own explicit next-step note under a generic restatement.
- Two or three sentences, not a report.
- Do not fabricate anything beyond what the entry actually says.
- Return only a JSON object with this shape: {"summary":"<the summary text>"}

Input:
{{payload_json}}
```

### `generateProjectLogBriefing`

```ts
export const generateProjectLogBriefing = async (
  db: StarshipDb,
  request: { title: string; body: string }
): Promise<{ summary: string }> => { ... }
```

Compose `{ title, body }` into the prompt (`payload_json`), call `runHeadlessClaude(db, {
cacheNamespace: "project-log-summary", prompt, cwd: getHeadlessCwd() })`. The cache is naturally
keyed correctly here with no extra work: the prompt text contains the actual entry content, so a
different entry (or an updated log producing a new latest entry) automatically produces a
different cache key - nothing to invalidate manually.

On success, parse the same tolerant JSON/code-fence-stripped shape `briefing.ts`'s `extractSummary`
already uses (write your own small equivalent here, per the no-cross-import precedent above). On
any failure (headless call throws, response doesn't parse) — **fall back to returning the entry's
own raw `body` as the summary**, not an error message. This is a deliberately different fallback
than Briefings/File-Map's "empty/honest-notice" fallback: unlike those, there's already a
perfectly good human-written entry sitting right there, so degrading to "just show what Claude
already wrote" is strictly better than a generic failure notice.

Register `registerProjectLogBriefingHandlers(db)` with one handler:

```ts
ipcMain.handle(
  "projectLog:summarize",
  async (_event, request: ProjectLogSummarizeRequest): Promise<ProjectLogSummarizeResponse> => {
    const { summary } = await generateProjectLogBriefing(db, request);
    return { summary };
  }
);
```

Note the request carries `{ title, body }` directly (not `projectId`/`projectPath`) - the renderer
already has this from the dashboard's eagerly-loaded `projectLogEntry` field, so there's no reason
to re-read the file server-side; keep this handler a pure function of its input.

Call `registerProjectLogBriefingHandlers(db)` from `src/main/index.ts` alongside the other
`register*Handlers` calls.

Add `src/main/projectLogBriefing.test.ts` covering the prompt-assembly/fallback behavior at
minimum (mirror `briefing.test.ts`'s style) - a full live-call test isn't expected in unit tests,
same boundary already established for `generateSessionBriefing`/`generateFileMap`.

---

## Part 3 — IPC (`src/shared/ipc.ts`, `src/main/preload.ts`)

```ts
export type ProjectLogEntry = {
  date: string;
  title: string;
  body: string;
};

export type ProjectLogSummarizeRequest = {
  title: string;
  body: string;
};

export type ProjectLogSummarizeResponse = {
  summary: string;
};
```

Add `"projectLog:summarize"` to `RendererToMainInvokeMap` (request/response as above), and expose
`window.starship.projectLog.summarize` in preload, following the exact existing pattern for e.g.
`briefing.generate`. Add `projectLogEntry: ProjectLogEntry | null` to `MissionProject`.

---

## Part 4 — Renderer

### `MissionDashboard.tsx`

In the Project cell, directly below the existing `prdSummary` clickable line, add a second
clickable line when `project.projectLogEntry` exists — copy the `prdSummary` block's exact
click/keydown/styling pattern (`role="button"`, `tabIndex={0}`, Enter/Space handling, same
truncate + hover-color treatment), showing `project.projectLogEntry.title` as the text. Clicking
it opens a new overlay (see below) and logs an activity event `project_log_opened` (same
`appendActivity` pattern as `openSummary`/`openFileMap` — `{ eventType: "project_log_opened",
projectId: project.id }`).

### New component `src/renderer/components/ProjectLogOverlay.tsx`

Structurally copy `ProjectSummaryOverlay.tsx` (backdrop blur, centered panel, Escape/click-outside
dismiss, heading + Close button) rather than `FileMapOverlay` — this one has no iframe/download,
just text. Props: `project: MissionProject | null`, `onClose: () => void`. On open (when `project`
transitions from null to non-null), call `window.starship.projectLog.summarize({ title:
project.projectLogEntry.title, body: project.projectLogEntry.body })`; show a brief "Summarizing…"
state while pending, then the result. Title the panel something like "Where We Left Off" with the
project name, and show the entry's `date`/`title` as a small sub-heading above the generated
summary for context (so it's clear which milestone this is about, not just floating prose).

Wire it into `MissionDashboard.tsx` the same way `FileMapOverlay`/`ProjectSummaryOverlay` are
wired (new `projectLogProject` state, rendered once at the end of the component).

---

## After building

Run `npm run test` (must stay green, all existing + new tests) and do a manual pass against **real
projects**, not synthetic fixtures — this repo has real `PROJECT_LOG.md` files sitting in sibling
project folders under `D:\WEB PROJECTS\` (e.g. `TicTacToe`, chronological order; `Huddle`, reverse-
chronological with an explicit "Newest entries at the top" note and a literal "Where to resume"
section already in it). Confirm: the dashboard row shows the correct *latest* entry's title for
both ordering conventions, clicking it produces a real, decision-altitude summary (not a
restatement of file/tool operations), and a project with no `PROJECT_LOG.md` at all (or one with
no dated headings) shows no such line at all rather than an empty/broken one. Report per-item
pass/fail, matching this repo's established convention.
