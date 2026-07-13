# Starship Phase 3 Log

Phase 3 scope: JSONL tailing + a versioned, tolerant parser; kanban derived from
TaskCreate/TaskUpdate; subagent strip from Task/Agent calls; a status engine with
decision-needed detection; OS notifications phrased at decision altitude.

**Note on this log:** Phase 3 shipped in one large commit (`756f8ac`, "phase 3 observation
layer") plus a mission-dashboard follow-up (`a2da91f`) without a `PHASE3_LOG.md` at build time.
Like `PHASE2_LOG.md`, this is a retrospective reconstruction from the current source (which is
unusually well commented in-line — most of the "why" below is lifted directly from code
comments the original build left behind, not inferred).

## What shipped

### Parser (`src/main/parser/`)
- `parseSessionLine` turns one raw JSONL line into zero or more normalized records:
  session-meta, tool-use, tool-result, turn-ended, permission-mode, or skipped. Never throws —
  invalid JSON, non-object JSON, and unrecognized `type` values all degrade to a `skipped`
  record with a reason string, per CLAUDE.md's tolerant-parsing rule.
- Known-but-irrelevant record types (`mode`, `file-history-snapshot`, `attachment`, `ai-title`,
  `last-prompt`, `system`, `bridge-session`, `queue-operation`, `frame-link`) are explicitly
  enumerated as skipped, distinct from a genuinely unrecognized future type — this is a
  versioning seam: a new type Claude Code introduces later shows up distinguishably in logs
  rather than silently vanishing into the same bucket as known noise.
- `taskShape.ts`/`agentShape.ts` isolate the guesswork around TaskCreate/TaskUpdate/Agent input
  and result shapes, which the kanban/subagent reducers depend on (see below).

### Observation (`src/main/observation/`)
- **`tailer.ts`**: one bounded catch-up read of whatever transcript content already exists on
  attach, then byte-offset incremental reads on every `chokidar` change — never re-parses bytes
  already consumed, per CLAUDE.md. A trailing line with no newline yet is held back and
  prefixed onto the next read rather than parsed early.
- **`correlate.ts`**: the hard problem this phase solves — matching a pty session Starship just
  launched to the JSONL transcript Claude Code will create for it, with no hooks and no writes
  under `~/.claude`. Watches the whole `~/.claude/projects` tree (the target directory may not
  exist yet on a brand-new project's first launch), filters to the slug-resolved target
  directory, and only trusts a candidate `.jsonl` file once its own `cwd` field is read back and
  matches the launched path exactly — the slug function is not injective, so this is a mandatory
  cross-check, not defensive redundancy. If a second candidate file appears (a concurrent
  session), correlation becomes **permanently unresolved** rather than guessing between two
  transcripts. A 300ms settle window after a match gives a near-simultaneous sibling a chance to
  arrive and flip the outcome before committing.
- **`kanban.ts`**: derives Kanban state from TaskCreate/TaskUpdate tool calls, read-only by
  construction (CLAUDE.md: duplicating Claude's task state as writable is a Never-do). Handles a
  real, confirmed-on-this-machine quirk: the incremental TaskCreate shape only reveals the task's
  id in the tool *result*, not the request, so creation is matched in two steps (remember the
  label at tool-use, materialize at tool-result). Bulk-created tasks get a synthetic
  `<toolUseId>:<index>` id since the real id scheme for later TaskUpdate references against
  bulk-created items isn't confirmed; unmatched updates are silently dropped rather than
  misattributed to the wrong task.
- **`subagents.ts`**: derives the subagent strip from `Agent` tool calls (PRD calls the tool
  "Task"; the actual tool name on this machine is `Agent` — parser/agentShape.ts documents the
  discrepancy). Tracks running/finished only; whether a finished subagent errored is deliberately
  not surfaced, since Phase 3 is read-only status and that distinction wasn't asked for at this
  altitude.
- **`statusEngine.ts`**: derives idle / building / decision-needed. `AskUserQuestion` and
  `ExitPlanMode` are always decision-needed regardless of permission mode. Everything else is
  classified through `defaultIsAutoApproved` — a deliberately simple category+mode heuristic
  (always-safe read-only/bookkeeping tools; `acceptEdits` also auto-approves Edit/Write/
  NotebookEdit; `bypassPermissions` auto-approves everything) rather than a full reimplementation
  of Claude Code's settings.json glob-based allow-list engine. The documented known
  consequence: a tool covered by a custom allow-list entry this heuristic doesn't know about
  will be over-classified as decision-needed under normal/plan mode — an over-notify, which is
  named as the deliberately safer failure direction against the acceptance bar ("a real
  permission prompt produces a notification"). A 1500ms grace period avoids flashing
  decision-needed on trivially fast tool calls; this is distinct from — and not a replacement
  for — the auto-approval classification, since a legitimately slow *approved* tool (e.g. a test
  suite) must not flip to decision-needed just because it's taking a while.
- **`observationManager.ts`**: wires the four pieces together per pty session, polls
  `computeStatus()` every 500ms (comment: "well under the <2s Kanban-lag acceptance bar") so a
  pending tool call crossing the grace period is caught even with no new transcript activity,
  and fires an OS `Notification` on the idle/building → decision-needed transition, titled
  `"${projectName} needs a decision"` with the decision's altitude-level summary as the body —
  this is the concrete implementation of PRD §7's "amber state... says what the decision is
  about."
- **`summarizeToolInput`**: the decision-altitude text generator. Explicitly never emits
  "waiting for input" — it names the pending question, the plan text, the shell command, or the
  file being written, falling back to `use ${toolName}` only when none of those shapes match.

### Mission Dashboard root discovery (`a2da91f`)
- Replaced the earlier flat Shelf (manual add-one-at-a-time) with a **root folder** concept:
  Travis points Starship at one parent directory once (`dashboard:locateRoot`), and every
  immediate child directory is treated as a discovered project (`db.syncDiscoveredProjects`).
  Individual projects can be hidden (`setIgnored`) without deleting them from disk.
- `readLastClaudeActivityAt` scans `~/.claude/projects/<slug>/*.jsonl` for the newest file whose
  own `cwd` matches the project path (same slug-collision guard as `correlate.ts`) and surfaces
  that timestamp — this is the only place Phase 3's read-only JSONL access extends beyond a live
  observed session, to answer "when did this project last see Claude activity" for the
  dashboard.

### Mission Dashboard v2 refinements (2026-07-13, `acea19e`..`8981293`)
Five additive changes to the Mission Dashboard and the active-session ("Terminal") page, built by
Codex against `CODEX_BRIEF_dashboard_v2.md` and reviewed against that brief's per-item "done when"
criteria before being accepted here:
- **Hide ignored projects** (`acea19e`) — a local, session-only `showIgnored` toggle (default off)
  actually removes ignored rows from the table instead of just dimming them.
- **Intent gating** (`238135b`) — the Intent button is now `disabled` once a project has any
  recorded `lastActivityAt`, with a tooltip explaining why; it's a reminder for projects created
  but never launched, not a ledger-editing control for active ones.
- **PRD one-liner summary + overlay** (`fb1742a`) — `readPrdSummary` (new, `src/main/dashboard.ts`)
  reads each project's `PRD.md`, extracts the `## 1. One-liner` section case/spacing-tolerantly,
  and returns `null` on any missing file/heading/body (6 unit tests in
  `src/main/dashboard.test.ts` cover all of those edge cases). Clicking the summary in the
  dashboard opens `ProjectSummaryOverlay.tsx` — a blurred-backdrop, click-outside/Escape-dismissible
  panel — rather than opening the file.
- **Agent selector + skip-permissions toggle** (`196a386`) — per-row dropdown (`AgentKind`:
  `claude` functional, `codex`/`antigravity` present as disabled `<option>`s) and an off-by-default
  "skip permissions" checkbox. `Terminal`'s spawned `command` stays hardcoded to `"claude"`
  (Codex/Antigravity are scaffolding only); when the toggle is on, Launch prepends
  `--dangerously-skip-permissions` to the pty spawn args.
- **Local activity log** (`8981293`) — a new `activity_log` SQLite table (schemaless `detail`
  JSON column) plus `activity:append`/`activity:list`/`activity:appended` IPC (mirroring the
  existing `observation:snapshot` push pattern). Renderer fires an entry at each of: root
  located, project ignored/unignored, Intent opened, summary overlay opened, agent selected,
  skip-permissions toggled, launch fired. `ActivityLog.tsx` shows these live on the Terminal page,
  scoped to the active project plus global (`projectId: null`) entries, auto-scrolling only if
  already at the bottom. Explicitly **not** telemetry per CLAUDE.md's ban — everything stays in
  the local SQLite file, nothing is transmitted; it exists so a test session's click-path can be
  read back afterward instead of narrated live.
  - Known gap, not a defect: there is no export/download affordance for the log — Travis expected
    one when testing, but it was never in the brief's scope. Follow-up if wanted.

## Known risks carried forward
- **Correlation depends on `~/.claude/projects` slugging staying stable.** `resolveClaudeProjectDir`
  is shared between `correlate.ts` and `dashboard.ts`; if Claude Code changes its slug algorithm
  in a future version, both live correlation and dashboard "last activity" silently stop
  matching (fails safe — unresolved/null — rather than misattributing, but the feature goes
  dark).
- **The permission-classification heuristic in `statusEngine.ts` is explicitly not a full
  settings.json allow-list engine.** Documented and accepted as an over-notify risk, not a
  missed-notification risk — but worth remembering if Travis's actual custom allow-list entries
  turn out to be common enough that the "over-notify" amber state becomes noisy rather than rare.
- **Subagent tool name (`Agent` vs. PRD's `Task`) was pinned from observed behavior on one
  machine/version**, same category of drift risk as the parser's versioned-adapter design is
  meant to catch.

## Acceptance status
- **Unit tests: passing.** `npm run test` — 9 files, 63 tests, all green, covering parser,
  kanban, subagents, status engine, tailer, and slug logic in isolation.
- **Live acceptance run (2026-07-13, first pass): not confirmed passing.**
  `acceptance-phase3.cjs` timed out inside `submitPrompt` — the harness typed its
  `IP_PHASE3_KANBAN_CHECK` verification prompt into Claude's input box, but the terminal tail at
  failure showed the prompt text still sitting unsent, alongside a Claude Fable 5 promotional
  banner and a "3 MCP servers need authentication" warning in the same session. At the time this
  read as submission/timing friction against a live Claude Code session (PHASE1_LOG.md's T6 hit
  an adjacent "long input doesn't auto-submit on Enter" issue). A follow-up investigation the
  same day (below) found the real cause is deeper than prompt-submission timing.

### Confirmed defect: correlation never attaches in a real run (2026-07-13, follow-up)
Per Travis's request to confirm Phase 3 acceptance before starting Phase 4 work, a live
Playwright-driven check was built (bypassing the flaky `acceptance-phase3.cjs` harness in favor
of the more reliable submission logic from `acceptance-phase1.cjs`) to directly test the two PRD
§9 bars against a real `claude` session with a real Bash-approval prompt. Result: **the Kanban
panel and decision-needed notification never activated — the UI stayed on "No session detected"
for the entire session** — reproduced across three separate real launches (one brand-new
project, two relaunches of the same already-known project), including one run where the prompt
was a real Bash-approval scenario visibly showing "This command requires approval / Do you want
to proceed?" in the terminal at the same moment the Kanban pane still read "No session detected."

Root cause was narrowed, not fully fixed, by testing each layer in isolation against the exact
real directory involved:
- `resolveClaudeProjectDir`'s slug computation is correct — manually computed and matched the
  real `~/.claude/projects/<slug>` directory name exactly.
- `chokidar` itself correctly emits `add` events for new files written into that exact existing
  directory at `depth: 1` (confirmed with a standalone reproduction).
- `correlateSession` (the compiled `dist/main/observation/correlate.js`), invoked directly and
  fed a realistic write pattern (a header line with no `cwd`, then — after a delay matching real
  model latency — a `cwd`-bearing line, in the same target directory), **resolves correctly in
  isolation.**
- Yet the same directory, same slug, same correlate.ts, driven through the real full app (pty
  spawn → `ptyManager.onSpawn` → `observationManager.startObserving` → `correlateSession`) with a
  real `claude` process, never resolves.

This means the defect is not in the parser, the slug function, or `correlate.ts`'s own resolution
logic — all three check out individually — but somewhere in how the full Electron main-process
flow wires them together, or in some real-`claude`-process behavior not reproduced by the
isolated tests above. **Not yet root-caused to a specific line.** This blocks a genuine go/no-go
on Phase 3's original acceptance bar until fixed and re-verified.
- Confirmed *not* the cause: Claude-Code-session env var leakage (`CLAUDECODE`,
  `CLAUDE_CODE_CHILD_SESSION`) into the nested test process was a real, separate contamination
  problem in the first attempt (no transcript was written at all until those vars were scrubbed
  from the launched process's environment) — worth remembering for any future automated
  verification run from inside a live Claude Code session, but it is not what's blocking the
  three reproductions above (all three were run with that environment already scrubbed).

### Root-caused and fixed: the Kanban-lag bar (2026-07-13, same-day follow-up)
Added temporary diagnostic logging directly into `correlate.ts`, `main/index.ts`, `Terminal.tsx`,
and `App.tsx`, rebuilt, and captured both the Electron main process's own stdout (via
`app.process()`) and the renderer's DevTools console (via Playwright's `page.on("console")`) —
`window.starship` is deep-frozen by `contextBridge`, so a renderer-side monkeypatch of
`window.starship.pty.spawn` silently no-ops; direct source logging was the only reliable probe.

This revealed the main process was correct the whole time: correlation resolved, and
`observation:snapshot` events reached the renderer correctly matched to the active pty session
(dozens of `"idle"` snapshots observed, correctly attributed). The actual defect was a pure
renderer bug, unrelated to correlation: `App.tsx` passed an **inline arrow function** as
`Terminal`'s `onSessionId` prop, so a new function identity was created on every render.
`Terminal.tsx`'s mount effect depends on `[sessionId, onSessionId]`, so it re-fired on every
single re-render this component caused — and its handler unconditionally calls
`setObservation(null)`. Net effect: every incoming snapshot triggered a re-render → recreated the
callback → re-fired the effect → wiped the `observation` state that snapshot had just set, within
the same cycle. The UI never had a chance to show anything but "No session detected," even though
the data pipeline underneath was correct throughout.

**Fix:** wrapped the callback in `useCallback(..., [])` in `App.tsx` (`handleTerminalSessionId`)
so its identity is stable across renders. One file changed, 11 insertions / 5 deletions.

**Re-verified live** with a real `claude` session and a real `TaskCreate`/`TaskUpdate` sequence
(now that every project's `CLAUDE.md` asks Claude to track work as tasks — see below): the Kanban
panel correctly left "No session detected," showed the task pending → in progress, and settled on
`COMPLETED (1) | verify kanban fix` — matching the transcript the whole time, well under the <2s
bar structurally (500ms poll + near-instant file-watch latency). `npm run test` stayed green
(73/73) after the fix.

### New finding: decision-needed notification can't fire off the transcript alone (2026-07-13)
Testing the second PRD §9 bar (a real permission prompt produces a notification naming the
decision) surfaced something more fundamental than a bug. A prompt that made Claude call `Write`
under default (non-bypassed) permissions produced a real, visible confirmation in the terminal —
`Do you want to create scratch.txt? > 1. Yes / 2. Yes, allow all edits.../ 3. No` — sitting on
screen for over a minute. No notification fired. Tracing the actual transcript file line-by-line
(a small `trace-transcript.cjs` script dumping every `tool_use`/`tool_result` with timestamps)
showed why: **the transcript has no record of the `Write` call at all while it's pending** — only
5 tool calls exist in the whole file (`ToolSearch`, `TaskCreate`, `TaskUpdate` ×2,
`PowerShell(dir)`), and the `Write` call only appears (if at all) after the human answers the
prompt.

This means Claude Code (at least this installed version, `2.1.207`) does not write a `tool_use`
line to the JSONL transcript until *after* a pending approval is resolved. Starship's
decision-needed detection is built entirely on watching for a `tool_use` record with no matching
`tool_result` yet (`statusEngine.ts`) — if the record doesn't exist on disk until the decision is
already made, no amount of tuning the grace period or poll interval can make that mechanism catch
a real pending approval in time to notify about it. This is not a fixable bug in the existing
design; it's evidence the read-only-JSONL-only approach may be structurally unable to deliver the
"real permission prompt produces a notification" bar as originally conceived, at least not without
some additional signal beyond the transcript file (e.g. watching the rendered terminal output
itself, the way the acceptance harnesses already do to detect "Do you want to proceed?" text).
**Not resolved. Needs a design conversation, not a patch.**

Also confirmed in the same investigation: whether a command needs approval at all appears
non-deterministic per-tool-call in this Claude Code version — a bare `dir` sometimes triggered a
real approval prompt and sometimes ran immediately with no prompt at all, across otherwise
identical test setups. Not yet understood; noted as a risk for any future design here.

### Resolved: PermissionRequest hooks (2026-07-13, same-day follow-up)
Researched Claude Code's own hooks documentation (via the claude-code-guide agent, not
assumption) before designing anything, since acting on stale/half-remembered hook semantics would
have been exactly the kind of unverified claim CLAUDE.md's memory-verification discipline warns
against. Found the right tool for this: `PermissionRequest` fires synchronously, exactly when
Claude Code is about to show a real approval dialog and before the human answers it — unlike
`PreToolUse` (fires for every tool call, approval-needed or not) and `Notification` (fires after
the dialog is already showing, non-blocking). The hook payload includes `tool_name` and
`tool_input`, enough to reuse `summarizeToolInput` unchanged.

**What shipped:**
- `templates/permission-hook.cjs` — a static, dependency-free Node script copied verbatim into
  every new project's `.starship/` at creation (`createProject.ts`). Reads the hook's JSON payload
  from stdin, appends one line to a per-project signal file, and always exits 0 without returning
  an allow/deny decision — it only ever observes. A failure here (bad JSON, no write access) is
  swallowed rather than blocking or altering Claude Code's own permission flow.
- `.claude/settings.json` (project-local, committed alongside `PRD.md`/`CLAUDE.md`/the hook
  script, not `~/.claude/`) registers the hook — visible and inspectable, not a hidden side
  effect, per CLAUDE.md's transparency principle.
- `src/main/observation/permissionSignal.ts` (new) — resolves the signal file path (same slug
  function `correlate.ts` uses, keyed by project path so it doesn't depend on which transcript
  ends up correlated) and tails it. Two correctness points worth remembering if this gets touched
  again:
  - The file persists across every session ever launched for a project, so a naive "read
    everything on attach" (`tailSession`'s existing behavior) would replay **stale signals from
    past, already-resolved sessions** as pending right now. Fixed by skipping straight to the
    file's current end if it already exists when observation starts, only reporting genuinely new
    appends from there.
  - Chokidar cannot reliably watch a single *non-existent file path* directly and detect its
    later creation — only a directory for new entries appearing inside it (the same constraint
    `correlate.ts` already works around for the transcript root). If the signal file doesn't
    exist yet, watch its parent directory instead, and the directory itself is proactively
    created if missing so chokidar is never asked to watch a non-existent path either.
- `src/main/observation/tailer.ts` refactored to expose the shared byte-offset incremental-read
  primitive (`tailFile`) behind both `tailSession` and the new permission-signal tailer, now with
  an optional starting-offset parameter for the "skip stale content" case above.
- `statusEngine.ts`: a hook-sourced `PermissionSignal` takes priority over the existing
  pending-tool-map heuristic and needs no grace period (the hook only fires when Claude Code
  itself has already decided a real prompt is required, so there's no ambiguity to wait out,
  unlike the classification heuristic which remains as a fallback for approvals the hook can't
  cover — e.g. projects created before this existed). Cleared on any subsequent transcript
  activity, which is provably safe: Claude Code is fully blocked synchronously on the hook and
  then on the human, so nothing else can reach the transcript before the decision is made.
- `observationManager.ts` wires `tailPermissionSignal` alongside the existing transcript tail,
  started at the same point (once correlation resolves), feeding into the same `emit()`/
  notification path untouched.

**Live-verified end-to-end**, not just unit-tested: created a real project through the actual
`createInceptionProject` code path (hook + settings.json present and git-committed alongside
`PRD.md`/`CLAUDE.md`), launched real `claude` in it, and prompted a `Write` call under default
(non-bypassed) permissions. Confirmed via direct source-level logging (a monkeypatched
`Notification` class didn't intercept the call for an unrelated harness reason, so the log is the
real evidence here): `notifyDecisionNeeded` fired with `write to <path>\scratch.txt` — the exact
altitude-correct summary, sourced entirely from the hook — while the terminal was still visibly
showing `Do you want to create scratch.txt?` unanswered. Also confirmed: the signal file rejects
stale content correctly (re-running against the same project without a fresh approval produced no
notification, as expected since nothing needed approval that time), and the decision-needed status
clears correctly once the human answers. `npm run test` green throughout (83/83, up from 73 with
new coverage for `permissionSignal.ts` and the `StatusEngine` hook-signal path).

**Scope**: new projects only, via Inception — matches the same rollout choice already made for the
task-tracking CLAUDE.md directive. Existing projects (trAvIs, etc.) won't get the notification
capability until/unless retrofitted.

**Phase 3's original acceptance bar is now fully met**: kanban-lag (fixed earlier today) and
decision-needed notification (this) both confirmed working live against a real Claude Code
session. A go/no-go can now honestly be called **Go** for Phase 3's observation layer.

### Confirmed acceptance (2026-07-13)
- **Root discovery persistence**: Travis confirmed end-to-end — locating a root, closing the app,
  and reopening it remembers the root path (`db.getRootPath()`/`setRootPath()` round-trip via
  `root_settings`).
- **Mission Dashboard v2 (all five items above)**: confirmed twice — a live automated Playwright
  Core pass (temp root, real Electron window, real clicks; covered hide/show ignored, Intent
  disabling, PRD summary + overlay open/dismiss, Codex/Antigravity disabled options, the
  skip-permissions flag actually reaching the pty spawn call, and the activity panel updating
  live and correctly scoped) and Travis's own manual test pass. `npm run test` green throughout
  (73/73). Only gap found: the expected-but-out-of-scope activity log download/export, noted
  above.
- **The original Phase 3 observation-layer acceptance bar is now split, not a single verdict:**
  - **Kanban-lag bar: confirmed passing** after the `App.tsx` fix above — verified live with a
    real `TaskCreate`/`TaskUpdate` sequence reaching `COMPLETED` in the panel, matching the
    transcript throughout, no flicker back to "No session detected."
  - **Decision-needed notification bar: still not met**, and now understood to be a design gap
    rather than an implementation bug — see "New finding" above. The transcript-only observation
    approach cannot see a pending approval before it's resolved, at least on this Claude Code
    version.
  - No overall Phase 3 go/no-go yet: one of its two named acceptance criteria is met, the other
    needs a design decision before it can be met at all.
