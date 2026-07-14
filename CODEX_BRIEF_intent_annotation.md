# Codex build brief — Intent Ledger annotation pass ("why this order", "does this serve my intent")

**Repo:** Starship (Electron + React 18 + TS + Tailwind, better-sqlite3, typed IPC). Read `CLAUDE.md`
at the repo root in full before touching anything — it is binding, not background. Also skim
`PHASE4_LOG.md` for the Roadmap-strip, Session-Briefing, File Map, and Project-Log-Summary features
that already shipped this phase — this brief follows the exact same patterns (graceful degradation,
content-hash caching via `runHeadlessClaude`, decision-altitude prompt rules, click-triggered not
auto-refreshing) rather than inventing new ones.

## What this is, in one paragraph

This is the one capability named in the PRD's Phase 4 acceptance line that hasn't shipped yet:

> "For a real multi-phase session, Travis answers 'why is step 4 before step 5?' and 'does this
> plan serve my stated intent?' from the Intent panel alone."

Starship's Kanban (Phase 3) already shows the live task list, but only label + status — no
rationale for ordering, no connection to the Intent Ledger. This feature adds a third Terminal-page
view, alongside Terminal and File Map: an **Intent panel** that, on click, takes the *current*
snapshot of the task list plus the project's Intent Ledger and produces (a) a short ordering
rationale per task and which Intent Ledger dimension it serves, and (b) one overall verdict on
whether the plan as a whole serves the stated purpose/success criteria and whether anything
conflicts with accepted tradeoffs or never-do constraints.

**Deliberately click-triggered, not live-refreshing.** The Kanban updates continuously during a
session (Phase 3's <2s lag). If this annotation pass re-fired automatically on every task-list
change, it would be a headless LLM call firing in a loop — CLAUDE.md explicitly bans running
headless calls in loops ("user-triggered or once-per-session-end only, cached by content hash").
So this is a button the builder clicks when they want the check, exactly like Exit & Summarize,
File Map generation, and the Project Log Summary click — never automatic.

**No new dependency-graph parsing.** `addBlockedBy` edges exist in real transcripts (confirmed
earlier this phase) but are not parsed anywhere in this codebase, and this feature does not need
them — the ordering rationale comes from reasoning over the task list + nearby assistant narration,
the same technique File Map used for file relationships (annotation quality over topology, an
already-established principle from that feature's design).

---

## Current state (read before editing)

- `src/main/observation/kanban.ts` — `KanbanTask = { id, label, status }`, `KanbanState = { tasks }`.
  The renderer already receives this live as `observation.kanban: KanbanTaskDto[]` (see
  `src/shared/ipc.ts`, `ObservationState`). This feature takes that array as-is from the renderer —
  it does **not** need new main-side state tracking. `id` values are opaque (real ids from
  incremental `TaskCreate` results, or synthetic `<toolUseId>:<index>` for bulk creation) — never
  ask the LLM to echo them back; match its response back to tasks by **label** instead (see below).
- `src/main/dashboard.ts` — `findNewestTranscript(projectPath): { path, mtimeMs } | null`. Use this
  (not `findAllTranscriptsForProject`) — this feature is scoped to the *current* live session, not
  cross-session history like File Map.
- `src/main/fileMap.ts` — closest structural analog: reads a transcript, extracts nearest-preceding
  assistant reasoning at each relevant tool_use, bounds the payload, calls `runHeadlessClaude`,
  defensively filters the LLM's response against known-good identifiers, degrades to a
  data-only result (never an error) on any failure. Follow this shape.
- `src/main/briefing.ts` — closest analog for reading the Intent Ledger and composing it into a
  prompt payload (`generateSessionBriefing`'s `intentLedger` object shape). Reuse that exact shape.
- `src/main/inception/headlessClaude.ts` — `runHeadlessClaude(db, { cacheNamespace, prompt, cwd })`,
  content-hash cached in `headless_cache`. Reuse directly with a new `cacheNamespace`.
- `src/shared/ipc.ts` / `src/main/preload.ts` — full typed-IPC contract. The `intent` namespace
  already exists (`intent:getLedger`, `intent:saveLedger`) — add a new `intent:annotate` channel
  alongside them, both in the type map and in `preload.ts`'s existing `intent: { getLedger,
  saveLedger }` object (extend it, don't create a new top-level namespace).
- `src/renderer/App.tsx` — the `activeSessionPanel` toggle (`"terminal" | "fileMap"` today, CSS
  show/hide not unmount, per the Terminal-must-never-be-killed rule already established for File
  Map). Extend to a third value `"intent"` following the exact same pattern.
- `src/renderer/components/FileMapView.tsx` and `Kanban.tsx` — closest UI analogs for the new
  `IntentPanel.tsx` (loading state, empty state, styling — zinc/emerald dark palette).
- `prompts/briefing.md` — closest analog for the new `prompts/intent-annotation.md`'s rule
  structure and altitude-discipline phrasing. Reuse the phrasing patterns verbatim where they apply
  (e.g. "Speak at decision altitude... never file counts or operational narration").

---

## Part 1 — Backend

### 1a. Reasoning extraction (new file `src/main/intentAnnotation.ts`)

```ts
export type TaskReasoning = {
  label: string;
  reasoning: string | null;
};

export const buildTaskReasoningTimeline = (transcriptPath: string): TaskReasoning[] => { ... }
```

Read the transcript (same tolerant per-line JSON parse pattern as `buildSessionNarrative` /
`buildFileTouchTimeline` — skip unparseable lines, never throw, return `[]` if the file can't be
read). Track a running `mostRecentText: string | null`, updated on every assistant `text` content
block (no reset-per-transcript needed here — this is a single transcript, not cross-session).
Whenever an assistant `tool_use` block is a `TaskCreate` call:
- **Incremental shape** (`input.subject` present): one entry, `{ label: input.subject, reasoning:
  mostRecentText }`.
- **Bulk shape** (`input.tasks` is a JSON array string, same shape `parser/taskShape.ts`'s
  `interpretTaskCreateInput` already parses — reuse that function directly rather than
  re-implementing the parsing): one entry per item, `{ label: item.content, reasoning:
  mostRecentText }` (all items in one bulk call share the same nearest-preceding reasoning, since
  they were created in one shot).

Do not attempt to track `TaskUpdate` here — status changes don't need their own rationale, only
the original creation/positioning does.

### 1b. Matching reasoning to the current task snapshot

```ts
export const matchReasoningToTasks = (
  tasks: KanbanTaskDto[],
  timeline: TaskReasoning[]
): Array<KanbanTaskDto & { reasoning: string | null }> => { ... }
```

Match by exact label string, **in order, first-unused-match-wins**: walk `tasks` in order; for each,
find the first not-yet-consumed `timeline` entry with the same label, consume it, attach its
`reasoning`. If no match is found for a task (transcript didn't capture its creation, or labels
were edited since), attach `reasoning: null` — never throw, never guess.

### 1c. `generateIntentAnnotation` (`src/main/intentAnnotation.ts`)

```ts
export type TaskAnnotation = {
  taskId: string;
  rationale: string | null;
  servesIntent: "purpose" | "successCriteria" | "acceptedTradeoffs" | "neverDo" | "none";
  note: string;
};

export type IntentAnnotationResult = {
  perTask: TaskAnnotation[];
  overall: { verdict: string; concerns: string };
  generatedAt: string;
};

export const generateIntentAnnotation = async (
  db: StarshipDb,
  request: { projectId: string; projectPath: string; tasks: KanbanTaskDto[] }
): Promise<IntentAnnotationResult> => { ... }
```

Logic:
1. `generatedAt = new Date().toISOString()`.
2. If `request.tasks.length === 0`: return immediately, no headless call —
   `{ perTask: [], overall: { verdict: "No tasks yet — nothing to check against intent.", concerns:
   "" }, generatedAt }`. Matches the honest-empty-state convention used everywhere else this phase.
3. `findNewestTranscript(request.projectPath)` → if null, still proceed (a plan can exist before any
   transcript is found in edge cases — degrade gracefully rather than blocking), passing an empty
   timeline (`[]`) into the matcher, so every task gets `reasoning: null`.
4. Otherwise `buildTaskReasoningTimeline(transcript.path)`, then `matchReasoningToTasks(tasks,
   timeline)`.
5. `db.getIntentLedger(request.projectId)` — may be `null` (projects added via "Locate Root" rather
   than Inception have no ledger). Pass `intentLedger: null` through to the prompt rather than
   skipping the call — the ordering rationale is still useful without a ledger; the prompt template
   instructs the model to tag everything `"none"` and say so plainly when the ledger is null.
6. Compose `{ intentLedger: <ledger fields or null>, tasks: <matched tasks with label, status,
   reasoning, in order> }` into the prompt via `prompts/intent-annotation.md`. Call
   `runHeadlessClaude(db, { cacheNamespace: "intent-annotation", prompt, cwd: getHeadlessCwd() })`.
7. Parse the JSON response (same tolerant code-fence-stripping pattern as `briefing.ts`'s
   `extractSummary` / `fileMap.ts`'s `extractEdges` — write an equivalent local parser, don't import
   private helpers across files). Expected shape:
   `{"perTask":[{"label":"...","rationale":"...","servesIntent":"...","note":"..."}],"overall":
   {"verdict":"...","concerns":"..."}}`.
8. **Defensive matching, same principle as File Map's node-path filter**: map each returned
   `perTask` entry back to a `taskId` by matching `label` against `request.tasks` (first-unused-match
   wins, same order-preserving rule as 1b). Drop any response entry whose label doesn't match any
   task. Any task from `request.tasks` with no matching response entry gets a default annotation
   (`rationale: null, servesIntent: "none", note: ""`) rather than being silently omitted — the
   panel must show every current task, annotated or not.
9. On any failure (headless call throws, response doesn't parse): return every task with
   `{ rationale: null, servesIntent: "none", note: "" }` and
   `overall: { verdict: "The intent check couldn't be generated right now.", concerns: "" }` — never
   an error, matching every other feature's graceful-degradation posture.

No new DB table — generated fresh on each click; `runHeadlessClaude`'s existing content-hash cache
means an identical task snapshot + ledger state doesn't re-call the LLM.

Add `src/main/intentAnnotation.test.ts` (mirror `fileMap.test.ts`'s style — temp dir, `vi.mock
("electron", ...)`, `vi.mock("./inception/headlessClaude", ...)`) covering: reasoning timeline
extraction for both incremental and bulk `TaskCreate` shapes, label-matching order-preservation
(including a repeated label, and a task with no match), empty-tasks short-circuit (no headless
call), null-ledger passthrough, graceful degradation on headless failure, defensive filtering of a
response entry with an unrecognized label, and a task from the request missing from the response
still appearing in the result with default annotation fields.

---

## Part 2 — Prompt template (`prompts/intent-annotation.md`, new)

```
You are Starship's Intent Ledger annotation pass.

Rules:
- Stateless single-shot analysis only. Do not use tools. Do not inspect files. Do not execute commands - you only have what's given below.
- You are given the project's Intent Ledger (or null if none exists) and the current task list, in a fixed order that you must not change - do not reorder or re-rank the tasks.
- For each task, give a short, concrete rationale for why it is positioned where it is in the sequence, grounded only in the reasoning text given for that task. If no reasoning was recorded for a task, say plainly that no rationale was captured rather than inventing one.
- For each task, tag which Intent Ledger dimension it most serves: "purpose", "successCriteria", "acceptedTradeoffs", or "neverDo" - or "none" if it doesn't clearly serve any stated dimension. If the Intent Ledger is null, tag every task "none".
- If a task's content appears to brush against something the ledger's neverDo explicitly rules out, say so plainly as a short note on that task - do not soften or omit it. Leave note empty otherwise.
- Also produce one overall verdict: two or three sentences on whether the plan as a whole serves the stated purpose and success criteria, and whether anything conflicts with accepted tradeoffs or never-do constraints. If the Intent Ledger is null, say plainly that there is no stated intent to check against instead of fabricating one.
- Speak at decision altitude: never file counts, tool-call counts, or step-by-step operational narration ("read 3 files, ran npm test").
- Never fabricate anything beyond what the input actually shows.
- Return only a JSON object with this shape: {"perTask":[{"label":"<exact task label as given>","rationale":"<short rationale or null>","servesIntent":"purpose"|"successCriteria"|"acceptedTradeoffs"|"neverDo"|"none","note":"<short flag or empty string>"}],"overall":{"verdict":"<2-3 sentences>","concerns":"<short text or empty string>"}}

Input:
{{payload_json}}
```

---

## Part 3 — IPC

Add to `src/shared/ipc.ts` (types + `RendererToMainInvokeMap` entry + `StarshipApi` surface — extend
the existing `intent` namespace, don't create a new one):

```ts
export type IntentAnnotationRequest = {
  projectId: string;
  projectPath: string;
  tasks: KanbanTaskDto[];
};

export type TaskAnnotation = {
  taskId: string;
  rationale: string | null;
  servesIntent: "purpose" | "successCriteria" | "acceptedTradeoffs" | "neverDo" | "none";
  note: string;
};

export type IntentAnnotationResult = {
  perTask: TaskAnnotation[];
  overall: { verdict: string; concerns: string };
  generatedAt: string;
};
```

- `"intent:annotate"` — request `IntentAnnotationRequest`, response `IntentAnnotationResult`. Handler
  calls `generateIntentAnnotation(db, request)`.

Register in a new `registerIntentAnnotationHandlers(db)` in `intentAnnotation.ts`, called from
`src/main/index.ts` alongside the other `register*Handlers` calls (note: `intent:getLedger` /
`intent:saveLedger` are currently registered somewhere else — check where and either add this
alongside them or keep it in the new file, whichever keeps registration for the `intent:*` channels
easiest to find; either is fine as long as it's registered exactly once). Expose in
`src/main/preload.ts` by adding `annotate` to the existing `intent: { getLedger, saveLedger }`
object — do not create a second `intent`-like namespace.

---

## Part 4 — Renderer

### New component `src/renderer/components/IntentPanel.tsx`

```ts
type IntentPanelProps = {
  projectId: string;
  projectPath: string;
  tasks: KanbanTaskDto[];
};
```

- Local state: `result: IntentAnnotationResult | null`, `loading: boolean`.
- **Never auto-fetch on mount or on `tasks` changing.** This is click-triggered only — see the
  "why click-triggered" rationale at the top of this brief. A `useEffect` that fires on every
  `tasks` change would violate that.
- If `tasks.length === 0`: honest empty state, matching `Kanban.tsx`'s "No session detected" tone —
  e.g. "No tasks yet — nothing to check against intent."
- If `tasks.length > 0` and no `result` yet: show the plain current task list (label + status, in
  the given order — free, already-available data, no LLM) plus a prominent button, e.g. "Check
  Against Intent".
- On click: set `loading`, call `window.starship.intent.annotate({ projectId, projectPath, tasks
  })`, then render:
  - An overall verdict banner at the top (the `overall.verdict` text; if `overall.concerns` is
    non-empty, show it visually distinct — e.g. an amber-bordered callout — since a concern is the
    single most decision-relevant thing this panel can surface).
  - Each task, in order, with its `rationale` (or "No rationale recorded for this task." if null),
    a small tag chip for `servesIntent` (skip rendering the chip entirely when it's `"none"` — a
    "none" chip on every card is noise, not signal), and its `note` if non-empty, visually flagged
    (e.g. amber border/text) especially when `servesIntent === "neverDo"`.
- Once a `result` exists, keep the button visible (relabel it "Re-check Against Intent") so the
  builder can re-run it later in the same session as the plan evolves — do not auto-invalidate the
  previous result while a re-check is loading; show it with a subtle "Checking again…" indicator
  instead of blanking the screen.
- Keep this component self-contained — mirror `FileMapView.tsx`'s general shape (fetch-on-demand,
  loading state, honest empty state) but do **not** copy its "fetch on mount" behavior; that's the
  one deliberate difference.

### Wiring into `App.tsx`

- Extend the `activeSessionPanel` type from `"terminal" | "fileMap"` to `"terminal" | "fileMap" |
  "intent"`.
- Add a third toggle button "Intent" in the header, immediately after the existing "File Map"
  button, same styling/active-state pattern as the other two.
- Add a third section using the same CSS show/hide pattern (`activeSessionPanel === "intent" ?
  "block" : "hidden"` — never conditionally unmount, same rule as the File Map section) rendering:
  ```tsx
  <IntentPanel
    projectId={activeSession.project.id}
    projectPath={activeSession.project.path}
    tasks={observation?.kanban ?? []}
  />
  ```

No Dashboard entry point for this feature (unlike File Map) — the Intent panel only makes sense
against a live task list, which only exists during an active Terminal session.

---

## After building

Run `npm run test` (must stay green, all existing + new tests) and do a manual pass against a real
project with a real multi-step Claude Code plan (TicTacToe or Huddle, whichever currently has more
in-progress/pending tasks): switch to the Intent panel, click "Check Against Intent", confirm the
per-task rationale and overall verdict are genuinely grounded in what Claude actually said (not
generic filler), confirm a task with no captured reasoning shows the honest "no rationale recorded"
line rather than a fabricated one, and confirm the Terminal's live pty is still running and
unaffected after toggling to Intent and back (same live-pty check already done for File Map). Also
verify a project with **zero** current tasks shows the honest empty state, and — if you can find or
contrive a project with no saved Intent Ledger — confirm the "no stated intent to check against"
degraded case reads honestly rather than silently guessing. Report per-item pass/fail rather than a
single "done," matching this repo's established convention.
