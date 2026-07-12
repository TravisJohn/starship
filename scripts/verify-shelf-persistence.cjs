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

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "starship-shelf-"));
  const projectPath = path.join(tempRoot, "Project With Spaces");
  const dbPath = path.join(tempRoot, "starship.sqlite");
  fs.mkdirSync(projectPath);

  let app = await launchApp(dbPath);

  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Add Project" }).waitFor({
      timeout: 10000
    });
    await app.evaluate(
      ({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selectedPath]
        });
      },
      projectPath
    );

    await page.getByRole("button", { name: "Add Project" }).click();
    await page
      .getByRole("heading", { name: "Project With Spaces" })
      .waitFor({ timeout: 10000 });
  } finally {
    await app.close();
  }

  app = await launchApp(dbPath);

  try {
    const page = await app.firstWindow();
    await page
      .getByRole("heading", { name: "Project With Spaces" })
      .waitFor({ timeout: 10000 });
    await page.getByText(projectPath).waitFor({ timeout: 10000 });
    console.log("Project shelf persistence verified across restart.");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
