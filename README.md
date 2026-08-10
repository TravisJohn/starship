<p align="center">
  <img src="brand/starship.png" alt="Starship" width="160">
</p>

<h1 align="center">Starship</h1>

<p align="center">
  <strong>A desktop companion for Claude Code that keeps strategic intent visible in both directions.</strong>
</p>

<p align="center">
  <em>The builder's intent flows down into every artifact the agent executes against.<br>
  The agent's reasoning flows back up — always at decision altitude, never at terminal altitude.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-React_18-informational" alt="Electron + React 18">
  <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/tests-305_passing-success" alt="305 tests passing">
  <img src="https://img.shields.io/badge/platform-Windows_11-lightgrey" alt="Windows 11">
</p>

---

## The problem

Agentic coding made *execution* cheap and *understanding* scarce. Writing code is no longer the bottleneck. Two other things are:

**The friction gap — idea to execution.** Eight manual steps across five surfaces before an agent writes its first line: create the folder, write a PRD, write a CLAUDE.md, init git, compose a cold prompt. The cost is startup energy, which kills more side projects than difficulty does.

**The understanding gap — execution to comprehension.** The agent plans, sequences and trades off, but that reasoning is buried in scrollback. You ship software you cannot narrate. The cost is no transferable judgement.

Existing tools answer *"what is the agent doing?"* — status. Starship answers *"do I agree with where this is going?"* — command. The user of Starship is an architect, not an operator.

## What it does

**Inception.** An interview captures intent *before* requirements — why this exists, what success looks like, which tradeoffs you accept, what must never happen. That becomes a persisted **Intent Ledger**, embedded into a generated PRD, CLAUDE.md and cold prompt. Idea to executing session in minutes, without losing your authorship of the documents.

**Observation.** Claude Code sessions run in a real embedded terminal (xterm.js over ConPTY). Everything Starship displays is reconstructed read-only by tailing `~/.claude/projects/**/*.jsonl` — task state, subagents, activity. Claude Code owns its state; Starship never writes to it and never competes with it.

**Command.** Session briefings, a decision record, a file map, a narrative journey and an initial-plan view — each generated *against* the Intent Ledger, so they can flag drift from what you originally said you wanted, not merely report what happened.

**Handoff.** At session end Starship writes a `CONTINUITY.md` — a thin, provider-agnostic note you paste into the next session, whether that's Claude Code, Codex or Antigravity. It exists for the case where the finishing agent hit a usage limit and could not write one itself.

## Design principles

These are enforced constraints, not aspirations. They are why the codebase looks the way it does.

**Zero agency.** Only Claude Code acts. Starship launches, observes and explains. It never edits your code, never acts autonomously, never answers prompts on the agent's behalf. Exactly one carve-out exists — writing `CONTINUITY.md` at a project root — and it is documented as a deliberate amendment with its reasoning, not a quiet loosening.

**Altitude discipline.** Every surface must communicate decisions, tradeoffs and intent — never file counts or tool-call logs as primary content. The test applied to each one: *does this help the builder decide, or merely inform?*

> **Bad briefing:** "Phase complete. 14 tool calls. 3 files changed."
>
> **Good briefing:** "Phase 1.4 complete. One decision to review: fences are stored as edge-lists rather than tile flags, trading save-file size for simpler collision logic. This constrains how gates work in Phase 1.5."

**Observation over ownership.** `~/.claude/projects/` is strictly read-only. All derived data lives in a local SQLite cache and must be rebuildable from the JSONL at any time.

**Every injected prompt is shown before it fires.** No hidden writes to the pty.

## Architecture

```
src/
├─ main/            Electron main process
│  ├─ pty/          node-pty session management (ConPTY)
│  ├─ parser/       versioned, tolerant JSONL adapter
│  ├─ observation/  transcript discovery + project slug resolution
│  ├─ inception/    interview → templates → headless drafting → project creation
│  └─ *.ts          SQLite cache, briefings, continuity, decision record, file map
├─ renderer/        React 18 + Tailwind — dashboard, Build Room, overlays
└─ shared/          IPC contract types (single source of truth, no `any`)
```

**Process boundary.** The renderer imports no Node modules. Every IPC channel is declared once in `src/shared/ipc.ts` as a typed request/response map, so a handler and its caller cannot drift apart without a compile error.

**Observation pipeline.** `chokidar` watches for changes; transcripts are tailed incrementally and append-only, never fully re-parsed. The parser is deliberately tolerant — unknown record types are skipped and logged rather than thrown, because the transcript format is not a contract anyone promised us.

**LLM calls.** Stateless single-shot only, by shelling out to `claude -p --output-format json`. No API key, no SDK, no agent loops. Calls are user-triggered or once-per-session-end, and cached by content hash — never run in a loop.

## Tech stack

| Layer | Choice |
|---|---|
| Shell | Electron, TypeScript (strict) |
| UI | React 18, Tailwind, xterm.js |
| Terminal | node-pty over ConPTY |
| Storage | better-sqlite3 |
| Watching | chokidar |
| Docs rendering | react-markdown + remark-gfm |
| Tests | Vitest |

## Running it

Requires Windows 11, Node 20 or newer (developed on 24), and Claude Code installed and authenticated on your `PATH`.

```bash
npm install          # rebuilds better-sqlite3 and node-pty against Electron
npm run dev          # Vite + Electron in watch mode
```

```bash
npm test             # 305 unit tests
npm run build        # typecheck main + renderer, bundle
npm run dist         # electron-builder NSIS installer
```

Native modules are rebuilt against Electron's ABI by a `postinstall` hook. If that fails, `scripts/verify-native-modules.cjs` reports which module is mismatched.

## Project status

Built in phases, each sequenced to retire the biggest open question rather than to demo value.

| Phase | Strategic question | Status |
|---|---|---|
| 1 — Shell | Can Claude Code's TUI live inside our window at all? | Done |
| 2 — Inception | Can idea→execution collapse to minutes without losing authorship? | Done |
| 3 — Observation | Can we reconstruct task state reliably from the outside? | Done |
| 4 — Command | Can reasoning be surfaced well enough to never read scrollback? | Done |
| 5 — Auto-approval | Rule-based approvals | Parked, deliberately |

Single user, local-first, non-commercial. No accounts, no telemetry, no cloud, no auto-update — by design, not by omission.

## Engineering notes

The commit history and [`PROJECT_LOG.md`](PROJECT_LOG.md) are the real documentation of how this was built — decisions, the reasoning behind them, and the ones that turned out wrong. A few worth reading:

- **[Every headless feature was broken, silently](PROJECT_LOG.md)** — `claude -p --output-format json` changed its output shape from a single object to an array of stream events. All nine callers broke at once, and nothing failed loudly: each one degrades gracefully by design, and a content-hash cache kept serving stale results. Graceful degradation plus caching is exactly the combination that turns a total outage into what looks like a quiet day. The fix accepts both envelope shapes rather than swapping one hard assumption for another.

- **Accumulating a decision record across generations** — an exact `(chose, over)` string key was used to merge decisions found in successive passes. It failed, because models reliably reword. Roughly half of 50 accumulated rows turned out to be duplicates. The fix was *not* to add fuzzy matching alongside the exact key — two matching mechanisms solving one problem is itself the bug — but to route accumulation through the merge pass that already existed.

- **Documents are not structured data** — Inception asked the model to wrap an entire markdown document inside `{"draft": "..."}` JSON. Prose containing a straight quotation mark produced invalid JSON, and the escaped remains were written to disk. The failure got *more* likely the better the model wrote.

## Repository map

| Path | Contents |
|---|---|
| [`PRD.md`](PRD.md) | Full product requirements, v2.0 |
| [`PROJECT_LOG.md`](PROJECT_LOG.md) | Decision log — every milestone and reversal |
| [`CLAUDE.md`](CLAUDE.md) | Working agreement enforced on agents in this repo |
| `prompts/` | Headless prompt templates, each embedding the altitude rules |
| `templates/` | PRD and CLAUDE.md templates with placeholders |

---

<p align="center"><sub>Built by <a href="https://github.com/TravisJohn">Travis</a> · Personal project, not a product</sub></p>
