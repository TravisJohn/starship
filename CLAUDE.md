# Foreman — CLAUDE.md

Personal desktop mission control for Claude Code projects. Single user (Travis), Windows 11, local-first, non-commercial. Full spec in `PRD.md` — read it before any phase work.

## Prime directives
1. **The app has zero agency.** It launches Claude Code, observes `~/.claude` state, and summarises. Never add code that edits user projects, auto-answers prompts, or acts without an explicit user trigger.
2. **Never write into `~/.claude/projects/`.** That directory is read-only to us. App-derived data goes in our own SQLite DB and is always rebuildable from JSONL.
3. **Phase discipline.** Build only the current phase (see PRD §9). Do not scaffold ahead. Stop and report at each phase's acceptance criteria.
4. **Every injected prompt is shown to the user before firing.** No hidden pty writes.

## Stack (fixed — do not substitute)
- Electron + React 18 + TypeScript + Tailwind; Zustand for state
- xterm.js (renderer) ↔ node-pty (main, ConPTY) over typed IPC
- chokidar for JSONL watching; incremental append-only tailing, never full re-parse
- better-sqlite3 for local cache; React Flow for the DAG
- LLM calls: shell out to `claude -p --output-format json` (headless). No Anthropic API key, no SDK agent loops.

## Structure
- `src/main/` — Electron main: pty manager, file watcher, JSONL parser, headless-claude runner, SQLite
- `src/renderer/` — React app: Shelf, Wizard, Build Room (Terminal / Kanban / Context panes), Timeline
- `src/shared/` — IPC contract types, JSONL record types (versioned adapter in `src/main/parser/`)
- `templates/` — Travis's PRD and CLAUDE.md templates with `{{placeholders}}`

## Conventions
- TypeScript strict; no `any` in `src/shared/`
- All IPC channels defined once in `src/shared/ipc.ts`; renderer never imports Node modules
- JSONL parser must be tolerant: unknown record types are skipped and logged, never thrown
- Windows paths everywhere: use `path.join`, never hardcoded separators; test with spaces in folder names
- Commit at each working checkpoint with conventional commits (`feat:`, `fix:`, `chore:`)

## Commands
- `npm run dev` — Vite + Electron in watch mode
- `npm run test` — Vitest (parser and status-engine logic must have unit tests)
- `npm run dist` — electron-builder NSIS installer

## Never do
- Add telemetry, accounts, cloud services, or auto-update
- Duplicate Claude Code's task state as a writable source of truth
- Run headless LLM calls automatically in loops — user-triggered or once-per-session-end only, cached by content hash
- Start Phase 5 (auto-approval) under any circumstances without explicit instruction
