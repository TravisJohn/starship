/**
 * Drives Exit & Summarize end to end and checks the Copy Handoff button.
 *
 * The demo project deliberately has NO transcript, which takes
 * generateSessionBriefing's early-return path: it persists degraded continuity
 * sections and returns without ever shelling out to `claude -p`. So this
 * exercises the whole real pipeline - persist, write CONTINUITY.md, build the
 * export, copy it - at zero model cost.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");

const repoRoot = path.resolve(__dirname, "..");

// Generic fixture location, as in demo-fixture.cjs - the app prints each
// project's directory, so a real path would land in any screenshot.
// Override with STARSHIP_DEMO_HOME.
const defaultHome =
  process.platform === "win32"
    ? path.join("C:\\", "starship-verify")
    : path.join(os.homedir(), "starship-verify");
const home = process.env.STARSHIP_DEMO_HOME || defaultHome;
const root = path.join(home, "Projects");

// Build products - acceptance-output/ is already gitignored.
const outputRoot = path.join(repoRoot, "acceptance-output");
const shots = path.join(outputRoot, "verify-copy-handoff");

const log = (...a) => console.log("[handoff]", ...a);

const setup = () => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  for (const d of ["AppData/Roaming", "AppData/Local", "Documents"]) {
    fs.mkdirSync(path.join(home, d), { recursive: true });
  }

  const p = path.join(root, "tide-atlas");
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(
    path.join(p, "CLAUDE.md"),
    "# tide-atlas - CLAUDE.md\n\n## Prime directives\n1. Validate the tide model before building around it.\n2. Nothing leaves the machine.\n"
  );
  fs.writeFileSync(
    path.join(p, "PRD.md"),
    "# tide-atlas - PRD\n\n## 1. One-liner\n\nA local-first tide almanac for one stretch of coastline.\n"
  );
  fs.writeFileSync(
    path.join(p, "PROJECT_LOG.md"),
    "# Project Log\n\n## 2026-08-09 - Validation before UI\n\nReordered Phase 1 so the model is validated first.\n"
  );
  log("fixture built (no transcript, so no model call is possible)");
};

(async () => {
  setup();

  const app = await electron.launch({
    executablePath: electronPath,
    args: [repoRoot],
    cwd: repoRoot,
    env: {
      ...process.env,
      USERPROFILE: home,
      APPDATA: path.join(home, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(home, "AppData", "Local"),
      STARSHIP_DB_PATH: path.join(outputRoot, `verify-handoff-${Date.now()}.sqlite`)
    }
  });

  const page = await app.firstWindow();
  page.on("pageerror", (e) => log("PAGEERROR:", e.message));
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ dialog }, rootPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [rootPath] });
  }, root);

  await page.getByRole("button", { name: "Locate Root" }).click({ timeout: 120000 });
  await page.waitForTimeout(6000);

  await page.evaluate(async () => {
    const state = await window.starship.dashboard.getState();
    const project = state.projects.find((p) => p.name === "tide-atlas");
    await window.starship.intent.saveLedger({
      projectId: project.id,
      purpose: "So I stop driving 40 minutes to a beach that turned out to be blown out.",
      successCriteria: "I check it instead of three other sites for a whole season.",
      acceptedTradeoffs: "One coastline only. No accounts, no sharing.",
      neverDo: "Never become a general weather product."
    });
  });
  await page.getByRole("button", { name: "Rescan" }).click({ timeout: 90000 });
  await page.waitForTimeout(5000);

  // Launch, so a session exists for Exit & Summarize to end.
  await page.getByRole("button", { name: /^tide-atlas/ }).first().click({ timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /^(Launch|Resume)$/ }).first().click({ timeout: 60000 });
  await page.waitForTimeout(9000);
  log("session launched");

  // Exit & Summarize lives in the native File menu, which Playwright cannot
  // click - invoke the item directly.
  const menuResult = await app.evaluate(({ Menu }) => {
    const walk = (items) => {
      for (const item of items) {
        if (item.label && item.label.includes("Summarize")) return item;
        if (item.submenu) {
          const found = walk(item.submenu.items);
          if (found) return found;
        }
      }
      return null;
    };
    const menu = Menu.getApplicationMenu();
    const item = walk(menu.items);
    if (!item) return "not found";
    item.click();
    return `clicked (enabled=${item.enabled})`;
  });
  log("Exit & Summarize:", menuResult);

  await page.waitForTimeout(9000);
  await page.screenshot({ path: path.join(shots, "session-end.png") });
  const screenText = await page.innerText("body");
  log("--- session end screen ---");
  log(screenText.slice(0, 400));

  // Copy Handoff.
  const btn = page.getByRole("button", { name: /^(Copy Handoff|Copied|Couldn't copy)$/ });
  log("copy button present:", (await btn.count()) > 0);
  await btn.click({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(shots, "session-end-copied.png") });
  log("button label after click:", await btn.innerText());

  const clip = await page.evaluate(async () => window.starship.clipboard.readText());
  log(`clipboard length: ${clip.length}`);
  log(`starts with header: ${clip.startsWith("STARSHIP CONTEXT EXPORT - tide-atlas")}`);
  log(`has RULES from CLAUDE.md: ${clip.includes("Validate the tide model")}`);
  log(`has INTENT: ${clip.includes("So I stop driving 40 minutes")}`);
  log(`has MOST RECENT SESSION: ${clip.includes("MOST RECENT SESSION")}`);
  log(`has DECIDED: ${clip.includes("DECIDED - do not reopen")}`);
  log(`has NEXT: ${clip.includes("NEXT")}`);
  log(`non-ASCII bytes: ${(clip.match(/[^\x09\x0A\x20-\x7E]/g) || []).length}`);
  log("--- clipboard tail ---");
  log(clip.slice(-700));

  // CONTINUITY.md should have been written into the project as well.
  const notePath = path.join(root, "tide-atlas", "CONTINUITY.md");
  log(`CONTINUITY.md written: ${fs.existsSync(notePath)}`);

  await app.close();

  // Best effort - the fixture sits at the root of the system drive, and the
  // next run rebuilds it regardless.
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    log(`fixture left at ${home} (still locked); it is rebuilt on the next run`);
  }

  log(`screenshots in ${shots}`);
  log("done");
})().catch((e) => {
  console.error("[handoff] FAILED:", e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
