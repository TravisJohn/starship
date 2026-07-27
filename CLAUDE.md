# Starship — CLAUDE.md

Personal desktop bridge from idea to running software, keeping strategic intent visible in both directions. Single user (Travis), Windows 11, local-first, non-commercial. Full spec in `PRD.md` (v2.0) — read it before any phase work.

## Prime directives
1. **Zero agency.** Starship launches Claude Code, observes `~/.claude` state, and explains at decision altitude. Never add code that edits user projects, acts autonomously, or answers prompts on Claude's behalf.
2. **Altitude discipline (PRD §6.2).** Any surface, notification, or generated summary must communicate decisions, tradeoffs, and intent — never file counts, tool-call logs, or operational minutiae as primary content. Prompt templates for briefings/annotations must explicitly forbid operational framing and must receive the project's Intent Ledger as context.
3. **Never write into `~/.claude/projects/`.** Read-only. All derived data lives in our SQLite cache and must be rebuildable from JSONL.
4. **Phase discipline.** Build only the current phase (PRD §9). Each phase answers a named strategic question — stop at its acceptance criteria and report against that question, including (Phase 1) an explicit go/no-go recommendation on the shell-vs-companion pivot.
5. **Every injected prompt is shown to the user before firing.** No hidden pty writes.

## Stack (fixed — do not substitute)
- Electron + React 18 + TypeScript + Tailwind; Zustand
- xterm.js (renderer) ↔ node-pty (main, ConPTY) over typed IPC
- chokidar; incremental append-only JSONL tailing, never full re-parse
- better-sqlite3; React Flow for the DAG
- LLM calls: shell out to `claude -p --output-format json` (headless). No API key, no SDK agent loops.

## Structure
- `src/main/` — pty manager, file watcher, JSONL parser (versioned adapter in `src/main/parser/`), headless-claude runner, SQLite (incl. `intent_ledger` table)
- `src/renderer/` — Shelf, Inception wizard, Build Room (Terminal / Kanban / Intent panes), Timeline
- `src/shared/` — IPC contract types (`src/shared/ipc.ts`), JSONL record types
- `templates/` — Travis's PRD and CLAUDE.md templates with `{{placeholders}}`, including Intent Ledger sections
- `prompts/` — headless-call prompt templates (inception, annotation, briefing); each template must embed the altitude rules

## Conventions
- TypeScript strict; no `any` in `src/shared/`
- Renderer never imports Node modules; all IPC channels defined once in `src/shared/ipc.ts`
- JSONL parser tolerant: unknown records skipped and logged, never thrown
- Windows-safe paths (`path.join`, quoted spawns); test with spaces in folder names
- Conventional commits at each working checkpoint

## Commands
- `npm run dev` — Vite + Electron watch mode
- `npm run test` — Vitest (parser, status engine, and briefing prompt-assembly must have unit tests)
- `npm run dist` — electron-builder NSIS installer

## Verification & testing conventions

### Real headless verification runs

Any step that makes a real `claude -p` call against Travis's subscription (not a mocked/unit test) requires a stop-and-confirm before it runs — one step at a time, never a batch.

- State what the next call will do and roughly how long/how much it reads, then wait for a go-ahead before running it.
- Never chain multiple real verification runs in one turn without a check-in between each one.
- If a multi-step verification plan is proposed, list the steps first and let Travis choose how many to run now.

## Never do
- Surface operational detail as primary UI content (violates altitude discipline)
- Add telemetry, accounts, cloud services, or auto-update
- Duplicate Claude Code's task state as a writable source of truth
- Run headless LLM calls in loops — user-triggered or once-per-session-end only, cached by content hash
- Start Phase 5 (auto-approval) without explicit instruction
