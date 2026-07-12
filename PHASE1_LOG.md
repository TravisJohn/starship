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

## T2. Typed IPC contract + preload

### Actions and reasoning
- Defined the Phase 1 IPC surface in `src/shared/ipc.ts`: PTY spawn/write/resize/kill, PTY data/exit events, and shelf add/list/launch types.
- Added a preload bridge using `contextBridge` and `ipcRenderer` that exposes only the typed `window.starship` API to the renderer.
- Added a renderer global declaration so React components consume `window.starship` without importing Electron or Node modules.
- Updated the TypeScript build scripts to use `tsc -b` for project references after the first compile showed `tsc -p` was not building the shared contract before main/preload. Shared declarations emit under `dist/shared` so generated type files stay out of `src/shared`.

### Decisions not explicit in the plan
- The PTY spawn request includes an explicit `sessionId`, `args`, `cwd`, `cols`, and `rows`. Supplying the id from the renderer lets T3/T5 keep terminal component lifecycle ownership straightforward while the main process still owns the actual ConPTY session.
- Event subscriptions return an unsubscribe function. This keeps React effects easy to clean up and reduces the chance that remounts duplicate terminal data listeners.
- `shelf:launch` returns the resolved project for now, not a spawned PTY. This preserves the T2 contract while leaving the T5 decision about launching Claude through the same PTY bridge until that task.

### Deviations
- None.

### CLAUDE.md / PRD risk review
- Ruled out renderer Node access: the renderer receives a narrow preload API only; Electron `nodeIntegration` remains disabled.
- Ruled out hidden prompt injection: no code writes to a PTY or starts Claude in T2.
- Ruled out `~/.claude/projects` writes and Phase 2+ scope creep.

## T3. PTY bridge - node-pty main to xterm renderer

### Actions and reasoning
- Installed `node-pty`, `xterm`, `xterm-addon-fit`, and `@electron/rebuild` as required by T3.
- npm warned that `xterm` and `xterm-addon-fit` are deprecated in favor of `@xterm/*` packages. I kept the plan-specified packages for Phase 1 rather than substituting package names mid-phase.
- Forced `electron-rebuild -f -w node-pty`; it failed because Visual Studio Build Tools are present but the Spectre-mitigated VC libraries required by `node-pty` are missing. Verified the `node-pty` Windows prebuild loads under Electron's embedded Node with `ELECTRON_RUN_AS_NODE=1`, so the app can still exercise ConPTY on this machine. The postinstall hook now attempts `electron-rebuild -w node-pty` and falls back to a prebuild load verification script if rebuild fails.
- Added `src/main/pty/ptyManager.ts`. The main process owns PTY sessions keyed by renderer-supplied session id, sends `pty:data`/`pty:exit` back only to the WebContents that spawned the session, and kills all sessions on app quit.
- Added `src/renderer/components/Terminal.tsx`, using xterm.js with the fit addon, direct keyboard/data forwarding, and debounced `ResizeObserver` resize propagation.
- Temporarily routed `App.tsx` to a full-pane PowerShell diagnostic terminal so T3 can verify the bridge before the Project Shelf exists.
- Added a dev-only Playwright Core verification script that drives the built Electron app, types PowerShell commands through xterm, resizes the window, and checks rendered terminal text for before/after markers.
- The first verifier run showed the built renderer was blank because Vite emitted absolute `/assets/...` URLs for `file://` loading. Set `base: "./"` in `vite.config.ts`; this is needed for packaged Electron loading and is still within T1/T3 shell scope.
- The second verifier run reached the first PowerShell marker, proving keyboard input traversed xterm to ConPTY. The run then failed in the harness because Playwright exposes BrowserWindow as an evaluate handle; updated the resize step accordingly.
- The final `npm run verify:terminal:powershell` pass succeeded: a built Electron app launched, PowerShell spawned in the embedded terminal, a marker command appeared before resize, the window resized, and a second marker appeared after resize.
- Ran `npm run postinstall`; it reproduced the Spectre-library rebuild failure and then exited successfully through the Electron prebuild verification fallback.

### Decisions not explicit in the plan
- The T3 diagnostic terminal passes an empty `cwd`; the main process interprets that as its own current working directory. This avoids hardcoding this repo's path into renderer code while still letting T5 pass an explicit project path.
- Resize propagation is debounced at 90 ms. This is long enough to coalesce rapid ResizeObserver events during window drags but short enough that interactive resizing still feels immediate.
- React StrictMode was removed from the renderer entry. Its dev-only double mount would spawn and kill two PTYs for one visible terminal, which would pollute the ConPTY go/no-go signal.
- The postinstall rebuild fallback is deliberately narrow: it only accepts failure if `node-pty` can load under Electron. This keeps a missing toolchain from blocking the current machine while still failing installs where no compatible prebuild exists.
- Playwright Core was added as a dev dependency only for Phase 1 verification. It does not add a product surface or any Phase 2 behavior.

### Deviations
- `electron-rebuild` cannot complete on this machine until the Spectre-mitigated VC libraries are installed. The current workaround relies on `node-pty`'s Electron-compatible prebuild and is logged as a packaging risk for the go/no-go writeup.

### CLAUDE.md / PRD risk review
- Hit the native rebuild risk directly. It is not blocking runtime on this machine because the prebuild loads under Electron, but it remains a first-run/packaging risk.
- Resize/reflow risk is addressed with a debounced ResizeObserver and by sending `pty:resize` only after a PTY has spawned and the terminal size has actually changed.
- Ruled out `~/.claude/projects` writes and Phase 2+ scope creep.
