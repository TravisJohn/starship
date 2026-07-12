# Starship Phase 1 Log

Phase 1 scope: Electron shell, manual Project Shelf, embedded xterm.js terminal launching `claude` through `node-pty`/ConPTY. No Phase 2+ scaffolding.

## T1. Scaffold Electron + Vite + React 18 + TS + Tailwind

### Actions and reasoning
- Read `PRD.md` and `CLAUDE.md` before implementation, then treated the supplied T1-T6 plan as binding.
- Confirmed the repository started with only `PRD.md` and `CLAUDE.md`, so the scaffold is new work rather than adaptation of an existing app.
- Confirmed `node`, `npm`, and `claude.exe` are available on PATH. `msbuild`, `cl`, and `vswhere` are not on PATH, so the `node-pty` native rebuild remains a first-run risk to verify in T3 rather than a settled assumption.
- Chose separate TypeScript project references for `src/shared`, `src/main`, and `src/renderer` because the approved plan explicitly requires strict TypeScript with separated configs. `src/main/preload.ts` lives under the main config because it is Electron-side code and must not be imported by the renderer.
- Chose a simple dev flow: Vite serves the renderer, TypeScript compiles main/preload to `dist/main`, and Electron loads the Vite URL in dev or `dist/renderer/index.html` when packaged. This keeps HMR in the renderer without adding Phase 2 infrastructure.
- Ran `npm install`; the T1 dependency set installed with no reported vulnerabilities.
- Ran `npm run build`; fixed a TypeScript 6 configuration issue by switching the main-process config from the removed `moduleResolution: "Node"` alias to `module`/`moduleResolution: "Node16"`.
- Verified the Vite dev server served `index.html` with the renderer entry. Then launched Electron directly against `VITE_DEV_SERVER_URL=http://127.0.0.1:5173`; it stayed alive for the bounded 8-second launch. The wrapper returned a nonzero exit during cleanup after printing the success line, so I checked and confirmed no repo-owned Node/Electron processes were left running.
- Added `.gitignore` before the first checkpoint so build output, TypeScript build info, temp logs, and `node_modules` do not enter the project history.

### Decisions not explicit in the plan
- The renderer Vite app uses the repository root as Vite root and `src/renderer/main.tsx` as the entry from `index.html`. This avoids a second Vite root convention while still keeping all renderer source in `src/renderer`.
- The BrowserWindow opens at 1200x800 with context isolation enabled and Node integration disabled. This is the minimal secure Electron baseline and supports the T2 preload boundary.
- Deferred `node-pty`, xterm, and `better-sqlite3` dependencies to T3/T4. I initially listed them while drafting `package.json`, then corrected the manifest before install so the checkpoint follows task order.

### Deviations
- None so far.

### CLAUDE.md / PRD risk review
- Ruled out `~/.claude/projects` writes: no code has been added that reads or writes Claude state directories.
- Ruled out Phase 2+ scope creep: no Kanban, Intent panel, DAG, Timeline, headless Claude calls, Intent Ledger, or Inception code/files have been created.
- Native rebuild risk remains open for T3 because Visual Studio build tools are not discoverable on PATH.
