const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "acceptance-output");
fs.mkdirSync(outputDir, { recursive: true });

const taskPrompt =
  "Starship Phase 1 acceptance task. Please complete a real multi-step coding task in this temporary project: inspect README.md and package.json, inspect the repository tree, create src/wordStats.js exporting analyzeText(text) with wordCount lineCount and uniqueWords, add test/wordStats.test.js using node:test, update README.md with usage, run npm test, then summarize the implementation choices. To create enough terminal overflow for scrollback verification, print 80 short numbered lines using prefix STARSHIP_SCROLL_ plus zero-padded numbers from 001 through 080 near the end. Finish with the exact token formed by joining STARSHIP_PHASE1_ and DONE.";

const interruptPrompt =
  "For the terminal interrupt portion of Starship Phase 1 acceptance, run npm run slow now. It is intentionally long-running; start it and wait for me to interrupt it.";

const finalPrompt =
  "Please reply exactly STARSHIP_AFTER_INTERRUPT so I can confirm the TUI accepted input after Ctrl+C.";

const log = (message) => {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
};

const compactTail = (text) =>
  text
    .slice(-1200)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join(" | ");

const terminalText = async (page) =>
  page.locator(".xterm").innerText({ timeout: 1000 }).catch(() => "");

const waitForTerminalText = async (page, expected, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await terminalText(page);
    if (text.includes(expected)) {
      return text;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for terminal text: ${expected}`);
};

const pasteAndEnter = async (page, text) => {
  await page.locator(".xterm").click();
  await page.keyboard.press("Control+U");
  await page.waitForTimeout(200);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(1000);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
};

const pasteAndSubmit = async (page, text, visibleNeedle) => {
  await pasteAndEnter(page, text);
  await page.waitForTimeout(2500);
  const afterEnter = await terminalText(page);
  if (afterEnter.includes(visibleNeedle) && !/esc to interrupt|Baked|Skedaddling/i.test(afterEnter)) {
    log("Prompt still visible after Enter; sending Ctrl+Enter submit fallback.");
    await page.keyboard.press("Control+Enter");
    await page.waitForTimeout(1000);
  }
};

const approveVisiblePromptIfNeeded = async (page, text) => {
  const tail = text.slice(-3000);
  const looksLikePermission =
    /Do you want to proceed|Allow|permission|Would you like|Run this command|Use this tool|Edit file|Create file/i.test(
      tail
    ) && /Yes|Allow|Proceed|continue/i.test(tail);

  if (!looksLikePermission) {
    return false;
  }

  log("Approving visible Claude confirmation prompt with Enter.");
  await page.locator(".xterm").click();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  return true;
};

const waitForTaskDone = async (page, browserWindow) => {
  const start = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  let resizedSmall = false;
  let resizedLarge = false;
  let lastLog = 0;

  while (Date.now() - start < timeoutMs) {
    const text = await terminalText(page);
    if (text.includes("STARSHIP_PHASE1_DONE")) {
      return text;
    }

    await approveVisiblePromptIfNeeded(page, text);

    const elapsed = Date.now() - start;
    if (!resizedSmall && elapsed > 8000) {
      resizedSmall = true;
      log("Resizing Electron window smaller during active Claude session.");
      await browserWindow.evaluate((win) => win.setSize(980, 640));
    }

    if (!resizedLarge && elapsed > 18000) {
      resizedLarge = true;
      log("Resizing Electron window larger during active Claude session.");
      await browserWindow.evaluate((win) => win.setSize(1320, 860));
    }

    if (Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      log(
        `Waiting for Claude task completion; terminal chars=${text.length}; tail=${compactTail(
          text
        )}`
      );
    }

    await page.waitForTimeout(1000);
  }

  throw new Error("Timed out waiting for STARSHIP_PHASE1_DONE.");
};

const terminalMetrics = async (page) =>
  page.evaluate(() => {
    const viewport = document.querySelector(".xterm-viewport");
    const spans = Array.from(document.querySelectorAll(".xterm-rows span"));
    const colors = new Set(
      spans
        .map((span) => getComputedStyle(span).color)
        .filter((color) => color && color !== "rgb(226, 232, 240)")
    );

    return {
      viewportScrollHeight: viewport?.scrollHeight ?? 0,
      viewportClientHeight: viewport?.clientHeight ?? 0,
      coloredSpanCount: colors.size,
      rowSpanCount: spans.length
    };
  });

const createTempProject = () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "starship-phase1-"));
  const projectPath = path.join(tempRoot, "Acceptance Project With Spaces");
  fs.mkdirSync(projectPath);
  fs.writeFileSync(
    path.join(projectPath, "package.json"),
    JSON.stringify(
      {
        name: "starship-phase1-acceptance",
        version: "0.0.0",
        private: true,
        type: "commonjs",
        scripts: {
          test: "node --test",
          slow:
            "node -e \"let i=0; setInterval(()=>console.log('STARSHIP_INTERRUPT_'+(++i)), 250)\""
        }
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(projectPath, "README.md"),
    "# Acceptance Project\n\nTemporary project for Starship Phase 1 shell acceptance.\n"
  );

  return {
    tempRoot,
    projectPath,
    dbPath: path.join(tempRoot, "starship.sqlite")
  };
};

(async () => {
  const { tempRoot, projectPath, dbPath } = createTempProject();
  log(`Temporary acceptance project: ${projectPath}`);
  log(`Acceptance prompt shown before firing: ${taskPrompt}`);

  const app = await electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      STARSHIP_DB_PATH: dbPath
    }
  });

  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Locate Root" }).waitFor({
      timeout: 10000
    });
    await app.evaluate(
      ({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selectedPath]
        });
      },
      tempRoot
    );

    await page.getByRole("button", { name: "Locate Root" }).click();
    await page
      .locator("tbody tr")
      .filter({ hasText: "Acceptance Project With Spaces" })
      .waitFor({ timeout: 10000 });
    await page
      .locator("tbody tr")
      .filter({ hasText: "Acceptance Project With Spaces" })
      .getByRole("button", { name: "Launch" })
      .click();
    await page.locator(".xterm").waitFor({ timeout: 10000 });

    await waitForTerminalText(page, "Yes, I trust this folder", 45000);
    await page.screenshot({ path: path.join(outputDir, "phase1-trust.png") });
    await page.locator(".xterm").click();
    await page.keyboard.press("Enter");
    log("Accepted Claude workspace trust prompt for the temporary project.");

    await waitForTerminalText(page, "manual mode", 45000);
    await page.screenshot({ path: path.join(outputDir, "phase1-ready.png") });
    log("Claude TUI reached the main prompt.");

    await pasteAndSubmit(page, taskPrompt, "Starship Phase 1 acceptance task");
    const browserWindow = await app.browserWindow(page);
    const finalTaskText = await waitForTaskDone(page, browserWindow);
    await page.screenshot({ path: path.join(outputDir, "phase1-task-done.png") });
    log("Claude completed the multi-step coding task.");

    const metricsAfterTask = await terminalMetrics(page);
    log(`Terminal metrics after task: ${JSON.stringify(metricsAfterTask)}`);

    await page.locator(".xterm").hover();
    await page.mouse.wheel(0, -5000);
    await page.waitForTimeout(1000);
    const scrolledText = await terminalText(page);
    await page.screenshot({ path: path.join(outputDir, "phase1-scrollback.png") });
    await page.mouse.wheel(0, 5000);
    await page.waitForTimeout(500);

    if (
      metricsAfterTask.viewportScrollHeight <= metricsAfterTask.viewportClientHeight &&
      scrolledText === finalTaskText &&
      metricsAfterTask.rowSpanCount < 120
    ) {
      throw new Error("Terminal did not show evidence of overflow scrollback.");
    }

    log(
      `Scrollback check: viewport=${metricsAfterTask.viewportScrollHeight}/${metricsAfterTask.viewportClientHeight}, rowSpans=${metricsAfterTask.rowSpanCount}, wheelChanged=${
        scrolledText !== finalTaskText
      }, scrolledTail=${compactTail(scrolledText)}`
    );

    const srcPath = path.join(projectPath, "src", "wordStats.js");
    const testPath = path.join(projectPath, "test", "wordStats.test.js");
    if (!fs.existsSync(srcPath) || !fs.existsSync(testPath)) {
      throw new Error("Expected source and test files were not created.");
    }

    log(`Interrupt prompt shown before firing: ${interruptPrompt}`);
    await pasteAndEnter(page, interruptPrompt);

    const interruptStart = Date.now();
    let sawInterruptOutput = false;
    while (Date.now() - interruptStart < 180000) {
      const text = await terminalText(page);
      await approveVisiblePromptIfNeeded(page, text);
      if (text.includes("STARSHIP_INTERRUPT_")) {
        sawInterruptOutput = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!sawInterruptOutput) {
      throw new Error("Did not observe long-running command output before Ctrl+C.");
    }

    await page.keyboard.press("Control+C");
    log("Sent Ctrl+C while long-running command output was visible.");
    await page.waitForTimeout(5000);

    log(`Post-interrupt prompt shown before firing: ${finalPrompt}`);
    await pasteAndEnter(page, finalPrompt);
    await waitForTerminalText(page, "STARSHIP_AFTER_INTERRUPT", 120000);
    await page.screenshot({
      path: path.join(outputDir, "phase1-after-interrupt.png")
    });

    await pasteAndEnter(page, "/exit");
    await waitForTerminalText(page, "[process exited", 60000);
    log("Claude session exited and PTY exit marker appeared.");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
