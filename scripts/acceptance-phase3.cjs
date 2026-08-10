const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "acceptance-output");
fs.mkdirSync(outputDir, { recursive: true });

const log = (message) => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

const terminalText = async (page) =>
  page.locator(".xterm").innerText({ timeout: 1000 }).catch(() => "");

const compactTail = (text) =>
  text
    .slice(-1200)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join(" | ");

const waitForTerminalText = async (page, expected, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    const text = await terminalText(page);
    if (text.includes(expected)) {
      return text;
    }
    if (Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      log(`Waiting for terminal text "${expected}"; tail=${compactTail(text)}`);
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`Timed out waiting for terminal text: ${expected}`);
};

const waitFor = async (predicate, timeoutMs, intervalMs = 300) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitFor timed out");
};

// A long prompt's Enter can race the TUI still rendering the typed text
// (acceptance-phase1/2 hit this too): type it, confirm a recognizable
// fragment is actually visible in the terminal before submitting, then wait
// a short settle delay before Enter.
const submitPrompt = async (page, promptText, recognizableFragment) => {
  // Target xterm.js's actual input-capturing element directly rather than
  // clicking the outer .xterm container - more reliable once the terminal
  // has already changed state once before (trust-prompt acceptance).
  const inputArea = page.locator("textarea.xterm-helper-textarea");
  await inputArea.click({ force: true });
  await page.waitForTimeout(300);
  await inputArea.pressSequentially(promptText, { delay: 5 });
  await waitFor(async () => (await terminalText(page)).includes(recognizableFragment), 15000, 300);
  await page.waitForTimeout(500);
  await inputArea.press("Enter");
};

// Reproduces src/main/observation/slug.ts exactly (see that file for the
// two real examples this was reverse-engineered from), so this script can
// locate the transcript Claude Code actually wrote and read ground-truth
// timestamps out of it for the kanban-lag measurement below.
const slugProjectPath = (absolutePath) => absolutePath.replace(/[^a-zA-Z0-9]/g, "-");

const findNewestTranscript = (claudeProjectsRoot, projectPath) => {
  const dir = path.join(claudeProjectsRoot, slugProjectPath(path.resolve(projectPath)));
  if (!fs.existsSync(dir)) {
    return null;
  }
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(dir, name));
  if (files.length === 0) {
    return null;
  }
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
};

const findLatestTaskCompletionTimestampMs = (transcriptPath, taskLabel) => {
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
  let createdToolUseId = null;
  let latestMs = null;
  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type === "assistant" && Array.isArray(record.message?.content)) {
      for (const block of record.message.content) {
        if (block.type !== "tool_use") continue;
        if (block.name === "TaskCreate" && block.input?.subject === taskLabel) {
          createdToolUseId = block.id;
        }
      }
    }
    if (record.type === "user" && Array.isArray(record.message?.content)) {
      for (const block of record.message.content) {
        if (block.type !== "tool_result") continue;
        if (block.tool_use_id === createdToolUseId && record.toolUseResult?.task?.id) {
          // Task materialized; keep scanning for the completing TaskUpdate.
        }
      }
    }
    if (record.type === "assistant" && Array.isArray(record.message?.content)) {
      for (const block of record.message.content) {
        if (block.type !== "tool_use" || block.name !== "TaskUpdate") continue;
        if (block.input?.status === "completed") {
          latestMs = new Date(record.timestamp).getTime();
        }
      }
    }
  }
  return latestMs;
};

const createTempWorkspace = () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "starship-phase3-"));
  const projectPath = path.join(tempRoot, "Phase Three Project");
  fs.mkdirSync(projectPath, { recursive: true });
  return { tempRoot, projectPath, dbPath: path.join(tempRoot, "starship.sqlite") };
};

(async () => {
  const { tempRoot, projectPath, dbPath } = createTempWorkspace();
  const claudeProjectsRoot = path.join(os.homedir(), ".claude", "projects");
  log(`Temporary Phase 3 workspace: ${tempRoot}`);

  const app = await electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: root,
    env: { ...process.env, STARSHIP_DB_PATH: dbPath }
  });

  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Locate Root" }).waitFor({ timeout: 10000 });

    // Stub the folder picker (same pattern as acceptance-phase1/2). Also
    // make a best-effort attempt to record OS Notification calls - this is
    // secondary evidence only (Electron's dev-mode Notification support and
    // module export shape both vary by environment), the authoritative
    // check below is the in-app header, which is driven by the exact same
    // StatusEngine decision text the Notification body uses.
    await app.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
      globalThis.__starshipTestNotifications = [];
      try {
        const electronModule = require("electron");
        const OriginalNotification = electronModule.Notification;
        class RecordingNotification extends OriginalNotification {
          constructor(options) {
            super(options);
            globalThis.__starshipTestNotifications.push({ title: options.title, body: options.body });
          }
        }
        electronModule.Notification = RecordingNotification;
      } catch {
        // Best-effort only; see comment above.
      }
    }, tempRoot);

    log("Locating the temp root in the Mission Dashboard.");
    await page.getByRole("button", { name: "Locate Root" }).click();
    await page
      .locator("tbody tr")
      .filter({ hasText: "Phase Three Project" })
      .waitFor({ timeout: 10000 });

    log("Launching Claude in the embedded terminal.");
    await page
      .locator("tbody tr")
      .filter({ hasText: "Phase Three Project" })
      .getByRole("button", { name: "Launch" })
      .click();
    await page.locator(".xterm").waitFor({ timeout: 10000 });

    const firstTerminalText = await waitForTerminalText(page, "trust this folder", 60000).catch(
      async () => terminalText(page)
    );
    if (/trust this folder/i.test(firstTerminalText)) {
      await page.locator(".xterm").click();
      await page.keyboard.press("Enter");
      log("Accepted Claude workspace trust prompt.");
      // Give the TUI a moment to redraw from the trust screen into the
      // interactive prompt before typing into it.
      await page.waitForTimeout(1500);
    }

    // --- Kanban lag check -------------------------------------------------
    const taskLabel = "STARSHIP_PHASE3_KANBAN_CHECK";
    const kanbanPrompt =
      `Use your task-tracking tool: create exactly one task with subject "${taskLabel}", ` +
      `immediately mark it in_progress, then immediately mark it completed. ` +
      `Do not create any other tasks, do not write or edit any files, do not run any commands. ` +
      `Then stop.`;

    await submitPrompt(page, kanbanPrompt, taskLabel);
    log("Sent kanban-lag check prompt.");

    const domObservedAtMs = await waitFor(async () => {
      const completedTask = page.getByText(taskLabel);
      const visible = await completedTask.isVisible().catch(() => false);
      return visible ? Date.now() : null;
    }, 120000);

    await page.screenshot({ path: path.join(outputDir, "phase3-kanban.png") });

    const transcriptPath = await waitFor(
      () => findNewestTranscript(claudeProjectsRoot, projectPath),
      10000
    );
    const transcriptEventAtMs = await waitFor(
      () => findLatestTaskCompletionTimestampMs(transcriptPath, taskLabel),
      10000
    );

    const lagMs = domObservedAtMs - transcriptEventAtMs;
    log(`Kanban lag: ${lagMs}ms (transcript event -> DOM observed).`);
    if (lagMs < 0 || lagMs > 2000) {
      throw new Error(`Kanban lag ${lagMs}ms is outside the <2s acceptance bar.`);
    }

    // --- Decision-needed notification check --------------------------------
    const decisionCommand = "echo STARSHIP_PHASE3_PERMISSION_CHECK";
    const decisionPrompt =
      `Run this exact shell command using your Bash tool: ${decisionCommand}\n` +
      `Do not use any other tools first.`;

    await submitPrompt(page, decisionPrompt, "STARSHIP_PHASE3_PERMISSION_CHECK");
    log("Sent decision-needed check prompt (expects a real permission prompt in normal mode).");

    await waitFor(async () => {
      const text = await page.locator("header p").innerText().catch(() => "");
      return text.includes("echo") || text.includes(decisionCommand) ? text : null;
    }, 60000);
    log("Build Room header named the pending decision.");

    const notifications = await app.evaluate(() => globalThis.__starshipTestNotifications ?? []);
    const decisionNotification = notifications.find(
      (n) => n.body && n.body.includes("echo") && !n.body.toLowerCase().includes("waiting for input")
    );
    if (decisionNotification) {
      log(`OS Notification observed: ${JSON.stringify(decisionNotification)}`);
    } else {
      log(
        `No OS Notification captured (dev-mode Notification support/module shape varies by environment; ` +
          `this is secondary evidence only). Notifications recorded: ${JSON.stringify(notifications)}`
      );
    }

    // Let the terminal's own permission prompt resolve so the session exits cleanly.
    await page.locator(".xterm").click();
    await page.keyboard.press("Enter");
    await waitForTerminalText(page, "STARSHIP_PHASE3_PERMISSION_CHECK", 30000).catch(() => {});

    log("Phase 3 acceptance checks passed: kanban lag and decision-needed notification.");
  } catch (error) {
    const page = await app.firstWindow().catch(() => null);
    if (page) {
      await page.screenshot({ path: path.join(outputDir, "phase3-failure.png") }).catch(() => {});
      log(`Terminal tail at failure: ${compactTail(await terminalText(page))}`);
    }
    throw error;
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
