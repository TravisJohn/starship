/**
 * Drives the real app to check the context exporter end to end: a project with
 * rules + intent, and one with neither. Confirms Copy actually reaches the
 * clipboard by reading it back through the app's own API.
 *
 * Entirely synthetic fixture under a redirected USERPROFILE, so no real project
 * or transcript is touched, and nothing here can make a model call.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");

const repoRoot = path.resolve(__dirname, "..");

// Same generic fixture location as demo-fixture.cjs, for the same reason: the
// app prints each project's directory, so a real path would land in any
// screenshot taken here. Override with STARSHIP_DEMO_HOME.
const defaultHome =
  process.platform === "win32"
    ? path.join("C:\\", "starship-verify")
    : path.join(os.homedir(), "starship-verify");
const home = process.env.STARSHIP_DEMO_HOME || defaultHome;
const root = path.join(home, "Projects");

// Build products - acceptance-output/ is already gitignored.
const outputRoot = path.join(repoRoot, "acceptance-output");
const shots = path.join(outputRoot, "verify-context-export");

const log = (...a) => console.log("[ctx]", ...a);

const setup = () => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  for (const d of ["AppData/Roaming", "AppData/Local", "Documents"]) {
    fs.mkdirSync(path.join(home, d), { recursive: true });
  }

  const full = path.join(root, "tide-atlas");
  fs.mkdirSync(full, { recursive: true });
  fs.writeFileSync(
    path.join(full, "CLAUDE.md"),
    [
      "# tide-atlas - CLAUDE.md",
      "",
      "## Prime directives",
      "1. Validate the tide model against a published table before building anything around it.",
      "2. One coastline only. Do not generalise the model without asking.",
      "3. Nothing leaves the machine.",
      "",
      "## Stack (fixed)",
      "- TypeScript, SQLite, no framework",
      ""
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(full, "PRD.md"),
    "# tide-atlas - PRD\n\n## 1. One-liner\n\nA local-first tide and swell almanac for one stretch of coastline.\n"
  );
  fs.writeFileSync(
    path.join(full, "PROJECT_LOG.md"),
    "# Project Log\n\n## 2026-08-09 - Validation before UI\n\nReordered Phase 1 so the harmonic model is validated first.\n"
  );

  const bare = path.join(root, "harbour-notes");
  fs.mkdirSync(bare, { recursive: true });

  log("fixture built: tide-atlas (rules + intent), harbour-notes (neither)");
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
      STARSHIP_DB_PATH: path.join(outputRoot, `verify-ctx-${Date.now()}.sqlite`)
    }
  });

  const page = await app.firstWindow();
  page.on("pageerror", (e) => log("PAGEERROR:", e.message));
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ dialog }, rootPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [rootPath] });
  }, root);

  await page.getByRole("button", { name: "Locate Root" }).click({ timeout: 120000 });
  await page.waitForTimeout(7000);

  // Give tide-atlas an Intent Ledger through the app's own IPC.
  const seeded = await page.evaluate(async () => {
    const state = await window.starship.dashboard.getState();
    const project = state.projects.find((p) => p.name === "tide-atlas");
    if (!project) return "tide-atlas not found";
    await window.starship.intent.saveLedger({
      projectId: project.id,
      purpose: "So I stop driving 40 minutes to a beach that turned out to be blown out.",
      successCriteria: "I check it instead of three other sites for a whole season.",
      acceptedTradeoffs: "One coastline only. No accounts, no sharing, no mobile app.",
      neverDo: "Never become a general weather product, and never show a prediction it cannot justify."
    });
    return "seeded";
  });
  log("intent:", seeded);

  await page.getByRole("button", { name: "Rescan" }).click({ timeout: 90000 });
  await page.waitForTimeout(5000);

  const openExportFor = async (name) => {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click({ timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Export Context", exact: true }).click({ timeout: 30000 });
    await page.waitForTimeout(2500);
  };

  // 1. Rich project.
  await openExportFor("tide-atlas");
  await page.screenshot({ path: path.join(shots, "export-full.png") });
  const fullText = await page.locator("pre").first().innerText();
  log("--- tide-atlas block ---");
  log(fullText.slice(0, 700));
  log(`... total rendered chars: ${fullText.length}`);

  // Copy, then read it back through the app's own clipboard API.
  await page.getByRole("button", { name: /^(Copy|Copied)$/ }).click({ timeout: 30000 });
  await page.waitForTimeout(1200);
  const clip = await page.evaluate(async () => window.starship.clipboard.readText());
  log(`clipboard length: ${clip.length}`);
  log(`clipboard starts with header: ${clip.startsWith("STARSHIP CONTEXT EXPORT - tide-atlas")}`);
  log(`clipboard has RULES: ${clip.includes("Validate the tide model")}`);
  log(`clipboard has INTENT: ${clip.includes("So I stop driving 40 minutes")}`);
  log(`clipboard has STATE: ${clip.includes("A local-first tide and swell almanac")}`);
  log(`clipboard non-ASCII bytes: ${(clip.match(/[^\x09\x0A\x20-\x7E]/g) || []).length}`);
  await page.screenshot({ path: path.join(shots, "export-copied.png") });

  await page.getByRole("button", { name: "Close", exact: true }).first().click({ timeout: 30000 });
  await page.waitForTimeout(1200);

  // 2. Bare project - every section should say so out loud.
  await openExportFor("harbour-notes");
  const bareText = await page.locator("pre").first().innerText();
  log("--- harbour-notes block ---");
  log(bareText.slice(0, 600));
  await page.screenshot({ path: path.join(shots, "export-bare.png") });

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
  console.error("[ctx] FAILED:", e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
