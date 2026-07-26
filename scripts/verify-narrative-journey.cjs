/**
 * E2E check for the Narrative Journey Dashboard button/overlay: opens it for
 * a freshly-created, never-used project so it hits the "no session history
 * yet" empty state - no real headless `claude -p` call triggered. The
 * headless-call logic (prompt construction, chapter parsing, fallback on
 * failure) is covered instead by narrativeJourney.test.ts's mocked-headless
 * unit tests.
 */
const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const repoRoot = path.resolve(__dirname, "..");

(async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-verify-db-"));
  const dbPath = path.join(dbDir, "starship.sqlite");

  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "starship-verify-root-"));
  fs.mkdirSync(path.join(scratchRoot, "fresh-project"));

  const app = await electron.launch({
    executablePath: electronPath,
    args: [repoRoot],
    cwd: repoRoot,
    env: { ...process.env, STARSHIP_DB_PATH: dbPath }
  });

  try {
    const page = await app.firstWindow();

    await app.evaluate(({ dialog }, rootPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [rootPath] });
    }, scratchRoot);

    await page.getByRole("button", { name: "Locate Root" }).click({ timeout: 60000 });

    const row = page.locator("tr", { hasText: "fresh-project" }).first();
    await row.waitFor({ timeout: 15000 });
    await row.getByRole("button", { name: "Narrative Journey" }).click();

    await page.getByRole("dialog", { name: "fresh-project" }).waitFor({ timeout: 5000 });
    console.log("✅ Narrative Journey overlay opened from the Dashboard button.");

    await page.getByText("Nothing to tell yet").waitFor({ timeout: 10000 });
    console.log("✅ Empty-state message rendered (no session history yet).");

    const downloadButton = page.getByRole("button", { name: "Download" });
    await downloadButton.waitFor({ timeout: 5000 });
    const isDisabled = await downloadButton.isDisabled();
    if (!isDisabled) {
      throw new Error("Download button should be disabled with no chapters to save");
    }
    console.log("✅ Download button correctly disabled with nothing to save.");

    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("dialog", { name: "fresh-project" }).waitFor({ state: "hidden", timeout: 5000 });
    console.log("✅ Overlay closes.");

    console.log("\nAll checks passed.");
  } finally {
    await app.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
