# Codex build brief — File Map (the loose, cross-session file-dependency view)

**Repo:** Starship (Electron + React 18 + TS + Tailwind, better-sqlite3, typed IPC). Read
`CLAUDE.md` at the repo root in full before touching anything — it is binding, not background.
Also skim `PHASE4_LOG.md` for the Roadmap-strip and Session-Briefing features that shipped just
before this one — this brief follows the exact same patterns (graceful degradation, content-hash
caching via `runHeadlessClaude`, decision-altitude prompt rules) rather than inventing new ones.

## What this is, in one paragraph

Starship can already summarize *one* session (`briefing.ts`, "Exit & Summarize"). This is
different: a view — embeddable in-app and separately downloadable as a self-contained HTML file —
showing every file Claude has touched **across a project's entire history** (every session, not
just the newest), laid out left-to-right in the order they were first created/touched, with loose
"file B was built because of file A" edges and a one-sentence reason for each edge. Not a strict
import/dependency graph — a build-narrative graph, derived from what Claude actually did and said,
not from parsing source code.

**Two deliberate deviations from anything named in the PRD, confirmed with Travis already:**
1. No React Flow. This graph has to be a portable, self-contained downloadable HTML file (it
   can't depend on Starship's own React runtime), so it's hand-rolled inline SVG + vanilla JS, not
   a React component.
2. The headless call never decides node order. Starship computes each file's horizontal position
   directly from its first-touch timestamp across the transcripts — deterministic, no risk of the
   LLM hallucinating a sequence. The headless call's only job is producing edges + reasons for a
   file order it's simply told, not asked to infer.

---

## Current state (read before editing)

- `src/main/dashboard.ts` — has `findNewestTranscript(projectPath): { path, mtimeMs } | null`,
  which scans `~/.claude/projects/<slug>/*.jsonl`, filters to files whose own `cwd` field actually
  matches the project (guards the slug function's known collisions), and returns the newest one.
  You'll refactor this to build on a new `findAllTranscriptsForProject` rather than duplicating
  the scan.
- `src/main/briefing.ts` — the closest existing analog. `buildSessionNarrative(transcriptPath)`
  reads *one* transcript, parses each line as raw JSON (deliberately **not** using
  `parser/parseLine.ts` — that parser serves the Kanban/status engine's structured needs and
  changing its shape risks destabilizing tested machinery for no benefit; this is its own simple,
  separate reader), and extracts user prompts / assistant text / tool_use mentions into a prose
  string. `generateSessionBriefing` composes that + the Intent Ledger into a prompt, calls
  `runHeadlessClaude`, and saves one row per project. Read this file fully before writing
  `fileMap.ts` — you are following its shape, not inventing a new one.
- `src/main/inception/headlessClaude.ts` — `runHeadlessClaude(db, { cacheNamespace, prompt, cwd })`
  is fully generic (not Inception-specific), content-hash cached in the `headless_cache` table.
  Reuse directly, new `cacheNamespace`.
- `src/main/db.ts` — has the `session_briefings` pattern (one row per project, latest only) you
  can look at for style, though this feature does **not** need a new table (see below).
- `src/shared/ipc.ts` / `src/main/preload.ts` — the full typed-IPC contract; follow the exact
  existing pattern for every new channel (see `briefing:generate` for the closest analog).
- `templates/` and `prompts/` — where static assets and prompt templates live; `prompts/briefing.md`
  is the closest analog for a new `prompts/file-map.md`.

---

## Part 1 — Backend: reading a project's whole history

### 1a. `findAllTranscriptsForProject` (`src/main/dashboard.ts`)

```ts
export const findAllTranscriptsForProject = (
  projectPath: string
): { path: string; mtimeMs: number }[] => { ... }
```

Same directory-scan + `transcriptBelongsToProject` filter `findNewestTranscript` already does,
but collect **every** matching transcript, sorted by `mtimeMs` ascending (oldest first — this *is*
the chronological session order). Refactor `findNewestTranscript` to be
`findAllTranscriptsForProject(projectPath).at(-1) ?? null` rather than keeping two separate scans.
Existing tests/callers of `findNewestTranscript` must keep passing unmodified — its signature and
behavior don't change, only its implementation.

### 1b. `buildFileTouchTimeline` (new file `src/main/fileMap.ts`)

```ts
export type FileTouch = {
  filePath: string;
  timestamp: string | null;
  reasoning: string | null;
};

export const buildFileTouchTimeline = (transcriptPaths: string[]): FileTouch[] => { ... }
```

`transcriptPaths` is already chronologically sorted (pass the output of
`findAllTranscriptsForProject` mapped to `.path`). For each transcript, **in order**:
- Read the file, split into lines, parse each as raw JSON (same tolerant pattern as
  `buildSessionNarrative` — skip unparseable lines, never throw).
- Track a `mostRecentText: string | null` running value, reset to `null` at the **start of each
  new transcript** (a reasoning fragment from a much earlier, separate session isn't relevant
  context for a file touched in a later one). Update it whenever an assistant `text` content block
  appears.
- Whenever an assistant `tool_use` content block has `name === "Write"` or `name === "Edit"`,
  extract `input.file_path` (fall back to `input.path`). If present, push
  `{ filePath, timestamp: record.timestamp ?? null, reasoning: mostRecentText }` — using whatever
  `mostRecentText` holds *at that point in the stream*, not a later one.
- Keep every touch (a file touched 3 times produces 3 entries) — do not deduplicate here. Dedup
  happens later when building node order.

Add `src/main/fileMap.test.ts` covering: multiple transcripts processed in order, reasoning reset
between transcripts, a file touched multiple times keeps all touches, malformed lines skipped
without throwing, an `Edit` and a `Write` are both captured, a tool_use for an unrelated tool
(e.g. `Bash`) is ignored. Mirror `briefing.test.ts`'s exact test style (temp dir, `writeLines`
helper, `vi.mock("electron", ...)`).

### 1c. Prompt template (`prompts/file-map.md`, new)

```
You are Starship's file-relationship pass.

Rules:
- Stateless single-shot analysis only. Do not use tools. Do not inspect files. Do not execute commands - you only have what's given below.
- You are given a chronological list of file touches (file path, when it happened, and whatever reasoning was recorded around that time). The files are already in build order - do not reorder or re-rank them, and do not invent an order of your own.
- Your only job: identify which later files were built because of / depend loosely on which earlier files, and give one short, concrete, grounded reason per relationship.
- Not every file needs an edge. A file with no clear relationship to anything earlier should simply not appear - do not force a connection that isn't there.
- Never fabricate a reason beyond what the input actually evidences.
- Return only a JSON object with this shape: {"edges":[{"from":"<earlier file path>","to":"<later file path>","reason":"<short reason>"}]}

Input:
{{payload_json}}
```

### 1d. `generateFileMap` (`src/main/fileMap.ts`)

```ts
export type FileMapNode = { filePath: string; order: number };
export type FileMapEdge = { from: string; to: string; reason: string };
export type FileMapResult = { nodes: FileMapNode[]; edges: FileMapEdge[]; generatedAt: string };

export const generateFileMap = async (
  db: StarshipDb,
  request: { projectId: string; projectPath: string }
): Promise<FileMapResult> => { ... }
```

Logic:
1. `findAllTranscriptsForProject(projectPath)` → if empty, return `{ nodes: [], edges: [],
   generatedAt: new Date().toISOString() }` immediately (no headless call — nothing to analyze).
2. `buildFileTouchTimeline(paths)` → if empty (transcripts exist but no Write/Edit calls ever
   happened), same empty-result short-circuit.
3. Build **nodes**: unique file paths in order of *first appearance* in the timeline, `order`
   being that index (0, 1, 2, ...). This is 100% deterministic, no LLM involved.
4. Bound the timeline sent to the LLM the same way `buildSessionNarrative` bounds its narrative
   (a character/entry budget — reuse the same ~12000-character-equivalent discipline; for a very
   long project history, prefer keeping one representative touch per file — e.g. the first — over
   truncating to only the most recent entries, since *unlike* a session briefing, early files
   matter just as much as recent ones for a whole-project relationship graph). Use your judgment
   on the exact bounding strategy, but document whatever you choose in a comment, the way
   `buildSessionNarrative`'s budget is documented.
5. Compose `{ fileTouches: <bounded timeline> }` into the prompt, call `runHeadlessClaude(db, {
   cacheNamespace: "file-map", prompt, cwd: getHeadlessCwd() })`.
6. Parse the JSON response (same `extractSummary`-style tolerant JSON/code-fence extraction
   pattern already in `briefing.ts` — write an equivalent `extractEdges` here, don't import
   private helpers across files).
7. **Defensive filter**: drop any edge whose `from` or `to` isn't actually one of the node file
   paths from step 3 (guards against the LLM referencing a path that isn't in its own input).
8. On any failure (headless call throws, response doesn't parse) — return the nodes with an
   **empty edges array**, not an error. A file map with nodes but no edges is a legitimate,
   honest degraded state (matches the graceful-degradation posture of Inception drafting and
   Session Briefings) — never block the view over a failed annotation pass.

No new DB table. This is generated on demand each time it's requested; `runHeadlessClaude`'s
existing content-hash cache means it only re-calls the LLM when the input (the bounded timeline)
actually changed since last time.

---

## Part 2 — HTML generation

### `renderFileMapHtml(result: FileMapResult, projectName: string): string` (`src/main/fileMap.ts`)

Produces one self-contained HTML document string — inline `<style>` and `<script>` only, zero
external resources (no CDN scripts, no remote fonts/images) since this file must work standalone,
double-clicked open in any browser with no network. Requirements, not pixel specs — use your own
judgment on exact visual styling, dark theme to roughly match Starship's existing zinc/emerald
palette is a nice-to-have, not a hard requirement:

- Nodes positioned left-to-right by `order` (evenly spaced horizontally). Stagger vertically
  (e.g. alternate a couple of rows) to reduce edge crossings — don't force everything onto one
  cramped horizontal line if there are more than ~6-8 nodes.
- Each node shows its file path (or just the basename, with the full path as a tooltip/title
  attribute — your call, prioritize not truncating illegibly).
- Edges drawn as lines/curves between nodes with directionality visible (e.g. an arrowhead).
- Clicking a node highlights its connected edges. Clicking an edge (or hovering it) reveals its
  `reason` text — a simple `<title>` tooltip is acceptable; a small on-click detail panel is nicer
  if it's not much more effort.
- If `result.nodes.length === 0`: render an honest empty state ("No files have been touched by
  Claude in this project yet.") instead of a blank canvas.
- If there are nodes but zero edges: render the nodes (still useful — shows what's been built and
  when) without implying relationships that weren't found.
- Title the HTML document with the project name.

---

## Part 3 — IPC

Add to `src/shared/ipc.ts` (types + `RendererToMainInvokeMap` entries + `StarshipApi` surface,
following the exact existing pattern for e.g. `briefing:generate`):

```ts
export type FileMapGenerateRequest = { projectId: string; projectPath: string };
export type FileMapGenerateResponse = { html: string; fileCount: number; edgeCount: number; generatedAt: string };
export type FileMapDownloadRequest = { html: string; projectName: string };
export type FileMapDownloadResponse = { savedPath: string | null };
```

- `"fileMap:generate"` — request `FileMapGenerateRequest`, response `FileMapGenerateResponse`
  (call `generateFileMap` then `renderFileMapHtml`; `fileCount`/`edgeCount` from the result's
  `nodes`/`edges` lengths).
- `"fileMap:download"` — request `FileMapDownloadRequest`, response `FileMapDownloadResponse`.
  Handler uses `dialog.showSaveDialog` (same pattern as `dashboard.ts`'s `dialog.showOpenDialog`
  for Locate Root) defaulting the filename to a sanitized `${projectName}-file-map.html`, `filters:
  [{ name: "HTML", extensions: ["html"] }]`. If the user cancels, return `{ savedPath: null }`. If
  they proceed, `fs.writeFileSync(result.filePath, request.html, "utf8")` and return `{ savedPath:
  result.filePath }`.

Register both handlers — a new `registerFileMapHandlers(db)` in `fileMap.ts`, called from
`src/main/index.ts` alongside the other `register*Handlers` calls. Expose both in
`src/main/preload.ts` under a new `fileMap: { generate, download }` key on the `StarshipApi`
object, matching the existing `briefing: { generate, getLatest }` pattern exactly.

---

## Part 4 — Renderer

### New component `src/renderer/components/FileMapView.tsx`

```ts
type FileMapViewProps = {
  projectId: string;
  projectPath: string;
  projectName: string;
};
```

- On mount, call `window.starship.fileMap.generate({ projectId, projectPath })`; show a small
  "Generating file map…" loading state while pending.
- Once loaded, render the HTML via `<iframe srcDoc={html} className="h-full w-full border-0" />`
  — no temp file needed for the in-app preview, `srcDoc` embeds it directly.
- A "Download" button calls `window.starship.fileMap.download({ html, projectName })`; on success
  (non-null `savedPath`), show a brief confirmation (e.g. a small toast/line of text with the
  saved path) — no confirmation needed if the user cancelled the save dialog.
- Keep this component self-contained and reusable — it gets used from **two** different places
  (below), neither of which should need to know about its internals.

### Entry point 1: Terminal page toggle

In `App.tsx`'s `activeSession` render branch: add a small toggle in the header (near "Exit &
Summarize") switching between the existing Terminal+Kanban view and `<FileMapView
projectId={activeSession.project.id} projectPath={activeSession.project.path}
projectName={activeSession.project.name} />`. A simple two-state local toggle
(`"terminal" | "fileMap"`) is enough — don't unmount/remount the Terminal component when toggling
away and back if you can avoid it (that would kill and respawn the pty pointlessly); hide it with
CSS rather than conditionally rendering it out of the tree, the same way you'd protect a live
session. If hiding-not-unmounting turns out to be awkward given the current structure, flag it in
your acceptance report rather than silently unmounting the terminal on every toggle.

### Entry point 2: Mission Dashboard, per project row

In `MissionDashboard.tsx`: add a "File Map" button next to the existing Intent/Launch buttons in
the Actions column. Clicking it opens an overlay (follow the exact pattern already established by
`ProjectSummaryOverlay.tsx` — blurred backdrop, centered panel, Escape/click-outside to dismiss)
containing `<FileMapView projectId={project.id} projectPath={project.path}
projectName={project.name} />`. This does **not** require an active Claude session — file map
generation only reads past transcripts, so it must work standalone from the dashboard with no pty
involved at all.

Log an `activity_log` entry when this is opened, matching the existing convention (see
`summary_overlay_opened` in `MissionDashboard.tsx` for the pattern) — e.g. `file_map_opened`.

---

## After building

Run `npm run test` (must stay green, all existing + new tests) and do a manual pass: open a real
project with at least two separate Claude Code sessions in its history (or create one via two
separate Launches), generate the file map from both the Terminal page and the Dashboard, confirm
the download actually saves a working, self-contained HTML file (open it in a plain browser with
no Starship running, confirm it renders and is interactive), and confirm a project with **zero**
tracked file activity shows the honest empty state rather than erroring. Report per-item pass/fail
rather than a single "done," matching this repo's established convention.
