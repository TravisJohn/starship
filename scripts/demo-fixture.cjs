/**
 * Builds a rich, entirely synthetic demo fixture and screenshots the real app
 * against it. Run it with `npm run demo:fixture`; the images land in
 * `acceptance-output/screenshots/` and are what the README's screenshots are
 * regenerated from after a UI change.
 *
 * Nothing here touches real data. USERPROFILE is redirected to a throwaway
 * home (see STARSHIP_DEMO_HOME below), so `os.homedir()` - and therefore
 * `~/.claude/projects` - lands there instead. Every project, transcript and
 * Intent Ledger below is invented, so no real session, project name or path
 * can appear in a screenshot.
 *
 * No model call is possible: the projects are freshly created directories, and
 * every feature this drives (Intent Ledger, Initial Plan, the panel toggles)
 * reads local data only.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");

const repoRoot = path.resolve(__dirname, "..");

/*
 * The fixture deliberately lives at a short, generic path rather than inside
 * the repo. Every project row in the app shows its own directory, so the
 * fixture's location ends up printed across each screenshot - and
 * `D:\WEB PROJECTS\starship\acceptance-output\...` puts one machine's disk
 * layout into a public README. `C:\starship\Projects\tide-atlas` reads as an
 * example instead of as somebody's hard drive.
 *
 * Override with STARSHIP_DEMO_HOME if that path is unavailable or unwanted.
 */
const defaultDemoHome =
  process.platform === "win32"
    ? path.join("C:\\", "starship")
    : path.join(os.homedir(), "starship-demo");
const demoHome = process.env.STARSHIP_DEMO_HOME || defaultDemoHome;
const demoRoot = path.join(demoHome, "Projects");
const claudeProjects = path.join(demoHome, ".claude", "projects");

// Build products, not sources - acceptance-output/ is already gitignored.
const outputRoot = path.join(repoRoot, "acceptance-output");
const shots = path.join(outputRoot, "screenshots");
const dbPath = path.join(outputRoot, `demo-fixture-${Date.now()}.sqlite`);

const log = (...a) => console.log("[fixture]", ...a);
const slug = (p) => path.resolve(p).replace(/[^a-zA-Z0-9]/g, "-");
const day = (n) => Date.now() - n * 24 * 60 * 60 * 1000;

const INITIAL_PLAN = `I've read the PRD and the Intent Ledger. Here's my proposed Phase 1, sequenced so the riskiest assumption is tested first rather than last.

## Phase 1 — prove the tide model before building anything around it

1. **Ingest one station's raw harmonic constituents.** No UI, no storage layer. Just parse the published constants for a single station and print a predicted curve.
2. **Validate against a known day.** Compare the prediction to a published tide table for a date already past. This is the step that decides whether the whole project is viable.
3. **Persist stations and predictions.** Only once step 2 agrees within tolerance.
4. **A single-screen readout.** Today's highs and lows for one saved station.

Steps 1 and 2 must complete before 3 and 4 are worth starting — they share no code, but 3 and 4 are wasted effort if the model is wrong.

## Largest risk

The harmonic constants are published per-station and their quality varies. If the station you care about has poor constants, the prediction will be confidently wrong rather than obviously broken — which is the worst failure mode for something people plan a drive around. Step 2 exists specifically to surface that before it's buried under a UI.

**Tradeoff I'm taking, per your ledger:** single-region scope means I'm hardcoding one datum and one timezone rather than building a general model. That's the right call for now, but it will need real work if you ever add a second coastline.

Want me to start on step 1, or would you rather look at the validation approach first?`;

const projects = [
  {
    name: "tide-atlas",
    oneLiner:
      "A local-first tide and swell almanac for a single stretch of coastline, built to answer 'is it worth the drive' in one glance.",
    logHeading: "2026-08-09 — Validation before UI",
    logBody:
      "Reordered Phase 1 so the harmonic model is validated against a published tide table before any storage or screen work. A wrong prediction that looks right is the failure mode worth paying to avoid.",
    files: 26,
    activity: [0, 1, 1, 2, 4, 5],
    plan: INITIAL_PLAN,
    intent: {
      purpose:
        "So I stop driving 40 minutes to a beach that turned out to be blown out. The forecast sites all optimise for surfers on a different coast.",
      successCriteria:
        "I check it instead of three other sites for a whole season, and it is right often enough that I trust it when it says don't bother.",
      acceptedTradeoffs:
        "One coastline only. No accounts, no sharing, no mobile app. I would rather it be exactly right about one place than vague about everywhere.",
      neverDo:
        "Never become a general weather product, and never show a prediction it cannot justify from the underlying constants."
    },
    notes: [
      ["Harmonic constants parse cleanly for the primary station", "verified"],
      ["Prediction matches the published table within 6 minutes", "verified"],
      ["Station switcher", "tested"],
      ["Swell overlay", "implemented"]
    ]
  },
  {
    name: "ledger-lantern",
    oneLiner:
      "Reads a year of bank exports and explains where the money actually went, in categories the user defines rather than a vendor's.",
    logHeading: "2026-08-06 — Categories are user-owned",
    logBody:
      "Rejected auto-categorisation as the primary path. It is confidently wrong often enough to destroy trust in the entire summary, and a summary you do not trust is worth less than no summary.",
    files: 18,
    activity: [0, 2, 3, 6],
    intent: {
      purpose:
        "Because every budgeting app wants to own the categories, and the categories are the only part that carries any judgement.",
      successCriteria:
        "I can answer 'where did the money go last year' in under a minute, in words I chose.",
      acceptedTradeoffs:
        "Manual category rules. No bank API integration - CSV export is fine and does not need anyone's permission.",
      neverDo: "Never upload a statement anywhere. It reads local files and stays local."
    },
    notes: [
      ["Rule engine handles overlapping matches", "tested"],
      ["Year-over-year comparison", "implemented"],
      ["CSV dialect detection", "fresh"]
    ]
  },
  {
    name: "quiet-hours",
    oneLiner:
      "Blocks notifications on a schedule the user actually keeps, learned from when they historically dismissed things unread.",
    logHeading: "2026-08-02 — Learning, not configuring",
    logBody:
      "Decided against a settings screen for the schedule. If the user has to maintain it, they will stop maintaining it, and a stale schedule is worse than none.",
    files: 12,
    activity: [1, 3, 3],
    intent: {
      purpose: "I keep configuring do-not-disturb and then never updating it.",
      successCriteria: "It gets quiet at the right times without me telling it when those are.",
      acceptedTradeoffs: "",
      neverDo: "Never silence anything the user has explicitly marked urgent."
    },
    notes: [
      ["Dismissal history clustering", "implemented"],
      ["Override for marked-urgent senders", "tested"]
    ]
  },
  {
    name: "paper-trail",
    oneLiner:
      "Turns a folder of scanned receipts into a searchable, itemised record without sending a single image to a third party.",
    logHeading: "2026-07-28 — Local OCR only",
    logBody:
      "Accepted materially worse accuracy in exchange for nothing leaving the machine. Revisit only if local accuracy makes the whole thing useless in practice.",
    files: 31,
    activity: [4, 5, 6, 6],
    intent: {
      purpose: "Tax time takes a weekend and it should take an hour.",
      successCriteria: "A year of receipts becomes a searchable table I can hand to an accountant.",
      acceptedTradeoffs: "Local OCR is worse than cloud OCR. That is the price of the images never leaving.",
      neverDo: "Never send a receipt image off this machine."
    },
    notes: [
      ["Local OCR pipeline", "verified"],
      ["Itemised line extraction", "verified"],
      ["Search index", "verified"]
    ]
  },
  {
    name: "sketchbook-cli",
    oneLiner: "A terminal scratchpad that keeps every throwaway snippet searchable instead of lost.",
    logHeading: "2026-07-25 — Append-only by design",
    logBody: "No edit or delete. The whole value is that nothing gets tidied away and then wanted later.",
    files: 8,
    activity: [5],
    notes: [["Fuzzy search across snippets", "fresh"]]
  },
  {
    name: "harbour-notes",
    oneLiner: "",
    logHeading: "",
    logBody: "",
    files: 3,
    activity: []
  },
  {
    name: "fern-tracker",
    oneLiner: "Photo log for the plants, with a watering interval learned from how they actually behave.",
    logHeading: "",
    logBody: "",
    files: 5,
    activity: []
  },
  {
    name: "archive-2019",
    oneLiner: "Retired. Kept only so the old exports remain readable.",
    logHeading: "",
    logBody: "",
    files: 14,
    activity: [],
    ignored: true
  }
];

const writeTranscript = (projectPath, index, ageDays, planText) => {
  const dir = path.join(claudeProjects, slug(projectPath));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `session-${index}.jsonl`);
  const ts = new Date(day(ageDays)).toISOString();
  const lines = [
    JSON.stringify({ type: "system", subtype: "init", cwd: projectPath, sessionId: `demo-${index}`, version: "2.0.1", timestamp: ts }),
    JSON.stringify({ type: "user", cwd: projectPath, message: { role: "user", content: [{ type: "text", text: "Read the PRD and propose Phase 1." }] }, timestamp: ts })
  ];
  if (planText) {
    lines.push(
      JSON.stringify({ type: "assistant", cwd: projectPath, message: { role: "assistant", content: [{ type: "text", text: planText }] }, timestamp: ts })
    );
  } else {
    lines.push(
      JSON.stringify({ type: "assistant", cwd: projectPath, message: { role: "assistant", content: [{ type: "text", text: "Starting on the ingest step now." }] }, timestamp: ts })
    );
  }
  fs.writeFileSync(file, lines.join("\n") + "\n");
  const when = new Date(day(ageDays));
  fs.utimesSync(file, when, when);
};

const setup = () => {
  fs.rmSync(demoHome, { recursive: true, force: true });
  fs.mkdirSync(demoRoot, { recursive: true });
  fs.mkdirSync(claudeProjects, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  // Chromium resolves cache/profile paths from the Windows profile layout, so
  // a bare directory as USERPROFILE crashes the process before it prints
  // anything. Give the scratch home a complete profile instead.
  for (const d of ["AppData/Roaming", "AppData/Local", "AppData/LocalLow", "Documents", "Desktop", "Downloads"]) {
    fs.mkdirSync(path.join(demoHome, d), { recursive: true });
  }

  for (const p of projects) {
    const dir = path.join(demoRoot, p.name);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });

    if (p.oneLiner) {
      fs.writeFileSync(
        path.join(dir, "PRD.md"),
        `# ${p.name} — PRD\n\n## 1. One-liner\n\n${p.oneLiner}\n\n---\n\n## 2. Goals\n\nTo be expanded.\n`
      );
    }
    if (p.logHeading) {
      fs.writeFileSync(
        path.join(dir, "PROJECT_LOG.md"),
        `# Project Log\n\n## ${p.logHeading}\n\n${p.logBody}\n`
      );
    }
    for (let i = 0; i < p.files; i += 1) {
      fs.writeFileSync(
        path.join(dir, "src", `module-${i}.ts`),
        `// ${p.name} module ${i}\n${"export const noop = () => undefined;\n".repeat(20)}`
      );
    }

    // The plan belongs on the OLDEST transcript - getInitialPlanForProject
    // reads the first session, not the most recent one.
    const oldest = Math.max(...(p.activity || [0]));
    (p.activity || []).forEach((ageDays, i) => {
      writeTranscript(dir, i, ageDays, ageDays === oldest ? p.plan : null);
    });
  }
  log(`built ${projects.length} demo projects under ${demoRoot}`);
};

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  log(`shot -> ${name}.png`);
};

(async () => {
  setup();

  const app = await electron.launch({
    executablePath: electronPath,
    args: [repoRoot],
    cwd: repoRoot,
    env: {
      ...process.env,
      // os.homedir() honours USERPROFILE on Windows, which is what redirects
      // ~/.claude/projects into the scratch home. APPDATA/LOCALAPPDATA move
      // with it so Chromium and Electron get a coherent profile rather than a
      // half-redirected one.
      USERPROFILE: demoHome,
      APPDATA: path.join(demoHome, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(demoHome, "AppData", "Local"),
      STARSHIP_DB_PATH: dbPath
    }
  });

  const page = await app.firstWindow();
  page.on("pageerror", (e) => log("PAGEERROR:", e.message));
  await page.waitForLoadState("domcontentloaded");

  await app.evaluate(({ dialog }, rootPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [rootPath] });
  }, demoRoot);

  await page.getByRole("button", { name: "Locate Root" }).click({ timeout: 90000 });
  await page.waitForTimeout(7000);

  // Seed intent ledgers, notes and the ignored flag through the app's own IPC.
  const seed = projects.map((p) => ({
    name: p.name,
    intent: p.intent || null,
    notes: p.notes || [],
    ignored: Boolean(p.ignored)
  }));

  const seeded = await page.evaluate(async (rows) => {
    const state = await window.starship.dashboard.getState();
    const byName = new Map(state.projects.map((p) => [p.name, p]));
    const done = [];
    for (const row of rows) {
      const project = byName.get(row.name);
      if (!project) continue;
      if (row.intent) {
        await window.starship.intent.saveLedger({ projectId: project.id, ...row.intent });
      }
      for (const [text, status] of row.notes) {
        const note = await window.starship.notes.add({
          projectId: project.id,
          text,
          content: text
        });
        if (status !== "fresh") {
          await window.starship.notes.setStatus({ noteId: note.id, status });
        }
      }
      if (row.ignored) {
        await window.starship.dashboard.setIgnored({ projectPath: project.path, ignored: true });
      }
      done.push(row.name);
    }
    return done;
  }, seed);
  log("seeded:", seeded.join(", "));

  await page.getByRole("button", { name: "Rescan" }).click({ timeout: 90000 });
  await page.waitForTimeout(6000);

  // Select the richest project first so the detail panel reads well in the
  // headline screenshot.
  const row = page.getByRole("button", { name: /^tide-atlas/ }).first();
  if (await row.count()) {
    await row.click({ timeout: 30000 });
    await page.waitForTimeout(1200);
    // Clicking a row scrolls it into view, which pushes the stat tiles off
    // screen. Scroll back to the top for the headline shot.
    await page.mouse.move(600, 500);
    await page.mouse.wheel(0, -3000);
    await page.waitForTimeout(1200);
  }
  await shot(page, "dashboard");

  // Initial Plan, now with real captured content.
  await page.getByRole("button", { name: "Initial Plan", exact: true }).click({ timeout: 30000 });
  await page.waitForTimeout(3000);
  await shot(page, "initial-plan");
  const planText = await page.innerText("body");
  log("initial plan rendered:", planText.includes("prove the tide model"));
  await page.getByRole("button", { name: "Close", exact: true }).first().click({ timeout: 30000 });
  await page.waitForTimeout(1500);

  // Intent Ledger, populated.
  await page.getByRole("button", { name: "Intent", exact: true }).click({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot(page, "intent-ledger");
  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click({ timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.getByRole("button", { name: "Hide Details", exact: true }).click({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot(page, "dashboard-wide");

  fs.writeFileSync(path.join(shots, "page-text.txt"), await page.innerText("body"));
  await app.close();

  /*
   * Best effort only. Windows can hold the Electron profile open for a moment
   * after close, and a failure here costs nothing - the next run removes the
   * directory before rebuilding it anyway. Worth attempting because the
   * default sits at the root of the system drive.
   */
  try {
    fs.rmSync(demoHome, { recursive: true, force: true });
    log(`removed fixture at ${demoHome}`);
  } catch {
    log(`fixture left at ${demoHome} (still locked); it is rebuilt on the next run`);
  }

  log(`screenshots in ${shots}`);
  log("done");
})().catch((e) => {
  console.error("[fixture] FAILED:", e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
