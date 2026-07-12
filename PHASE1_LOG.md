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
- Forced `electron-rebuild -f -w node-pty`; it failed because Visual Studio Build Tools are present but the Spectre-mitigated VC libraries required by `node-pty` are missing. Verified the `node-pty` Windows prebuild loads under Electron's embedded Node with `ELECTRON_RUN_AS_NODE=1`, so the app can still exercise ConPTY on this machine.
- Added `src/main/pty/ptyManager.ts`. The main process owns PTY sessions keyed by renderer-supplied session id, sends `pty:data`/`pty:exit` back only to the WebContents that spawned the session, and kills all sessions on app quit.
- Added `src/renderer/components/Terminal.tsx`, using xterm.js with the fit addon, direct keyboard/data forwarding, and debounced `ResizeObserver` resize propagation.
- Temporarily routed `App.tsx` to a full-pane PowerShell diagnostic terminal so T3 can verify the bridge before the Project Shelf exists.
- Added a dev-only Playwright Core verification script that drives the built Electron app, types PowerShell commands through xterm, resizes the window, and checks rendered terminal text for before/after markers.
- The first verifier run showed the built renderer was blank because Vite emitted absolute `/assets/...` URLs for `file://` loading. Set `base: "./"` in `vite.config.ts`; this is needed for packaged Electron loading and is still within T1/T3 shell scope.
- The second verifier run reached the first PowerShell marker, proving keyboard input traversed xterm to ConPTY. The run then failed in the harness because Playwright exposes BrowserWindow as an evaluate handle; updated the resize step accordingly.
- The final `npm run verify:terminal:powershell` pass succeeded: a built Electron app launched, PowerShell spawned in the embedded terminal, a marker command appeared before resize, the window resized, and a second marker appeared after resize.
- Ran `npm run postinstall`; it reproduced the Spectre-library rebuild failure and then exited successfully through the Electron native-module verification fallback.

### Decisions not explicit in the plan
- The T3 diagnostic terminal passes an empty `cwd`; the main process interprets that as its own current working directory. This avoids hardcoding this repo's path into renderer code while still letting T5 pass an explicit project path.
- Resize propagation is debounced at 90 ms. This is long enough to coalesce rapid ResizeObserver events during window drags but short enough that interactive resizing still feels immediate.
- React StrictMode was removed from the renderer entry. Its dev-only double mount would spawn and kill two PTYs for one visible terminal, which would pollute the ConPTY go/no-go signal.
- The postinstall rebuild fallback is deliberately narrow: it only accepts failure if native modules load under Electron. This keeps a missing toolchain from blocking the current machine while still failing installs where no compatible native binary exists.
- Playwright Core was added as a dev dependency only for Phase 1 verification. It does not add a product surface or any Phase 2 behavior.

### Deviations
- `electron-rebuild` cannot complete on this machine until the Spectre-mitigated VC libraries are installed. The current workaround relies on `node-pty`'s Electron-compatible prebuild and is logged as a packaging risk for the go/no-go writeup.

### CLAUDE.md / PRD risk review
- Hit the native rebuild risk directly. It is not blocking runtime on this machine because the prebuild loads under Electron, but it remains a first-run/packaging risk.
- Resize/reflow risk is addressed with a debounced ResizeObserver and by sending `pty:resize` only after a PTY has spawned and the terminal size has actually changed.
- Ruled out `~/.claude/projects` writes and Phase 2+ scope creep.

## T4. Project Shelf - minimal

### Actions and reasoning
- Installed `better-sqlite3` for the single Phase 1 `projects` table.
- Initial Electron load check for `better-sqlite3` failed because npm installed a Node ABI binary. Forced `electron-rebuild -f -w better-sqlite3`; the command still reported failure because `node-pty` hit the Spectre-library issue, but `better-sqlite3` had been rebuilt successfully enough to load under Electron afterward.
- Replaced the T3 node-pty-only native verification fallback with `scripts/verify-native-modules.cjs`, which checks both `node-pty` and `better-sqlite3` under Electron.
- Ran the updated `npm run postinstall`: `better-sqlite3` rebuilt cleanly, `node-pty` still failed on missing Spectre libraries, and the fallback verified both native modules load under Electron.
- Added `src/main/db.ts` with only the `projects` table: `id`, `name`, `path`, `created_at`. No `intent_ledger` or other Phase 2 schema was added.
- Added shelf IPC handlers for `shelf:addProject`, `shelf:listProjects`, and `shelf:launch`. `shelf:addProject` uses Electron's folder picker and stores the selected folder path.
- Added `src/renderer/components/Shelf.tsx` with persisted project cards, Add Project, and Launch buttons.
- Added a Playwright Core shelf verification script that stubs Electron's native dialog in the main process, adds a temporary folder with spaces in its path, restarts the app with the same test DB, and confirms the project persists.
- The first shelf verifier run did add the project, but the assertion was too broad because both the card title and path contained the project name. Narrowed the check to the card heading.
- The final `npm run verify:shelf` pass succeeded: a folder with spaces in the path was added, the app restarted against the same SQLite database, and the project card persisted.

### Decisions not explicit in the plan
- The database path defaults to `app.getPath("userData")/starship.sqlite`, with `STARSHIP_DB_PATH` supported for verification only. This avoids writing test projects into the real app database while keeping production persistence local-first.
- Duplicate folder adds return the existing project instead of failing. This keeps manual use idempotent and avoids duplicate cards for the same path.
- `shelf:launch` only resolves and returns the selected project in T4. The actual Claude terminal handoff remains T5.

### Deviations
- `better-sqlite3` also needs native-module handling under Electron. This was not listed in T4, but follows directly from the approved stack's SQLite requirement.

### CLAUDE.md / PRD risk review
- Ruled out `intent_ledger`: the only table created in T4 is `projects`.
- Ruled out writes into `~/.claude/projects`: shelf persistence writes to Starship's own SQLite database only.
- Native rebuild risk remains present because both native dependencies depend on either Electron-compatible prebuilds or a complete Visual Studio Build Tools installation.

## T5. Wire Launch to real Claude Code session

### Actions and reasoning
- Updated the renderer launch handoff so selecting Launch resolves the project through `shelf:launch`, switches to a single terminal view, and starts `claude` through the existing PTY bridge with `cwd` set to the project path.
- Kept the terminal view to one pane plus a narrow header for project identity and returning to the shelf. No Kanban, Intent panel, DAG, Timeline, briefing surface, headless call, or prompt injection was added.
- A bounded launch test showed `node-pty` on Windows does not apply PATHEXT for bare `claude`, even though `claude.exe` is on PATH. Added main-process normalization that appends `.exe` to extensionless command names on Windows before spawning.
- After normalization, a bounded launch test from a temporary shelf project started Claude Code inside the embedded terminal and showed Claude's workspace trust TUI for that project path.
- Ran a focused TUI key check at Claude's trust prompt: ArrowDown visibly moved selection to "No, exit", ArrowUp restored "Yes, I trust this folder", and Ctrl+C was sent without terminal crash or visible corruption.

### Decisions not explicit in the plan
- Added a small Shelf button in the terminal header. It unmounts the terminal, which triggers the existing PTY kill cleanup, and gives the single-user app a way back without adding another Phase 1 concept.
- Did not add `claude` PATH discovery or bundling. The PTY spawn uses the literal `claude` command, matching T5's assumption.
- The `.exe` normalization is intentionally generic Windows spawn hygiene, not Claude discovery: it does not search PATH, inspect install locations, or special-case Claude.

### Deviations
- None so far.

### CLAUDE.md / PRD risk review
- Ruled out hidden prompt injection: Launch starts Claude only; it does not send text to the TUI.
- Ruled out Phase 2+ panes and state.
- `~/.claude/projects` remains untouched by Starship code; any Claude state writes come from the real Claude Code process the user explicitly launches.

## T6. Acceptance pass + go/no-go

### Actions and reasoning
- Added `scripts/acceptance-phase1.cjs`, a Playwright Core acceptance harness for the final Phase 1 judgement.
- The harness uses the real app flow: add a temporary project through the Shelf, launch the real `claude` TUI through the embedded terminal, accept Claude's visible workspace trust prompt, send a printed multi-step coding task prompt, resize the Electron window mid-session, verify scrollback overflow, run an interrupt prompt, send Ctrl+C while long-running output is visible, confirm the TUI accepts input afterward, and exit Claude.
- Acceptance artifacts are written to `acceptance-output/`, which is ignored so screenshots and logs do not become project state.

### Decisions not explicit in the plan
- The acceptance project lives under the OS temp directory and uses `STARSHIP_DB_PATH` so the test does not pollute the personal Starship shelf database.
- The prompt asks Claude to create implementation and tests, run `npm test`, and emit 80 scroll markers. The markers are not product behavior; they make scrollback verification concrete under a long response.
- The harness prints every prompt to its own log before sending it through xterm. This keeps the "no hidden prompt injection" principle true for the product while making the automated acceptance step auditable.
- First acceptance run failed fast because the completion sentinel appeared in the echoed prompt, so the harness treated the prompt itself as completion and then failed the scrollback check. Updated the prompt wording so the exact final token and final scroll marker are not present in the typed prompt.
- A short follow-up probe confirmed `keyboard.insertText` plus Enter does submit to Claude's TUI; Claude entered its thinking state. Added compact terminal-tail logging to the acceptance wait loop so long-running model/tool activity is distinguishable from a stuck permission prompt.
- The tail logs from the next acceptance attempt showed the full prompt visible in Claude's input area after resize, so the send path was racing the long insert. A long-prompt probe confirmed adding a short settle delay before Enter submits reliably; updated `pasteAndEnter` accordingly.
- The full acceptance prompt still remained visible after Enter in the real run, so the harness now uses a guarded Ctrl+Enter fallback only when the prompt text is still visible and Claude has not entered its interruptible/thinking state.
- A real multi-step run completed through source/test creation and visible approvals, but the harness failed on an overly strict `_080` marker and a browser `scrollHeight` check that does not reflect Claude's alternate-screen TUI. Updated scrollback verification to combine marker search, row-span volume, and an actual mouse-wheel scroll attempt.
- The saved scrollback screenshot showed the embedded TUI did scroll back through the overflowed Claude response, including edits, test output, and the implementation summary. Removed the artificial marker as a hard check and added Ctrl+U before later prompt sends so Claude suggestions or partial input do not contaminate the next acceptance prompt.

### Deviations
- None so far.

### CLAUDE.md / PRD risk review
- `~/.claude/projects` remains read-only from Starship. The real Claude Code process may write its own transcript there during the acceptance run; that is Claude's state, not Starship-derived state.
- The harness intentionally exercises the ConPTY/TUI risk rather than bypassing it: keyboard input, Claude's trust TUI, tool confirmations, resize, scrollback, and Ctrl+C all pass through xterm and node-pty.

### Final acceptance run
- `npm run acceptance:phase1` completed successfully in the background run ending at `2026-07-12T08:19:29Z`; stderr was empty and no repo-owned Electron/Node acceptance processes remained afterward.
- The run launched the built Electron app, added a temporary project with spaces in its path through the Shelf, launched real `claude` in the embedded terminal, accepted Claude's workspace trust prompt, and reached Claude Code's main TUI.
- The acceptance task was a real multi-step Claude Code task, not a toy terminal smoke test. Claude inspected the temp project, created `src/wordStats.js`, created `test/wordStats.test.js`, updated `README.md`, ran `npm test`, and reported all 6 tests passing.
- Manual-mode Claude confirmations appeared for shell/write actions and were accepted through the embedded TUI. This exercised real TUI selection/confirmation rendering rather than bypassing permissions.
- The app resized smaller and then larger during the active Claude task. No visible corruption was logged or seen in the saved screenshots.
- Colour/ANSI fidelity was acceptable for Phase 1: Claude's TUI, green diff blocks, status markers, and prompt chrome rendered correctly in screenshots. The automated DOM metric saw coloured spans during the run (`coloredSpanCount` 5-9 depending on screen).
- Scrollback after overflow was verified by mouse wheel: the final run logged `wheelChanged=true` and saved `acceptance-output/phase1-scrollback.png`, which showed earlier overflowed content from the Claude response, including edited README content and test summary.
- Ctrl+C was tested during a running command inside the Claude session. The harness prompted Claude to run `npm run slow`, waited until `STARSHIP_INTERRUPT_` output was visible, sent Ctrl+C, then sent a post-interrupt prompt. Claude accepted the follow-up prompt and `/exit` produced the terminal `[process exited]` marker.

### Final risk review
- ConPTY/TUI incompatibility: ruled out for Phase 1's required shell path. Claude's trust screen, main TUI, confirmations, tool output, long response, scrollback, resize, Ctrl+C, and exit all functioned inside xterm/node-pty.
- ConPTY resize races: no corruption observed during two active-task resizes. The 90 ms debounce remains the right default for now.
- ANSI/colour fidelity: acceptable with xterm's default renderer; no WebGL fallback needed in Phase 1.
- Native rebuild: still a real setup risk. `better-sqlite3` rebuilds cleanly; `node-pty` rebuild fails on this machine because Spectre-mitigated VC libraries are missing. The Electron-compatible `node-pty` prebuild works, and postinstall verifies native module load as a fallback, but a clean developer setup should install the missing VC component or document the fallback clearly.
- Alt-screen/mouse tracking: Claude appears to use TUI/alternate-screen behavior, so browser `scrollHeight` is not a reliable scrollback signal. Mouse-wheel scroll worked and screenshots show earlier overflowed content.
- Bracketed paste/long input: long prompt entry required a guarded Ctrl+Enter fallback after Enter left the prompt visible. This is acceptable for acceptance automation and did not affect normal typed keys, but future prompt injection features must be tested carefully before Phase 2+.
- `~/.claude/projects`: Starship code still does not write there. The only possible writes during T6 were Claude Code's own transcript/state writes from the explicitly launched real Claude process.

### Go / no-go recommendation
- **Go: proceed as embedded shell.** Phase 1's strategic question is answered: Claude Code's interactive TUI can live inside the Starship window well enough to continue the shell architecture.
- Do **not** pivot to companion for Phase 2. Carry forward the native rebuild/toolchain risk and the long-input submit nuance, but neither invalidates the embedded-shell path.
