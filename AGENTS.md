# AGENTS.md — Starship

Read `CLAUDE.md` first. It is the project's working agreement and it applies
to every agent working here, not only Claude Code.

## Session end: write CONTINUITY.md

The trigger itself lives in the global `~/.codex/AGENTS.md` and applies here
unchanged: at session end, overwrite `CONTINUITY.md` in the project root and
print the same text so it can be copied into the next session.

This repo carries the canonical version of that artifact's rules — the shape
to follow, why `DECIDED` and `NEVER` are separate sections, and the reasoning
behind the five-bullet cap. Read `templates/CONTINUITY.md` before writing the
first one.

`CONTINUITY.md` is gitignored. It is disposable by design; `PROJECT_LOG.md`
is the durable record.

This file is deliberately not a copy of `CLAUDE.md`. Where the two ever
disagree, `CLAUDE.md` wins.
