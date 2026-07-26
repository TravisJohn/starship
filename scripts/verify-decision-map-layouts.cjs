/**
 * Checks the three switchable Decision Map layouts (Tree/Sessions/Intent
 * Lanes) purely at the rendering layer - renderDecisionMapHtml is a pure
 * function of (nodes, edges), so this feeds it synthetic data directly and
 * opens the resulting static HTML in a plain headless Chromium (no
 * Electron, no IPC, no real headless `claude -p` call needed at all).
 */
const { chromium } = require("playwright-core");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const repoRoot = path.resolve(__dirname, "..");
const { renderDecisionMapHtml } = require(path.join(repoRoot, "dist/main/decisionMap.js"));

const node = (id, label, servesIntent, sessionIndex) => ({ id, label, servesIntent, sessionIndex });

// A small graph with branching (D1 -> D2, D1 -> D3) and a merge (D2, D3 -> D4)
// across two sessions, so all three layouts have something real to show.
const result = {
  generatedAt: new Date().toISOString(),
  nodes: [
    node("decision-0", "Set up the board module", "successCriteria", 0),
    node("decision-1", "Add scoring", "successCriteria", 0),
    node("decision-2", "Add turn timer", "acceptedTradeoffs", 0),
    node("decision-3", "Wire scoring and timer into game loop", "purpose", 1),
    node("decision-4", "Add restart button", "none", 1)
  ],
  edges: [
    { from: "decision-0", to: "decision-1", reason: "Scoring needs the board to exist first." },
    { from: "decision-0", to: "decision-2", reason: "Timer also depends on the board being in place." },
    { from: "decision-1", to: "decision-3", reason: "Game loop wires up scoring once it exists." },
    { from: "decision-2", to: "decision-3", reason: "Game loop wires up the timer once it exists." }
  ]
};

(async () => {
  const html = renderDecisionMapHtml(result, "Test Project");
  const htmlPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "starship-decision-map-html-")), "map.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("file://" + htmlPath.replace(/\\/g, "/"));
    await page.locator("svg").waitFor({ timeout: 5000 });

    for (const mode of ["tree", "sessions", "intent"]) {
      await page.locator('button[data-mode="' + mode + '"]').click();
      await page.waitForTimeout(150);

      const nodeCount = await page.locator(".node").count();
      const edgeCount = await page.locator(".edge").count();
      if (nodeCount !== result.nodes.length) {
        throw new Error(mode + ": expected " + result.nodes.length + " nodes, got " + nodeCount);
      }
      if (edgeCount !== result.edges.length) {
        throw new Error(mode + ": expected " + result.edges.length + " edges, got " + edgeCount);
      }

      const svgBox = await page.locator("svg").boundingBox();
      const stageBox = await page.locator(".stage").boundingBox();
      const svgCenterX = svgBox.x + svgBox.width / 2;
      const stageCenterX = stageBox.x + stageBox.width / 2;
      const centeringDrift = Math.abs(svgCenterX - stageCenterX);
      console.log(
        "✅ " + mode + ": " + nodeCount + " nodes, " + edgeCount + " edges, " +
        "svg width " + Math.round(svgBox.width) + " vs stage width " + Math.round(stageBox.width) +
        ", center drift " + Math.round(centeringDrift) + "px"
      );

      const screenshotPath = path.join(os.tmpdir(), "starship-decision-map-" + mode + ".png");
      await page.screenshot({ path: screenshotPath });
      console.log("   screenshot: " + screenshotPath);
    }

    // Sessions/Intent Lanes overflow the 1100px viewport (each decision
    // gets its own global column) - Fit to Screen should eliminate that
    // scroll entirely by shrinking the whole graph to fit.
    await page.locator('button[data-mode="sessions"]').click();
    const scrollableBefore = await page.locator(".stage").evaluate((el) => el.scrollWidth > el.clientWidth);
    if (!scrollableBefore) {
      throw new Error("Expected Sessions layout to overflow before Fit to Screen is enabled");
    }

    await page.locator("#fit-toggle").click();
    await page.waitForTimeout(150);
    const overflowsAfterFit = await page.locator(".stage").evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
    );
    if (overflowsAfterFit) {
      throw new Error("Fit to Screen still leaves the stage scrollable");
    }
    const fitNodeCount = await page.locator(".node").count();
    if (fitNodeCount !== result.nodes.length) {
      throw new Error("Fit to Screen lost nodes: expected " + result.nodes.length + ", got " + fitNodeCount);
    }
    console.log("✅ Fit to Screen eliminates scrolling for the wide Sessions layout, all nodes still present.");

    const fitScreenshotPath = path.join(os.tmpdir(), "starship-decision-map-fit-sessions.png");
    await page.screenshot({ path: fitScreenshotPath });
    console.log("   screenshot: " + fitScreenshotPath);

    await page.locator("#fit-toggle").click();
    await page.waitForTimeout(150);
    const backToScrollable = await page.locator(".stage").evaluate((el) => el.scrollWidth > el.clientWidth);
    if (!backToScrollable) {
      throw new Error("Toggling Fit to Screen off again should restore the scrollable full-size layout");
    }
    console.log("✅ Toggling Fit to Screen off restores the original scrollable layout.");

    // Click a node and confirm the detail panel updates with its edges.
    await page.locator('[data-id="decision-3"]').click();
    const detailText = await page.locator("#detail").innerText();
    if (!detailText.includes("Wire scoring and timer into game loop")) {
      throw new Error("Detail panel didn't update on node click: " + detailText);
    }
    if (!detailText.includes("Game loop wires up scoring") || !detailText.includes("Game loop wires up the timer")) {
      throw new Error("Detail panel missing expected incoming-edge reasons: " + detailText);
    }
    console.log("✅ Clicking a merge node (two incoming edges) shows both reasons in the detail panel.");

    if (consoleErrors.length > 0) {
      throw new Error("Console errors during render:\n" + consoleErrors.join("\n"));
    }
    console.log("✅ No console errors across all three layouts.");

    console.log("\nAll checks passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
