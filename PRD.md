# Foreman — Product Requirements Document

**Version:** 1.0 (Draft)
**Owner:** Travis
**Status:** Approved for Phase 1
**Working title:** Foreman (subject to rename)

---

## 1. One-liner

A personal desktop mission control for Claude Code projects: one window to commission a project (CLAUDE.md, PRD, git init, cold prompt), watch it being built (kanban + DAG from Claude's real task state), and understand the strategic reasoning behind every decision.

## 2. Problem

Starting a Claude Code project today spans five surfaces: a chat app for architecture, file explorer, terminal, Claude Code itself, and optionally a browser-based monitor. The bootstrap ritual (folder → CLAUDE.md → PRD → git init → cold prompt) is repeated manually per project. Once agents run, status is visible but *reasoning* is not — no existing tool answers "why did Claude structure the work this way?"

## 3. Goals

1. Collapse project inception from ~8 manual steps to one guided flow ending in a fired cold prompt.
2. Provide a single window: interactive Claude Code terminal + live kanban + plan DAG.
3. Surface strategic context: plain-English annotations of *why* the plan is ordered as it is, and per-task summaries of what was done and why.
4. Persist a per-project decision narrative Travis can replay later (interview prep by-product).
5. Teach the builder (Travis) Claude Code internals: JSONL transcripts, hooks, headless mode, TodoWrite/Task tool semantics.

## 4. Non-goals

- Not a commercial product. Single user, local-first, no accounts, no telemetry, no cloud sync.
- Not an agent. The app never edits code, never acts autonomously, never answers permission prompts (v1).
- Not a terminal replacement. The embedded terminal is real Claude Code; the app surrounds it, never intercepts it.
- No competing state. Claude Code owns all task/plan state; the app is a read-only observer of `~/.claude` plus a prompt injector the user explicitly triggers.
- No multi-machine / remote execution (v1).

## 5. User

One user: Travis. Windows 11 primary. Existing Claude Code subscription (no separate API key required — see §8.4).

## 6. Core principles

1. **Zero agency in the app.** Only Claude Code acts. The app orchestrates launch, observes state, and summarises.
2. **Terminal is sacred.** Always accessible, always authoritative. If every visual panel died, the terminal still works.
3. **Observation over ownership.** All visual state derives from watching `~/.claude/projects/**/*.jsonl` and hook events. The app writes nothing into Claude's state directory.
4. **Templates are Travis's.** Inception uses his evolved CLAUDE.md/PRD templates as editable defaults, not generic boilerplate.

## 7. Experience overview

- **Project Shelf (home):** card per project — name, plain-English "where we're at" (last session briefing), status dot (idle / running / waiting-on-you).
- **New Project (Inception Wizard):** short guided interview → PRD + CLAUDE.md drafts side by side → user edits/approves → one commit action: create folder, write files, `git init` + first commit, compose cold prompt → user reviews prompt → fire into terminal.
- **Build Room (per project):** three panes. Left: embedded Claude Code terminal. Centre: kanban auto-populated from Claude's task list. Right: context panel — plan DAG with reasoning annotations; clicking a kanban card shows what/why for that task.
- **Attention flow:** OS notification + amber dot when Claude waits on input or finishes a phase. Returning user sees a briefing ("Phase complete. 3 files changed. 1 decision to review"), not raw scrollback.
- **Timeline (per project):** replayable session-by-session narrative: what was built, decisions made, what's next.

## 8. Architecture

### 8.1 Stack
- **Shell:** Electron (Windows-first; macOS later if ever). Electron over Tauri deliberately: React/Node familiarity, no Rust on the critical path.
- **UI:** React + TypeScript + Tailwind. State: Zustand. DAG rendering: React Flow (or d3-dag if React Flow layout insufficient).
- **Terminal:** xterm.js in renderer ↔ node-pty (ConPTY on Windows) in main process, IPC-bridged.
- **File watching:** chokidar on `~/.claude/projects/` (debounced; JSONL files are append-only — tail incrementally, never re-parse whole files).
- **Local persistence:** SQLite (better-sqlite3) for app-side derived data only: project registry, cached summaries, timeline entries. Claude's own state is never duplicated as source of truth — cache is disposable and rebuildable from JSONL.

### 8.2 Data sources (read-only)
- **JSONL transcripts** (`~/.claude/projects/<project-hash>/*.jsonl`): full session history. Parse for: `TodoWrite` tool calls (kanban source), plan-mode output (DAG source), `Task` tool calls (subagent monitor), permission prompts / end-of-turn (waiting state).
- **Hooks** (registered in project `settings.json` by the wizard, with user consent): deterministic session-start/stop and tool-use events for low-latency status, complementing file watching.

### 8.3 Prompt injection (write path, user-triggered only)
Cold prompts and follow-ups the user approves are written to the pty stdin of the embedded terminal. No hidden writes; every injected prompt is shown before firing.

### 8.4 LLM usage (stateless, non-agentic)
Three single-shot call types, all via `claude -p "<prompt>" --output-format json` (headless mode, reuses existing Claude Code auth/subscription — no API key):
1. **Inception drafting:** interview answers + Travis templates → PRD and CLAUDE.md drafts.
2. **Plan annotation:** plan text + recent transcript excerpt → per-node "why" annotations for the DAG.
3. **Briefings:** session segment → plain-English summary (what happened, decisions, review items).
No tools, no loops, no memory managed by the app. Failures degrade gracefully: panels show raw data without annotations.

## 9. Phases

### Phase 1 — Shell (prove the plumbing)
- Electron app boots; Project Shelf lists registered projects (manual add via folder picker).
- Embedded xterm.js terminal launches `claude` in the selected project folder via node-pty/ConPTY.
- Full interactivity: colours, resize, scrollback, Ctrl+C.
- **Acceptance:** run a complete real Claude Code session (e.g. a Wise Cow task) entirely inside Foreman with zero terminal defects.
- **Risk retired:** ConPTY + Claude Code TUI compatibility on Windows — the single biggest technical unknown, so it goes first.

### Phase 2 — Inception Wizard
- Guided interview (5–7 questions: what, for whom, stack, phase 1 scope, constraints/never-do).
- Drafts PRD + CLAUDE.md from Travis's templates via one headless call each; side-by-side editable review.
- Commit action: mkdir, write both files, `git init`, initial commit, compose cold prompt, show for edit, fire into terminal.
- Templates stored in app config as editable markdown with `{{placeholders}}`.
- **Acceptance:** a brand-new project goes from "New Project" click to Claude Code executing the cold prompt in under 5 minutes, with zero manual file/terminal steps.

### Phase 3 — Observability
- chokidar tail on the active project's JSONL; incremental parser.
- Kanban pane: tasks from TodoWrite, columns Pending / In Progress / Completed, live updates.
- Agent strip: active Task-tool subagents with description and status.
- Status engine: idle / running / waiting-on-you per project; amber dot + OS notification on waiting.
- **Acceptance:** during a live session, kanban card movement lags Claude's actual TodoWrite call by <2s; waiting-state notification fires on a real permission prompt.

### Phase 4 — Strategic Context (the differentiator)
- Plan detection in transcript → DAG render (nodes = plan steps/phases, edges = stated or inferred dependencies).
- Annotation pass: headless call produces per-node "why" (ordering rationale, tradeoffs, dependencies) — cached in SQLite keyed by plan hash.
- Card drill-in: clicking a kanban card → what was done, files touched, why.
- Session briefings on session end; Timeline view assembles briefings into the project narrative.
- **Acceptance:** for a real multi-phase session, Travis can answer "why is step 4 before step 5?" from the DAG panel alone without reading the transcript.

### Phase 5 (parked, do not build yet)
- Rule-based auto-approval of trivial permission prompts. Only revisit if post-Phase-4 usage shows real friction.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Claude Code TUI misbehaves under node-pty/ConPTY | Phase 1 exists solely to retire this; fallback is launching in Windows Terminal side-by-side while keeping observer panes |
| JSONL schema is undocumented and may change with Claude Code versions | Parser behind a versioned adapter interface; tolerant parsing (skip unknown records, never crash); pin tested Claude Code version in CLAUDE.md |
| Headless summarisation burns subscription quota | All annotations cached by content hash; briefings generated once per session end; manual "annotate" button rather than auto-run on every change |
| Scope creep toward productisation | §4 Non-goals is binding; any feature serving a hypothetical other user is rejected |

## 11. Success criteria (personal)

1. Foreman is the default way Travis starts and runs every new side project within 2 weeks of Phase 2 shipping.
2. After one month, Travis can replay the decision narrative of any Foreman-run project from the Timeline.
3. Travis can explain, in interview depth: Claude Code JSONL transcript structure, hooks, headless mode, ConPTY, and why the app is deliberately non-agentic.
