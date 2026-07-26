---
name: verify
description: How to drive the real Starship Electron app end-to-end for a verification pass.
---

# Verifying Starship end-to-end

Starship is an Electron + React app. The renderer starts on the Mission
Dashboard, not the Terminal - `scripts/verify-terminal-powershell.cjs` is
stale on this point (it assumes a direct Terminal landing) but still shows
a working build/launch pattern otherwise.

## Recipe: build, launch, seed, drive

```
npm run build   # tsc (main+renderer) + vite build -> dist/
```

Launch via Playwright's Electron driver (`playwright-core` is already a
devDependency):

```js
const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");
const app = await electron.launch({
  executablePath: electronPath,
  args: [repoRoot],
  cwd: repoRoot,
  env: { ...process.env, STARSHIP_DB_PATH: dbPath } // throwaway temp sqlite path - never the real userData DB
});
const page = await app.firstWindow();
```

**Do not** `require("dist/main/db.js")` (or any compiled main module) from a
plain `node` script to seed the DB - `better-sqlite3`'s native binding is
rebuilt for Electron's ABI (via `electron-rebuild` in `postinstall`), not
the host Node's, so it throws `NODE_MODULE_VERSION` mismatch. Seed and
patch state through `app.evaluate(...)` instead, which runs inside the
already-launched Electron main process (matching ABI):

```js
// Stub the native folder picker - Playwright's Electron driver can't see
// or drive native OS common dialogs (open/save) at all, so anything behind
// dialog.showOpenDialog/showSaveDialog needs this instead of a real click.
await app.evaluate(({ dialog }, rootPath) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [rootPath] });
}, someRootPath);
await page.getByRole("button", { name: "Locate Root" }).click({ timeout: 60000 });
```

Point the seeded root at the Starship repo's own real parent directory
(`path.resolve(repoRoot, "..")`) so the "starship" project row is an
already-`claude`-trusted directory - launching `claude` there skips any
first-run trust/onboarding prompt. A junction/symlink-only scratch root
does **not** work: Windows reparse points aren't reported as directories by
`fs.readdirSync(..., { withFileTypes: true })`, so `dashboard.ts`'s
discovery scan finds zero projects.

"Locate Root" (and "Rescan") force a full disk-size walk of every
discovered project (`dashboard.ts`'s `decorateProjects`) - give the click a
long timeout (60s), not Playwright's 30s default, especially the first run
before the OS file cache is warm.

## Driving the Terminal once launched

`.xterm` renders with real DOM rows (`.xterm-rows > div`, one per line),
not canvas-only, so `page.locator(".xterm").innerText()` reliably reflects
terminal content - poll it to wait for expected output.

**Claude Code's own TUI enables terminal mouse-tracking.** This means a
scripted `page.mouse.click(...)` (even multi-click / triple-click, even
holding Shift) never reaches xterm.js's own `SelectionService` the way a
real user's Shift+click would - confirmed by checking
`.xterm-selection`'s child count after a scripted click: always 0. There is
no keyboard-selection extension either (no Shift+Home/End support) to fall
back on.

To test anything gated on "is there a selection" (e.g. Terminal.tsx's
Ctrl+C-copies-if-selected), temporarily add, right after
`terminal.open(container)` in `src/renderer/components/Terminal.tsx`:

```ts
(window as unknown as { __starshipTerminalDebug?: unknown }).__starshipTerminalDebug = terminal;
```

then `npm run build`, then drive selection directly through xterm's real
API (scanning buffer lines for the marker, since a TUI's own redraw logic
means the real terminal cursor position often has nothing to do with where
typed text visually lands):

```js
await page.evaluate((marker) => {
  const term = window.__starshipTerminalDebug;
  const buffer = term.buffer.active;
  for (let y = 0; y < buffer.length; y += 1) {
    const line = buffer.getLine(y);
    const text = line ? line.translateToString(true) : "";
    const col = text.indexOf(marker);
    if (col !== -1) {
      term.select(col, y, marker.length);
      return term.getSelection();
    }
  }
  return null;
}, marker);
```

**Revert the debug hook before finishing** - it's not meant to ship. Rerun
`npm run build` after reverting and confirm the renderer bundle hash goes
back to what it was before the hook existed, as a sanity check that the
revert is clean.

Clipboard itself is reachable directly from the page context (contextBridge
exposes it): `page.evaluate(() => window.starship.clipboard.readText())` /
`writeText(text)`.

Never press Enter on text typed into a live `claude` session during a
verification pass - Enter submits it as a real prompt (real model usage on
Travis's own subscription). Terminal-level checks (echo, copy, paste) only
need typed text to sit in the input line; Ctrl+C without a selection
cancels/clears it safely.

## Verifying generated-HTML rendering without Electron at all

File Map and Decision Map both render their DAG as a self-contained HTML
string (`renderFileMapHtml`/`renderDecisionMapHtml`) with inline JS - a
**pure function** of already-computed data, no Electron/IPC/DB involved.
For checking that rendering logic (layout math, click handlers, centering),
skip Electron entirely: feed the function synthetic nodes/edges directly,
write the returned HTML to a temp file, and open it with Playwright's
regular `chromium.launch()` (not `_electron`) - a plain headless browser.
This is far faster than the full Electron-launch recipe above and is the
right tool whenever the thing being checked is the client-side rendering
itself rather than the IPC/data pipeline around it. See
`scripts/verify-decision-map-layouts.cjs` - it also demonstrates a good
habit for this kind of layout code: take a screenshot and actually read it
as an image, not just assert element counts. A centering bug in Decision
Map's tree layout (positions computed in a "centered on zero" convention,
but the canvas-centering offset assumed "left-aligned from zero" - two
internally-consistent but mutually incompatible conventions) passed every
node/edge-count assertion and was only caught by looking at the picture.

## Avoiding a real headless LLM call while verifying

Any feature that shells out via `runHeadlessClaude` (File Map, Intent
annotation, Briefing, Decision Map, ...) will make a real `claude -p` call -
real model usage on Travis's subscription - the moment it finds a real
transcript to analyze. Pointing a verification script's seeded root at the
Starship repo itself (as the clipboard/Timeline check does, deliberately,
for the *trust* benefit) means these features see this repo's actual, large
decision/session history and will really invoke the model.

To verify the UI/IPC wiring around such a feature without that cost, point
at a **freshly created, empty directory** instead (`fs.mkdirSync` under a
scratch root, not the repo) - it has zero transcripts, so the feature's
"nothing recorded yet" empty state renders with no headless call at all.
See `scripts/verify-decision-map.cjs`. Cover the actual headless-call logic
(prompt construction, response reconciliation) with mocked-`runHeadlessClaude`
unit tests instead (e.g. `decisionMap.test.ts`) - never with a live call.

## What can't be automated here

`dialog.showSaveDialog` (used by `fileMap:download` and
`decisions:export`) opens a native OS Save dialog. Same limitation as
`showOpenDialog` above, but there's rarely a reason to patch it: the
buttons behind it are usually disabled anyway in a no-prompt-submitted test
session (e.g. IntentPanel's "Export Decisions" needs `tasks.length > 0`,
which requires a real submitted prompt to populate). Prefer covering that
handler's logic with a unit test that mocks `electron`'s `dialog` entirely
(see `src/main/decisionsExport.test.ts` for the pattern: hoisted
`vi.fn()`s via `vi.hoisted`, `ipcMain.handle` captured into a `Map` so the
test can invoke the handler directly).
