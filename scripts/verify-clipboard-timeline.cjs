/**
 * E2E check for three Terminal-page changes: xterm clipboard (Ctrl+C/Ctrl+V/
 * right-click), the Timeline tab (briefing history), and that the Intent
 * tab's Export Decisions control renders. Launches a real project (the
 * Starship repo itself, so `claude` is already trusted here and skips any
 * first-run onboarding) against a throwaway seeded DB - never the real
 * userData DB.
 *
 * Does not click "Export Decisions": it opens a native OS save dialog that
 * Playwright's Electron driver cannot see or dismiss (it only automates the
 * Chromium window, not native common dialogs), so a click there would hang
 * forever. That handler is covered instead by decisionsExport.test.ts.
 *
 * Never presses Enter on typed terminal input - only tests are pty-level
 * echo/copy/paste, so no prompt is ever submitted to Claude and no model
 * usage occurs.
 *
 * GOTCHA: the copy-with-selection step needs a real xterm selection, but
 * Claude Code's TUI enables terminal mouse-tracking, so a scripted click
 * never reaches xterm's own SelectionService the way a real user's
 * Shift+click would (confirmed: a scripted triple-click left
 * .xterm-selection with zero children). This script drives xterm's own
 * `terminal.select()` API instead via `window.__starshipTerminalDebug`, a
 * hook that is NOT present in shipped code - it was added to Terminal.tsx
 * temporarily for this verification pass and removed again afterward. To
 * re-run this exact check, temporarily re-add, right after
 * `terminal.open(container)`:
 *   (window as unknown as { __starshipTerminalDebug?: unknown }).__starshipTerminalDebug = terminal;
 * then `npm run build` before running this script, then revert it.
 */
const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const repoRoot = path.resolve(__dirname, "..");

const waitForTerminalText = async (page, expected, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";

  while (Date.now() < deadline) {
    lastText = await page
      .locator(".xterm")
      .innerText({ timeout: 1000 })
      .catch(() => "");

    if (lastText.includes(expected)) {
      return lastText;
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`Timed out waiting for terminal text "${expected}". Last text:\n${lastText}`);
};

(async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-verify-db-"));
  const dbPath = path.join(dbDir, "starship.sqlite");

  // Root points at the repo's real parent directory, so "starship" is
  // discovered as an actual, already-trusted project (skips claude's
  // first-run onboarding). "Locate Root" forces a full disk-size scan of
  // every sibling folder there too (dashboard.ts's decorateProjects) -
  // give it real time rather than trying to avoid it with a junction
  // (Windows reparse points aren't reported as directories by readdir's
  // withFileTypes, so a junction-only scratch root discovers zero projects).
  const projectsRoot = path.resolve(repoRoot, "..");

  const app = await electron.launch({
    executablePath: electronPath,
    args: [repoRoot],
    cwd: repoRoot,
    env: { ...process.env, STARSHIP_DB_PATH: dbPath }
  });

  try {
    const page = await app.firstWindow();

    // Stub the native folder picker so "Locate Root" resolves immediately to
    // the real projects folder (Playwright's Electron driver can't see or
    // drive native OS dialogs at all - this patches the same `electron`
    // module the running app already imported, in its own main process).
    await app.evaluate(({ dialog }, rootPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [rootPath] });
    }, projectsRoot);

    // "Locate Root" forces a full disk-size scan of every discovered
    // project (see dashboard.ts's decorateProjects) - give it real time.
    await page.getByRole("button", { name: "Locate Root" }).click({ timeout: 60000 });

    // --- Dashboard: launch the "starship" project row ---
    const row = page.locator("tr", { hasText: "starship" }).first();
    await row.waitFor({ timeout: 15000 });
    await row.getByRole("button", { name: "Launch" }).click();

    // --- Build Room: terminal comes up ---
    await page.locator(".xterm").waitFor({ timeout: 15000 });
    await page.waitForTimeout(2000); // let the claude banner render
    await page.locator(".xterm").click();

    // --- Clipboard: type, select, Ctrl+C, verify via the real clipboard ---
    const copyMarker = `STARSHIP_CLIP_COPY_${Date.now()}`;
    await page.keyboard.type(copyMarker);
    await waitForTerminalText(page, copyMarker);

    // Claude Code's TUI enables terminal mouse-tracking, so a scripted
    // click never reaches xterm's own SelectionService the way a real
    // Shift+click would (confirmed: triple-clicking the marker row left
    // .xterm-selection with zero children). Drive xterm's own selection API
    // directly instead, via the TEMP-VERIFY-HOOK in Terminal.tsx.
    const hasDebugHook = await page.evaluate(() => Boolean(window.__starshipTerminalDebug));
    if (!hasDebugHook) {
      throw new Error(
        "window.__starshipTerminalDebug is not present. This script's copy-with-selection " +
          "step needs it - see the GOTCHA note at the top of this file for how to add it " +
          "back to Terminal.tsx temporarily, then `npm run build`, before re-running this."
      );
    }

    const selected = await page.evaluate((marker) => {
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
    }, copyMarker);

    if (selected !== copyMarker) {
      throw new Error(`terminal.select() did not select the marker. Got: ${JSON.stringify(selected)}`);
    }

    await page.keyboard.press("Control+c");
    await page.waitForTimeout(200);
    const clipboardAfterCopy = await page.evaluate(() => window.starship.clipboard.readText());
    if (!clipboardAfterCopy.includes(copyMarker)) {
      throw new Error(
        `Ctrl+C with a selection did not copy the selected text. Clipboard held: ${JSON.stringify(
          clipboardAfterCopy
        )}`
      );
    }
    console.log(`✅ Ctrl+C copied selection to clipboard: ${JSON.stringify(clipboardAfterCopy)}`);

    // --- Clipboard: Ctrl+V pastes into the pty ---
    const pasteMarker = `STARSHIP_CLIP_PASTE_${Date.now()}`;
    await page.evaluate((text) => window.starship.clipboard.writeText(text), pasteMarker);
    await page.locator(".xterm").click();
    await page.keyboard.press("Control+v");
    await waitForTerminalText(page, pasteMarker);
    console.log("✅ Ctrl+V pasted clipboard text into the terminal.");

    // --- Right-click with no selection pastes ---
    const rightClickMarker = `STARSHIP_CLIP_RCLICK_${Date.now()}`;
    await page.evaluate((text) => window.starship.clipboard.writeText(text), rightClickMarker);
    await page.locator(".xterm").click({ button: "right" });
    await waitForTerminalText(page, rightClickMarker);
    console.log("✅ Right-click with no selection pasted the clipboard.");

    // --- Timeline tab: empty state (nothing has been Exit & Summarized yet) ---
    await page.getByRole("button", { name: "Timeline" }).click();
    await page.getByText("Nothing here yet").waitFor({ timeout: 5000 });
    console.log("✅ Timeline tab renders its empty state before any Exit & Summarize.");

    // --- Intent tab: Export Decisions control is present and enabled ---
    await page.getByRole("button", { name: "Intent" }).click();
    const exportButton = page.getByRole("button", { name: "Export Decisions" });
    await exportButton.waitFor({ timeout: 5000 });
    console.log("✅ Intent tab renders the Export Decisions control (not clicked - native dialog).");

    console.log("\nAll checks passed.");
  } finally {
    await app.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
