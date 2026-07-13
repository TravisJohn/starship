# Codex build brief — Mission Dashboard refinements (v2)

**Status: complete (2026-07-13).** All five items built by Codex (`acea19e`..`8981293`), reviewed
against this brief's "done when" criteria, and confirmed via a live automated pass plus Travis's
own manual test. See `PHASE3_LOG.md` → "Mission Dashboard v2 refinements" / "Confirmed acceptance"
for the record. One gap found: no download/export affordance for the activity log — out of this
brief's scope, open as a possible follow-up.

**Repo:** Starship (Electron + React 18 + TS + Tailwind, better-sqlite3, typed IPC). Read
`CLAUDE.md` at the repo root in full before touching anything — it is binding, not background.
The two rules most relevant to this brief:
- **Zero agency / no hidden pty writes** (Prime directive 1 & 5): nothing here should make
  Starship decide or act on the user's behalf. The skip-permissions toggle in item 4 is the
  user explicitly choosing a flag before Launch fires — never toggle it automatically, never
  default it on, never persist it as "on" across a restart.
- **Never write into `~/.claude/projects/`.** Everything here reads from it (already-established
  pattern in `src/main/dashboard.ts` / `src/main/observation/`) and never writes to it.

This brief covers five additive changes to the Mission Dashboard and the active-session
("Terminal") page. None of these are a redesign — no new page layout, no new nav model. Existing
components (`MissionDashboard.tsx`, `App.tsx`, `Terminal.tsx`) get extended in place.

Write unit tests alongside each backend change (CLAUDE.md Phase 4 testing rule) — this repo uses
Vitest (`npm run test`, config at `vitest.config.ts`), with existing test-alongside-source
convention (e.g. `src/main/observation/kanban.test.ts` next to `kanban.ts`). Run the full suite
before considering any item done; all 63 existing tests must stay green.

Commit each item as its own conventional commit (`feat:`/`test:`) rather than one giant commit —
matches this repo's history (`git log --oneline`).

---

## Current state (read before editing)

- `src/renderer/components/MissionDashboard.tsx` — table of discovered projects. Columns:
  Project (name+path), Last Activity, Status (live `StatusDot`), Ignore (checkbox, currently only
  dims the row via `text-zinc-500`, does not hide it), Actions (Intent button, Launch button).
- `src/shared/ipc.ts` — all IPC contract types live here. `MissionProject = Project & { ignored:
  boolean; lastActivityAt: string | null }`.
- `src/main/dashboard.ts` — `registerDashboardHandlers`, `getDashboardState`,
  `decorateProjects` (adds `ignored`/`lastActivityAt` per project by reading
  `~/.claude/projects/**/*.jsonl`), `readLastClaudeActivityAt`.
- `src/main/db.ts` — `StarshipDb` class, one `better-sqlite3` instance, tables: `projects`,
  `intent_ledger`, `headless_cache`, `root_settings`, `ignored_project_paths`.
- `src/renderer/App.tsx` — owns `view` state machine and `activeSession` (the "Terminal page").
  `activeSession.project` + `activeSession.args` get passed to `<Terminal command="claude"
  args={...} cwd={...} projectId={...} projectName={...} />`. `MissionDashboard`'s `onLaunch`
  prop currently just does `setActiveSession({ project, args: [] })`.
- `src/renderer/components/Terminal.tsx` — spawns `command`/`args`/`cwd` via
  `window.starship.pty.spawn`. `command` is already a prop, just always called with the literal
  string `"claude"` today.
- `src/main/index.ts` — `ptyManager.onSpawn` only starts observation
  (`observationManager.startObserving`) when `info.command.toLowerCase() === "claude"`. Leave
  this as-is; it stays correct as long as `command` is always `"claude"` for the functional path.

---

## Item 1 — Hide ignored projects (filter)

**Where:** `MissionDashboard.tsx` only. No IPC/backend change.

- Add local component state `showIgnored: boolean`, default `false`.
- Add a small control in the header action row (next to "Rescan"/"Re-point Root"), e.g. a toggle
  button labelled `` `Show ignored (${ignoredCount})` `` — compute `ignoredCount` from
  `dashboard.projects.filter(p => p.ignored).length`. Disable/hide the control if `ignoredCount
  === 0`.
- When rendering the table body, filter: `dashboard.projects.filter(p => showIgnored ||
  !p.ignored)`.
- Keep the existing dim styling (`text-zinc-500`) for ignored rows when they *are* shown (toggle
  on) — this behavior doesn't change, it's additive.
- No persistence needed — resets to hidden-by-default on every app launch.

**Done when:** with the toggle off (default), ignored projects don't appear in the table at all;
toggling on reveals them, dimmed, exactly as today.

---

## Item 2 — Disable "Intent" once a project has started

**Where:** `MissionDashboard.tsx` only. No IPC/backend change — `lastActivityAt` already exists
on `MissionProject`.

- Change the Intent `<button>`: `disabled={project.lastActivityAt !== null}`.
- When disabled, apply a visibly muted style (reduced opacity, `cursor-not-allowed`, no hover
  color change) and set `title="Already started — Intent is only shown for projects that haven't
  been launched yet"` so it's not a mystery why it's greyed out.
- Do **not** change `onEditIntent`'s behavior itself — only the button's enabled state. Ledger
  editing for active projects is out of scope for this change (a Build Room concern later).

**Done when:** a freshly discovered project with `lastActivityAt: null` shows an enabled Intent
button; a project with any recorded activity shows it disabled with the tooltip above.

---

## Item 3 — PRD one-liner summary + click-to-highlight overlay

### Backend

- **`src/shared/ipc.ts`:** add `prdSummary: string | null` to `MissionProject`.
- **`src/main/dashboard.ts`:** add a function `readPrdSummary(projectPath: string): string |
  null`, following the same defensive-read pattern as `readLastClaudeActivityAt` (try/catch,
  return `null` on any failure — missing file, unreadable, etc.). Logic:
  1. Read `path.join(projectPath, "PRD.md")` as utf8; return `null` if it doesn't exist or is
     empty.
  2. Find the "One-liner" heading: a line matching `/^#{1,6}\s*1\.\s*one-?liner/i` (case/spacing
     tolerant — Travis's template (`templates/PRD.md`) uses `## 1. One-liner`, but a
     Claude-redrafted PRD per `prompts/inception-prd.md` could vary slightly in casing/spacing).
  3. Collect every non-blank line after that heading up to (not including) the next line starting
     with `#`, or end of file.
  4. Join those lines with a single space, trim, collapse internal whitespace. If the result is
     empty or no heading was found, return `null`.
  5. Do **not** truncate here — return the full one-liner text; truncation for the table cell is
     a rendering concern (below).
  - Add a unit test file `src/main/dashboard.test.ts` (new) covering: normal one-liner extraction,
    missing file → null, missing heading → null, heading present but empty body → null,
    case-insensitive heading match (`## 1. one-liner` lowercase), and a heading followed
    immediately by another `##` section (no body) → null.
- Wire `readPrdSummary` into `decorateProjects` alongside the existing `lastActivityAt` call, so
  every `MissionProject` in `MissionDashboardState` carries `prdSummary`.

### Frontend

- In the Project cell (name + path), add a third line: the summary, truncated for display (e.g.
  CSS `truncate`, don't hand-truncate the string — keep the full text in state for the overlay).
  If `prdSummary` is `null`, render nothing extra (don't show a placeholder like "No summary" —
  that's operational noise, not absence-worth-flagging).
  - Make that summary line clickable (`role="button"`, `tabIndex={0}`, keyboard-activatable on
    Enter/Space, not just a bare `onClick` on a `<p>`).
- Add a new component `src/renderer/components/ProjectSummaryOverlay.tsx`:
  - Props: `project: MissionProject | null`, `onClose: () => void`.
  - Renders `null` when `project` is `null`.
  - Otherwise: a fixed, full-viewport backdrop (`fixed inset-0 z-50`) with
    `backdrop-blur-sm bg-black/40`, click-outside-to-close, and `Escape` key closes it too.
  - Centered panel: project name as heading, `prdSummary` as body text, a visible close button.
  - This does **not** open `PRD.md` in any file viewer/editor — it's purely an in-app overlay
    over already-fetched state.
- In `MissionDashboard.tsx`: add `const [summaryProject, setSummaryProject] =
  useState<MissionProject | null>(null)`, clicking the summary line sets it, render
  `<ProjectSummaryOverlay project={summaryProject} onClose={() => setSummaryProject(null)} />`
  at the end of the component.

**Done when:** a project with a PRD one-liner shows a truncated preview under its path; clicking
it blurs the dashboard behind a centered panel showing the full one-liner; Escape or
click-outside dismisses it back to the plain table.

---

## Item 4 — Agent selector + "skip permissions" toggle on Launch

**Scope check:** only **Claude** is functional. Codex and Antigravity appear in the dropdown as
visibly disabled options — selecting them does nothing (they shouldn't even be selectable; use
native `<option disabled>`). This is forward scaffolding, not a real multi-agent launcher yet.

### Types (`src/shared/ipc.ts`)

```ts
export type AgentKind = "claude" | "codex" | "antigravity";
```

Add this type; it isn't otherwise threaded through `RendererToMainInvokeMap` — the agent/flag
choice stays a renderer-side concern for now (see below), it's not persisted server-side.

### `MissionDashboard.tsx`

- Add local per-project state (a `Map`/`Record` keyed by `project.id`, not global) for:
  - `agentByProjectId: Record<string, AgentKind>` — default `"claude"` for any project not yet
    in the map.
  - `skipPermissionsByProjectId: Record<string, boolean>` — default `false`.
- In the Actions cell, add:
  - A `<select>` with three `<option>`s: `claude` (label "Claude"), `codex` (label "Codex",
    `disabled`), `antigravity` (label "Antigravity", `disabled`). Value bound to
    `agentByProjectId[project.id] ?? "claude"`.
  - A toggle (checkbox styled as a switch, or a plain labelled checkbox is fine — match the
    existing Ignore checkbox's visual style for consistency) labelled "Skip permissions", off by
    default, bound to `skipPermissionsByProjectId[project.id] ?? false`.
- Change the `onLaunch` prop's signature (update in `MissionDashboardProps` too):
  ```ts
  onLaunch: (
    project: Project,
    options: { agent: AgentKind; dangerouslySkipPermissions: boolean }
  ) => void;
  ```
  and call it from the existing Launch button with the row's current selections:
  `onLaunch(project, { agent: agentByProjectId[project.id] ?? "claude", dangerouslySkipPermissions:
  skipPermissionsByProjectId[project.id] ?? false })`. Note `launchProject`'s existing
  `window.starship.dashboard.launch({ projectId })` call is unchanged — that IPC call only
  resolves/validates the project; it doesn't need to know about agent/flag.

### `App.tsx`

- Extend `ActiveSession`:
  ```ts
  type ActiveSession = {
    project: Project;
    args: string[];
    dangerouslySkipPermissions?: boolean;
  };
  ```
- Update the `MissionDashboard` usage:
  ```tsx
  onLaunch={(project, options) =>
    setActiveSession({
      project,
      args: options.dangerouslySkipPermissions ? ["--dangerously-skip-permissions"] : [],
      dangerouslySkipPermissions: options.dangerouslySkipPermissions
    })
  }
  ```
  (The `options.agent` value isn't used to change `command` — Claude is the only functional
  target — but it does need to reach the activity log; see Item 5's `launch_fired` event, which
  reads it from the callback directly in `MissionDashboard`, not from `App.tsx`.)
- Leave the `ColdPromptReview` → `onLaunch` path (line ~194) untouched — that flow is for a
  brand-new project immediately after Inception and doesn't go through the dashboard's per-row
  controls; it keeps firing with no flag, `args: [prompt]`.
- `Terminal`'s `command` prop stays the literal `"claude"` string — do not make it dynamic yet.

**Done when:** every dashboard row has a Claude/Codex/Antigravity dropdown (only Claude
selectable) and an off-by-default "skip permissions" toggle; toggling it on and clicking Launch
starts `claude --dangerously-skip-permissions` in the embedded terminal (verify by watching the
spawned command args, or by observing Claude's own startup banner/behavior differs — Claude Code
skips its permission-prompt TUI in this mode); toggling off (default) launches exactly as today.

---

## Item 5 — Local activity log, visible on the Terminal page

**This is not telemetry** (CLAUDE.md forbids that) — it's a local, on-disk trace of the builder's
own dashboard/launch actions, for debugging test sessions. Nothing is transmitted anywhere, no
account, no aggregation service. Say so in the commit message if it's at all ambiguous from the
diff.

### Backend

- **`src/main/db.ts`:** add a table:
  ```sql
  create table if not exists activity_log (
    id integer primary key autoincrement,
    ts text not null,
    event_type text not null,
    project_id text,
    detail text
  );
  ```
  (`detail` is a JSON-stringified blob, nullable — keep it schemaless per-event rather than adding
  columns per event type.)
  Add to `StarshipDb`:
  ```ts
  logActivity(entry: { eventType: string; projectId?: string | null; detail?: unknown }): ActivityLogEntry
  listActivity(options?: { projectId?: string; limit?: number }): ActivityLogEntry[]
  ```
  `listActivity` orders by `id asc` (chronological, oldest first — the panel below auto-scrolls to
  the newest entry, so insertion order matters more than sort direction). Default `limit` should
  be generous but bounded (e.g. 500) — this is a debug aid, not an archive; don't build retention
  policy/pruning now, that's premature for a local dev log.
- **`src/shared/ipc.ts`:** add
  ```ts
  export type ActivityLogEntry = {
    id: number;
    ts: string;
    eventType: string;
    projectId: string | null;
    detail: unknown;
  };
  export type ActivityAppendRequest = {
    eventType: string;
    projectId?: string;
    detail?: unknown;
  };
  export type ActivityListRequest = {
    projectId?: string;
    limit?: number;
  };
  ```
  and the corresponding `RendererToMainInvokeMap` entries `activity:append` (request
  `ActivityAppendRequest`, response `ActivityLogEntry`) and `activity:list` (request
  `ActivityListRequest`, response `ActivityLogEntry[]`), plus a `MainToRendererEventMap` entry
  `activity:appended: ActivityLogEntry` for the live push (mirrors the existing
  `observation:snapshot` pattern).
- **`src/main/db.ts`** (or a new small `src/main/activity.ts` if you want to keep `db.ts` from
  growing further — either is fine, match whichever keeps `db.ts` readable): register
  `ipcMain.handle("activity:append", ...)` which calls `db.logActivity(...)` **and then**
  broadcasts `activity:appended` to the main window's `webContents` (same
  `webContents.isDestroyed()` guard pattern already used in `src/main/index.ts` for
  `observation:snapshot`) with the newly inserted row; and `ipcMain.handle("activity:list", ...)`
  which calls `db.listActivity(...)`.
- **`src/main/preload.ts`:** expose `activity: { append, list, onAppended }` on `StarshipApi`
  following the exact existing pattern for `observation.onSnapshot`.
- Add `src/main/db.test.ts` (or extend if one exists) covering `logActivity`/`listActivity`:
  round-trips a few entries, respects `projectId` filtering, respects `limit`, preserves
  insertion order.

### Frontend — where entries get written

Call `window.starship.activity.append(...)` from the renderer at each of these points (all in
`MissionDashboard.tsx` except the last, which is in `App.tsx`/wherever Intent-open and
Launch-fire already happen):

| Event | `eventType` | `projectId` | `detail` |
|---|---|---|---|
| Root located/re-pointed | `root_located` | *(omit)* | `{ rootPath }` |
| Project ignore toggled | `project_ignored` | project.id | `{ ignored: boolean }` |
| Intent button opened | `intent_opened` | project.id | *(omit)* |
| Summary overlay opened | `summary_overlay_opened` | project.id | *(omit)* |
| Agent dropdown changed | `agent_selected` | project.id | `{ agent: AgentKind }` |
| Skip-permissions toggled | `skip_permissions_toggled` | project.id | `{ enabled: boolean }` |
| Launch fired | `launch_fired` | project.id | `{ agent: AgentKind, dangerouslySkipPermissions: boolean }` |

Fire-and-forget these (`void window.starship.activity.append(...)`) — don't block the actual
action on the log write succeeding, and don't surface a log-write failure as a user-facing error;
this is a debug aid, not a correctness-critical path.

### Frontend — the visible panel

- New component `src/renderer/components/ActivityLog.tsx`:
  - Props: `projectId: string` (the currently active session's project — filter to this project's
    entries plus entries with `projectId: null`, e.g. `root_located`, so a `root_located` fired
    while the dashboard was last open still shows up for context).
  - On mount: `window.starship.activity.list({ projectId })` for the initial backlog, then
    subscribe via `window.starship.activity.onAppended`, appending matching new entries live and
    ignoring ones for other projects.
  - Renders a compact, scrollable list — timestamp (short, e.g. `HH:mm:ss`) + a short
    human-readable label per `eventType` (e.g. `agent_selected` → `"agent set to claude"`,
    `launch_fired` → `"launched claude (skip-permissions: on)"`) — do **not** just dump raw JSON;
    keep it readable but this is explicitly an operational/debug surface, not a decision-altitude
    one, so it's fine (and expected) for it to be more granular/technical than the rest of the UI.
  - Auto-scrolls to the newest entry when a new one arrives (don't fight the user if they've
    scrolled up to read history — only auto-scroll if they were already at the bottom).
- Mount it in `App.tsx`'s `activeSession` view (the Terminal page), visibly — per explicit
  instruction this should be shown now, not hidden behind a collapse toggle. A reasonable
  placement: a slim panel below the header, above (or in place of) the `SubagentStrip`, or a
  dedicated strip under the Terminal+Kanban row. Pick whichever doesn't crowd the terminal itself
  — a fixed-height (e.g. `h-32`/`h-40`) scrollable strip is enough; it doesn't need to compete for
  space with the terminal pane.

**Done when:** opening a project's Terminal page shows a live-updating activity panel; performing
dashboard actions (going back to the dashboard, toggling ignore, opening Intent/summary, changing
agent/flag, launching) produces new entries that appear in that panel without a page refresh, in
the order they happened.

---

## After all five items

Run `npm run test` (must stay green, all old + new tests), then do a manual pass: locate a root,
toggle ignore + the filter, confirm Intent disables after a real launch, click a PRD summary,
launch with the skip-permissions toggle on, and confirm the activity panel reflects all of it on
the Terminal page. Report back per-item pass/fail rather than a single "done" — this repo's
convention (see `PHASE1_LOG.md`) is to log what was verified, not just what was written.
