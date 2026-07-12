const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const waitForTerminalText = async (page, expected, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";

  while (Date.now() < deadline) {
    lastText = await page
      .locator(".xterm")
      .innerText({ timeout: 1000 })
      .catch(() => "");

    if (lastText.includes(expected)) {
      return;
    }

    await page.waitForTimeout(250);
  }

  throw new Error(
    `Timed out waiting for terminal text "${expected}". Last text: ${lastText}`
  );
};

(async () => {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: root
  });

  try {
    const page = await app.firstWindow();
    await page.locator(".xterm").waitFor({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.locator(".xterm").click();

    await page.keyboard.type("Write-Host STARSHIP_T3_BEFORE -ForegroundColor Green");
    await page.keyboard.press("Enter");
    await waitForTerminalText(page, "STARSHIP_T3_BEFORE");

    const window = await app.browserWindow(page);
    await window.evaluate((browserWindow) => {
      browserWindow.setSize(950, 620);
    });
    await page.waitForTimeout(600);

    await page.keyboard.type("Write-Host STARSHIP_T3_AFTER");
    await page.keyboard.press("Enter");
    await waitForTerminalText(page, "STARSHIP_T3_AFTER");

    console.log("PowerShell terminal verified before and after resize.");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
