const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "acceptance-output");
fs.mkdirSync(outputDir, { recursive: true });

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
  let lastLog = 0;

  while (Date.now() < deadline) {
    const text = await terminalText(page);
    if (text.includes(expected)) {
      return text;
    }

    if (Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      log(`Waiting for terminal text ${expected}; tail=${compactTail(text)}`);
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`Timed out waiting for terminal text: ${expected}`);
};

const fillByLabel = async (page, label, value) => {
  await page.getByLabel(label, { exact: true }).fill(value);
};

const createTempWorkspace = () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "starship-phase2-"));
  const parentDirectory = path.join(tempRoot, "Projects With Spaces");
  fs.mkdirSync(parentDirectory);

  return {
    tempRoot,
    parentDirectory,
    dbPath: path.join(tempRoot, "starship.sqlite")
  };
};

const assertIncludes = (text, expected, label) => {
  if (!text.includes(expected)) {
    throw new Error(`${label} did not include expected text: ${expected}`);
  }
};

(async () => {
  const startedAt = Date.now();
  const { tempRoot, parentDirectory, dbPath } = createTempWorkspace();
  const projectName = "Phase Two Notes";
  const projectPath = path.join(parentDirectory, projectName);
  const neverDo = "Never add accounts, telemetry, cloud sync, or a team workflow.";
  const coldPromptToken = "STARSHIP_PHASE2_COLD_PROMPT_RUNNING";

  log(`Temporary Phase 2 workspace: ${tempRoot}`);

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
      parentDirectory
    );

    log("Locating the project root.");
    await page.getByRole("button", { name: "Locate Root" }).click();
    await page.getByRole("button", { name: "New Project" }).waitFor({
      timeout: 10000
    });

    log("Starting Inception from the Mission Dashboard.");
    await page.getByRole("button", { name: "New Project" }).click();

    await fillByLabel(
      page,
      "Why should this project exist?",
      "I need a tiny local notes CLI that keeps project notes in plain markdown so I can use it without opening a larger app."
    );
    await fillByLabel(
      page,
      "What would make this project successful enough to call it real?",
      "A first version can create a notes folder, add timestamped notes, list recent notes, and search note titles from a Windows terminal."
    );
    await fillByLabel(
      page,
      "What tradeoffs are you already willing to accept?",
      "A plain text interface and minimal formatting are acceptable if the project stays small, inspectable, and easy to change."
    );
    await fillByLabel(
      page,
      "What must this project never do or become?",
      neverDo
    );
    await fillByLabel(
      page,
      "What should building this teach you?",
      "How to shape a small command-line product around intent before implementation."
    );
    await page.getByRole("button", { name: "Requirements" }).click();

    await fillByLabel(page, "What should Starship call this project?", projectName);
    await fillByLabel(
      page,
      "What is the one-line offer or premise?",
      "A local-first notes CLI for one builder's project log."
    );
    await fillByLabel(
      page,
      "What should the first working version do?",
      "Initialize a notes directory, add a markdown note with title and timestamp, list notes newest-first, and search note titles."
    );
    await fillByLabel(
      page,
      "Who is it for, even if that is only you?",
      "Travis, working alone on local projects."
    );
    await fillByLabel(
      page,
      "What platforms, stack, or constraints are already decided?",
      "Node.js CLI, TypeScript strict, local filesystem only, Windows paths with spaces must work."
    );
    await fillByLabel(
      page,
      "What other constraints should shape the first phase?",
      "No database, no network, no daemon process, no account model, and no background file watcher."
    );
    await fillByLabel(
      page,
      "What is explicitly out of scope for the first version?",
      "Sync, collaboration, rich text, a GUI, cloud storage, telemetry, and package publishing."
    );

    log("Running real headless Claude drafting calls through the app.");
    await page.getByRole("button", { name: "Draft Files" }).click();
    await page.getByRole("heading", { name: "Review Drafts" }).waitFor({
      timeout: 180000
    });

    const fallbackNotice = page.getByText(
      "Drafting fell back to the filled templates."
    );
    if (await fallbackNotice.isVisible().catch(() => false)) {
      throw new Error("Headless drafting fell back to templates.");
    }

    const prdEditor = page.getByRole("textbox", { name: "PRD.md" });
    const claudeEditor = page.getByRole("textbox", { name: "CLAUDE.md" });
    const prdDraft = await prdEditor.inputValue();
    const claudeDraft = await claudeEditor.inputValue();
    assertIncludes(prdDraft, "Intent Ledger", "PRD draft");
    assertIncludes(prdDraft, neverDo, "PRD draft");
    assertIncludes(claudeDraft, "Intent Ledger", "CLAUDE.md draft");
    assertIncludes(claudeDraft, neverDo, "CLAUDE.md draft");
    await page.screenshot({
      path: path.join(outputDir, "phase2-review-drafts.png")
    });

    log("Creating the new project from reviewed documents.");
    await page.getByRole("button", { name: "Create Project" }).click();
    await page.getByRole("heading", { name: projectName }).waitFor({
      timeout: 30000
    });

    const promptEditor = page.locator("textarea").first();
    await promptEditor.waitFor({ timeout: 10000 });
    const coldPrompt = await promptEditor.inputValue();
    assertIncludes(coldPrompt, "Intent Ledger", "cold prompt");
    assertIncludes(coldPrompt, neverDo, "cold prompt");
    await promptEditor.fill(
      `${coldPrompt}\n\nFor this acceptance check, end your response with ${coldPromptToken}.`
    );
    await page.screenshot({
      path: path.join(outputDir, "phase2-cold-prompt.png")
    });

    const writtenPrd = fs.readFileSync(path.join(projectPath, "PRD.md"), "utf8");
    const writtenClaude = fs.readFileSync(
      path.join(projectPath, "CLAUDE.md"),
      "utf8"
    );
    assertIncludes(writtenPrd, "Intent Ledger", "written PRD.md");
    assertIncludes(writtenPrd, neverDo, "written PRD.md");
    assertIncludes(writtenClaude, "Intent Ledger", "written CLAUDE.md");
    assertIncludes(writtenClaude, neverDo, "written CLAUDE.md");
    if (!fs.existsSync(path.join(projectPath, ".git"))) {
      throw new Error("Created project was not initialized as a git repository.");
    }

    log("Launching Claude from the reviewed cold prompt in the embedded terminal.");
    await page.getByRole("button", { name: "Launch Claude" }).click();
    await page.locator(".xterm").waitFor({ timeout: 10000 });

    const firstTerminalText = await waitForTerminalText(
      page,
      "trust this folder",
      60000
    ).catch(async () => terminalText(page));
    if (/trust this folder/i.test(firstTerminalText)) {
      await page.locator(".xterm").click();
      await page.keyboard.press("Enter");
      log("Accepted Claude workspace trust prompt.");
    }

    await waitForTerminalText(page, coldPromptToken, 180000);
    await page.screenshot({
      path: path.join(outputDir, "phase2-cold-prompt-executed.png")
    });

    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    if (elapsedSeconds > 300) {
      throw new Error(
        `Phase 2 acceptance exceeded five minutes: ${elapsedSeconds}s`
      );
    }

    log(`Phase 2 acceptance verified in ${elapsedSeconds}s.`);
    log(`Created project: ${projectPath}`);
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
