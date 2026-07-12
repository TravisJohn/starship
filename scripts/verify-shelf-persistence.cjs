const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const launchApp = (dbPath) =>
  electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      STARSHIP_DB_PATH: dbPath
    }
  });

const projectRow = (page) =>
  page.locator("tbody tr").filter({ hasText: "Project With Spaces" });

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "starship-dashboard-"));
  const projectPath = path.join(tempRoot, "Project With Spaces");
  const dbPath = path.join(tempRoot, "starship.sqlite");
  fs.mkdirSync(projectPath);

  let app = await launchApp(dbPath);

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
    await projectRow(page).waitFor({ timeout: 10000 });
  } finally {
    await app.close();
  }

  app = await launchApp(dbPath);

  try {
    const page = await app.firstWindow();
    await projectRow(page).waitFor({ timeout: 10000 });
    await page.getByText(projectPath).waitFor({ timeout: 10000 });
    console.log("Mission dashboard root discovery verified across restart.");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
