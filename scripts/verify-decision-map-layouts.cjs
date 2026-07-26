/**
 * Checks the Decision Record card list purely at the rendering layer -
 * renderDecisionMapHtml is a pure function of a DecisionRecordResult, so this
 * feeds it synthetic data directly and opens the resulting static HTML in a
 * plain headless Chromium (no Electron, no IPC, no real headless `claude -p`
 * call needed at all). Rewritten for the card-list rebuild - the old
 * Tree/Sessions/Intent-Lanes SVG graph this script used to check no longer
 * exists (Decision Map became Decision Record: cards, not nodes and edges).
 */
const { chromium } = require("playwright-core");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const repoRoot = path.resolve(__dirname, "..");
const { renderDecisionMapHtml } = require(path.join(repoRoot, "dist/main/decisionMap.js"));

const decision = (id, chose, over, because, extra = {}) => ({
  id,
  chose,
  over,
  because,
  evidence: [{ source: "log", ref: "PROJECT_LOG.md#2026-07-23", anchor: because }],
  servesIntent: null,
  reversible: null,
  collapsed: 1,
  supersedes: null,
  date: "2026-07-23",
  ...extra
});

const populatedResult = {
  generatedAt: new Date().toISOString(),
  coverage: {
    totalDecisions: 3,
    fromLogs: 2,
    fromTranscript: 1,
    hasProjectLogs: true,
    logsDateRange: { earliest: "2026-07-20", latest: "2026-07-23" },
    transcriptDateRange: { earliest: "2026-07-22", latest: "2026-07-23" },
    transcriptCoveragePartial: false,
    extractionError: null
  },
  decisions: [
    decision(
      "decision-0",
      "Include-list of standings-relevant game-type prefixes",
      "Ever-growing exclude-list",
      "Preseason games carry real franchise IDs and were silently distorting win/loss records.",
      { servesIntent: null, supersedes: "decision-1" }
    ),
    decision(
      "decision-1",
      "Exclude-list (003 only)",
      "No game-type filter",
      "All-Star exhibition rosters aren't real teams.",
      { date: "2026-07-20" }
    ),
    decision(
      "decision-2",
      "Retrospective correlation only",
      "A predictive model applied to live games",
      "The Intent Ledger's never-do line rules out forecasting.",
      {
        servesIntent: "neverDo",
        collapsed: 1,
        evidence: [{ source: "transcript", ref: "d4ce9440-ec0b-412a-b996-2eb9fb643be0", anchor: "retrospective attribution only" }],
        date: "2026-07-23"
      }
    )
  ]
};

const emptyResult = {
  generatedAt: new Date().toISOString(),
  coverage: {
    totalDecisions: 0,
    fromLogs: 0,
    fromTranscript: 0,
    hasProjectLogs: false,
    logsDateRange: null,
    transcriptDateRange: null,
    transcriptCoveragePartial: false,
    extractionError: null
  },
  decisions: []
};

const writeHtml = (result) => {
  const html = renderDecisionMapHtml(result, "Test Project");
  const htmlPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "starship-decision-record-html-")),
    "record.html"
  );
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
};

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // Empty state: honest, not a blank void.
    await page.goto("file://" + writeHtml(emptyResult).replace(/\\/g, "/"));
    const emptyText = await page.locator(".empty").innerText();
    if (!emptyText.toLowerCase().includes("no decisions captured")) {
      throw new Error("Empty state didn't read as honest emptiness: " + emptyText);
    }
    const emptyMeta = await page.locator(".meta").innerText();
    if (!emptyMeta.includes("No project logs found")) {
      throw new Error("Empty-state coverage header didn't disclose the missing logs: " + emptyMeta);
    }
    console.log("✅ Empty state: honest zero-decisions message and coverage disclosure.");

    // Populated state: card list across all three view modes.
    await page.goto("file://" + writeHtml(populatedResult).replace(/\\/g, "/"));
    await page.locator(".card").first().waitFor({ timeout: 5000 });

    for (const mode of ["recent", "sessions", "intent"]) {
      await page.locator('button[data-mode="' + mode + '"]').click();
      await page.waitForTimeout(100);
      const cardCount = await page.locator(".card").count();
      if (cardCount !== populatedResult.decisions.length) {
        throw new Error(mode + ": expected " + populatedResult.decisions.length + " cards, got " + cardCount);
      }
      console.log("✅ " + mode + ": " + cardCount + " cards rendered.");
    }

    // Card spec: chose/over/because present, plus a tag and a supersedes note.
    await page.locator('button[data-mode="recent"]').click();
    const firstCardText = await page.locator(".card").first().innerText();
    if (!firstCardText.includes("Include-list of standings-relevant game-type prefixes")) {
      throw new Error("First card missing expected 'chose' text: " + firstCardText);
    }
    if (!firstCardText.includes("instead of Ever-growing exclude-list")) {
      throw new Error("First card missing 'instead of <over>' line: " + firstCardText);
    }
    if (!firstCardText.includes("Supersedes: Exclude-list (003 only)")) {
      throw new Error("First card missing its supersedes note: " + firstCardText);
    }
    console.log("✅ Card spec: chose / instead-of-over / because / supersedes all present.");

    // .tag has text-transform: uppercase, so innerText() (which reflects
    // rendered text) returns "NEVER DO" even though the DOM text is "Never
    // Do" - compare case-insensitively rather than asserting rendered case.
    const neverDoTag = await page.locator(".tag.intent").innerText();
    if (neverDoTag.trim().toLowerCase() !== "never do") {
      throw new Error("Expected a 'Never Do' intent tag, got: " + neverDoTag);
    }
    console.log("✅ Intent tag renders for the neverDo-tagged decision.");

    // Click-to-expand: evidence anchor shows in the detail panel.
    await page.locator('.card[data-id="decision-2"]').click();
    const detailText = await page.locator("#detail").innerText();
    if (!detailText.includes("retrospective attribution only")) {
      throw new Error("Detail panel didn't show the clicked card's evidence anchor: " + detailText);
    }
    console.log("✅ Clicking a card reveals its verbatim evidence anchor.");

    // Coverage header discloses source split and date ranges.
    const metaText = await page.locator(".meta").innerText();
    if (!metaText.includes("3 decisions") || !metaText.includes("2 from this project's own logs")) {
      throw new Error("Coverage header missing expected decision/source counts: " + metaText);
    }
    console.log("✅ Coverage header discloses decision count and log-vs-transcript split.");

    const screenshotPath = path.join(os.tmpdir(), "starship-decision-record.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log("   screenshot: " + screenshotPath);

    if (consoleErrors.length > 0) {
      throw new Error("Console errors during render:\n" + consoleErrors.join("\n"));
    }
    console.log("✅ No console errors.");

    console.log("\nAll checks passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
