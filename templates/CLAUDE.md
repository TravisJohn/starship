# {{project_name}} — CLAUDE.md

{{one_liner}} Single user (Travis), non-commercial unless stated otherwise. Full spec in `PRD.md` — read it, including the Intent Ledger (§2), before any phase work.

## Prime directives
1. **Honour the Intent Ledger.** The project must never: {{never_do}}. If a task appears to conflict with the ledger, stop and ask rather than proceed.
2. **Phase discipline.** Build only the current phase (PRD §9). Each phase answers a named strategic question — stop at its acceptance criteria and report against that question. Never scaffold ahead.
3. **Present the plan before code.** For each phase, present discrete tasks with dependencies and wait for approval. Flag the phase's biggest technical risk explicitly in the plan.
4. **Commit at each working checkpoint** with conventional commits (`feat:`, `fix:`, `chore:`).

## Stack (fixed — do not substitute)
{{stack_details}}

## Structure
{{project_structure}}

## Conventions
- TypeScript strict where applicable; no `any` in shared/contract code
- {{conventions}}
- Windows-safe paths (`path.join`, quoted spawns); test with spaces in folder names

## Commands
{{commands}}

## Never do
- {{never_do}}
- Add telemetry, accounts, or cloud services unless the PRD says otherwise
- Expand scope to serve a hypothetical other user — PRD non-goals (§6) are binding
