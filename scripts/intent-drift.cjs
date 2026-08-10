#!/usr/bin/env node
"use strict";

/**
 * Intent Ledger drift diagnostic — READ ONLY.
 *
 * Editing a project's Intent Ledger in Starship updates the `intent_ledger`
 * row (which feeds every headless prompt) but never rewrites the project's
 * PRD.md §2 (the human-facing doc). This script measures how far apart the two
 * have drifted, per project and per field. It never writes, and never proposes
 * a sync — it only reports numbers.
 *
 * Run it via `npm run intent:drift` (see the ABI note in loadDatabase below).
 *
 *   npm run intent:drift
 *   npm run intent:drift -- --project starship --verbose
 *   npm run intent:drift -- --db "C:\\path\\to\\starship.sqlite" --json
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Ledger column -> the PRD.md §2 bold label that carries the same value. */
const FIELDS = [
  { key: "purpose", column: "purpose", label: "purpose", prdLabel: "why this exists" },
  {
    key: "successCriteria",
    column: "success_criteria",
    label: "successCriteria",
    prdLabel: "what success looks like"
  },
  {
    key: "acceptedTradeoffs",
    column: "accepted_tradeoffs",
    label: "acceptedTradeoffs",
    prdLabel: "tradeoffs accepted"
  },
  { key: "neverDo", column: "never_do", label: "neverDo", prdLabel: "this project must never" }
];

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const dbPath = resolveDbPath(options.db);
  if (!fs.existsSync(dbPath)) {
    fail(
      `No Starship database at:\n  ${dbPath}\n\n` +
        "Pass --db <path> if yours lives elsewhere, or set STARSHIP_DB_PATH."
    );
  }

  const db = loadDatabase(dbPath);
  try {
    const rows = readProjects(db, options.project);
    if (rows.length === 0) {
      fail(
        options.project
          ? `No project matched "${options.project}".`
          : "No projects found in the database."
      );
    }

    const reports = rows.map(buildProjectReport);

    if (options.json) {
      process.stdout.write(`${JSON.stringify({ dbPath, projects: reports }, null, 2)}\n`);
      return;
    }

    printReports(reports, { dbPath, verbose: options.verbose });
  } finally {
    db.close();
  }
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const parseArgs = (argv) => {
  const options = { db: null, project: null, json: false, verbose: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--verbose" || arg === "-v") options.verbose = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--db") options.db = argv[++index] ?? null;
    else if (arg === "--project" || arg === "-p") options.project = argv[++index] ?? null;
    else if (arg.startsWith("--db=")) options.db = arg.slice(5);
    else if (arg.startsWith("--project=")) options.project = arg.slice(10);
    else fail(`Unknown argument: ${arg}\nRun with --help for usage.`);
  }

  return options;
};

/** Mirrors createStarshipDb()'s resolution so we read the same file the app writes. */
const resolveDbPath = (override) => {
  if (override) return path.resolve(override);
  if (process.env.STARSHIP_DB_PATH) return path.resolve(process.env.STARSHIP_DB_PATH);
  return path.join(userDataDir(), "starship", "starship.sqlite");
};

const userDataDir = () => {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
};

/**
 * better-sqlite3 is rebuilt against Electron's ABI by the postinstall hook, so
 * plain `node scripts/intent-drift.cjs` throws NODE_MODULE_VERSION. The npm
 * script runs us under Electron-as-Node instead; catch the mismatch and say so.
 */
const loadDatabase = (dbPath) => {
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/NODE_MODULE_VERSION|was compiled against/i.test(detail)) {
      fail(
        "better-sqlite3 is built for Electron's ABI, not plain Node.\n" +
          "Run this through the npm script instead:\n\n  npm run intent:drift\n"
      );
    }
    fail(`Could not load better-sqlite3:\n${detail}`);
  }

  try {
    // readonly + fileMustExist: this diagnostic must never create or alter state.
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error) {
    fail(`Could not open the database read-only:\n${error instanceof Error ? error.message : error}`);
  }
};

const readProjects = (db, filter) => {
  const rows = db
    .prepare(
      `select p.id, p.name, p.path,
              l.purpose, l.success_criteria, l.accepted_tradeoffs, l.never_do,
              l.updated_at as ledger_updated_at
         from projects p
         left join intent_ledger l on l.project_id = p.id
        order by p.name collate nocase`
    )
    .all();

  if (!filter) return rows;

  const needle = filter.toLowerCase();
  return rows.filter(
    (row) => row.id.toLowerCase() === needle || row.name.toLowerCase().includes(needle)
  );
};

// ---------------------------------------------------------------------------
// PRD.md §2 parsing
// ---------------------------------------------------------------------------

/**
 * A heading that *is* the Intent Ledger section, allowing hand-renumbering
 * ("## 2." / "## 2)") and a trailing qualifier. Deliberately anchored after the
 * optional number: a heading that merely mentions the ledger further along,
 * such as "### Phase 2 — Inception & the Intent Ledger", is a cross-reference,
 * not the section, and matching it yields a bogus empty parse.
 */
const isIntentLedgerHeading = (line) =>
  /^#{1,6}\s*(?:\d+[.)]\s*)?intent ledger\b/i.test(line);

/**
 * Pulls the Intent Ledger section out of a PRD and splits it into
 * `{ normalizedLabel: value }`. Tolerant of renumbering and reworded labels,
 * but not of cross-references — see isIntentLedgerHeading.
 */
const parseIntentSection = (markdown) => {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(isIntentLedgerHeading);
  if (start === -1) return null;

  const headingDepth = (lines[start].match(/^#+/) ?? ["##"])[0].length;
  const values = {};
  let current = null;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];

    // Stop at the next heading of the same or shallower depth.
    const heading = line.match(/^(#+)\s/);
    if (heading && heading[1].length <= headingDepth) break;

    // A bold run at the start of a line begins a new field; any trailing text
    // on that same line is the first line of its value.
    const labelMatch = line.match(/^\s*\*\*(.+?):?\*\*\s*(.*)$/);
    if (labelMatch) {
      current = normalizeLabel(labelMatch[1]);
      values[current] = labelMatch[2] ? [labelMatch[2]] : [];
      continue;
    }

    if (current) values[current].push(line);
  }

  const collapsed = {};
  for (const [label, buffer] of Object.entries(values)) {
    collapsed[label] = buffer.join("\n").trim();
  }
  return collapsed;
};

const normalizeLabel = (label) =>
  label
    .replace(/\*/g, "")
    .replace(/[:：]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const findPrdValue = (section, prdLabel) => {
  const entry = Object.entries(section).find(([label]) => label.startsWith(prdLabel));
  return entry ? entry[1] : null;
};

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Whitespace/line-ending normalization only — never changes wording. */
const normalizeText = (value) => value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();

const tokenize = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Token-level Dice coefficient: 2|A∩B| / (|A|+|B|) over word multisets.
 * Chosen over Levenshtein because for prose a reordered sentence should read as
 * "mostly the same meaning", not as heavy character-level drift.
 */
const diceCoefficient = (left, right) => {
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const counts = new Map();
  for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);

  let shared = 0;
  for (const token of b) {
    const remaining = counts.get(token) ?? 0;
    if (remaining > 0) {
      shared += 1;
      counts.set(token, remaining - 1);
    }
  }

  return (2 * shared) / (a.length + b.length);
};

const compareField = (ledgerValue, prdValue) => {
  if (ledgerValue === null) return { status: "no-ledger-row", similarity: null };
  if (prdValue === null) return { status: "label-missing-in-prd", similarity: null };

  // An unrendered placeholder means the PRD was never filled, which is a
  // different problem from drift — don't score it as 0% similarity.
  if (/\{\{[a-z0-9_]+\}\}/i.test(prdValue)) {
    return { status: "prd-placeholder-unrendered", similarity: null };
  }

  const ledgerText = normalizeText(ledgerValue);
  const prdText = normalizeText(prdValue);

  if (ledgerText === "" && prdText === "") return { status: "both-empty", similarity: null };
  if (ledgerText === "") return { status: "ledger-empty", similarity: 0 };
  if (prdText === "") return { status: "prd-empty", similarity: 0 };
  if (ledgerText === prdText) return { status: "exact", similarity: 1 };

  return { status: "drifted", similarity: diceCoefficient(ledgerText, prdText) };
};

/** First sentence that differs, for --verbose. Presentation only. */
const firstDivergence = (ledgerValue, prdValue) => {
  const split = (value) =>
    normalizeText(value)
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean);
  const ledgerSentences = split(ledgerValue);
  const prdSentences = split(prdValue);

  const limit = Math.max(ledgerSentences.length, prdSentences.length);
  for (let index = 0; index < limit; index += 1) {
    const ledgerSentence = ledgerSentences[index] ?? "(nothing)";
    const prdSentence = prdSentences[index] ?? "(nothing)";
    if (ledgerSentence !== prdSentence) {
      return { index, ledger: ledgerSentence, prd: prdSentence };
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

const buildProjectReport = (row) => {
  const hasLedger = row.ledger_updated_at !== null && row.ledger_updated_at !== undefined;
  const prdPath = path.join(row.path, "PRD.md");
  const projectExists = fs.existsSync(row.path);
  const prdExists = projectExists && fs.existsSync(prdPath);

  const report = {
    projectId: row.id,
    projectName: row.name,
    projectPath: row.path,
    prdPath,
    projectFolderMissing: !projectExists,
    prdMissing: projectExists && !prdExists,
    hasLedger,
    ledgerUpdatedAt: row.ledger_updated_at ?? null,
    prdModifiedAt: null,
    gapDays: null,
    stalerSide: null,
    sectionFound: false,
    fields: []
  };

  let section = null;
  if (prdExists) {
    const stat = fs.statSync(prdPath);
    report.prdModifiedAt = stat.mtime.toISOString();
    section = parseIntentSection(fs.readFileSync(prdPath, "utf8"));
    report.sectionFound = section !== null;
  }

  if (report.ledgerUpdatedAt && report.prdModifiedAt) {
    const ledgerMs = Date.parse(report.ledgerUpdatedAt);
    const prdMs = Date.parse(report.prdModifiedAt);
    if (Number.isFinite(ledgerMs) && Number.isFinite(prdMs)) {
      report.gapDays = Math.abs(ledgerMs - prdMs) / 86_400_000;
      report.stalerSide = ledgerMs === prdMs ? "same" : ledgerMs > prdMs ? "PRD.md" : "ledger";
    }
  }

  for (const field of FIELDS) {
    const ledgerValue = hasLedger ? row[field.column] ?? "" : null;
    const prdValue = section ? findPrdValue(section, field.prdLabel) : null;
    const comparison = compareField(ledgerValue, prdValue);

    report.fields.push({
      field: field.label,
      status: comparison.status,
      similarity: comparison.similarity,
      ledgerChars: ledgerValue === null ? null : normalizeText(ledgerValue).length,
      prdChars: prdValue === null ? null : normalizeText(prdValue).length,
      divergence:
        comparison.status === "drifted" ? firstDivergence(ledgerValue, prdValue) : null
    });
  }

  return report;
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const printReports = (reports, { dbPath, verbose }) => {
  const out = (line = "") => process.stdout.write(`${line}\n`);

  out();
  out("Intent Ledger ↔ PRD.md §2 drift  (read-only)");
  out(`Database: ${dbPath}`);
  out(`Projects: ${reports.length}`);
  out();

  for (const report of reports) {
    out("─".repeat(78));
    out(`${report.projectName}   ${dim(report.projectPath)}`);

    if (report.projectFolderMissing) {
      out("  ! project folder no longer exists on disk — skipped");
      out();
      continue;
    }
    if (!report.hasLedger) out("  ! no intent_ledger row for this project");
    if (report.prdMissing) out("  ! no PRD.md in the project folder");
    if (report.prdModifiedAt && !report.sectionFound) {
      out("  ! PRD.md has no recognisable Intent Ledger section");
    }

    if (report.hasLedger || report.sectionFound) {
      out();
      out(`  ${pad("field", 18)}${pad("status", 28)}${pad("similar", 9)}chars (ledger/PRD)`);
      for (const field of report.fields) {
        const similarity =
          field.similarity === null ? "—" : `${(field.similarity * 100).toFixed(1)}%`;
        const chars = `${field.ledgerChars ?? "—"} / ${field.prdChars ?? "—"}`;
        out(`  ${pad(field.field, 18)}${pad(field.status, 28)}${pad(similarity, 9)}${chars}`);
      }
    }

    out();
    out(`  ledger updated_at : ${report.ledgerUpdatedAt ?? "—"}`);
    out(`  PRD.md modified   : ${report.prdModifiedAt ?? "—"}`);
    if (report.gapDays !== null) {
      const staler = report.stalerSide === "same" ? "in step" : `${report.stalerSide} is older`;
      out(`  gap               : ${report.gapDays.toFixed(1)} days (${staler})`);
    }

    if (verbose) {
      const drifted = report.fields.filter((field) => field.divergence);
      if (drifted.length > 0) {
        out();
        out("  first divergence per drifted field:");
        for (const field of drifted) {
          out(`    ${field.field} (sentence ${field.divergence.index + 1})`);
          out(`      ledger: ${truncate(field.divergence.ledger, 140)}`);
          out(`      PRD   : ${truncate(field.divergence.prd, 140)}`);
        }
      }
    }

    out();
  }

  printSummary(reports, out);
};

const printSummary = (reports, out) => {
  const scored = reports.flatMap((report) =>
    report.fields.filter((field) => typeof field.similarity === "number")
  );

  out("─".repeat(78));
  if (scored.length === 0) {
    out("No comparable field pairs — nothing to score.");
    out();
    return;
  }

  const exact = scored.filter((field) => field.status === "exact").length;
  const drifted = scored.filter((field) => field.status === "drifted");
  const mean =
    scored.reduce((total, field) => total + field.similarity, 0) / scored.length;

  out("Summary");
  out(`  comparable field pairs : ${scored.length}`);
  out(`  exact matches          : ${exact}`);
  out(`  drifted                : ${drifted.length}`);
  out(`  mean similarity        : ${(mean * 100).toFixed(1)}%`);
  if (drifted.length > 0) {
    const worst = drifted.reduce((low, field) => (field.similarity < low.similarity ? field : low));
    out(`  worst drifted field    : ${worst.field} at ${(worst.similarity * 100).toFixed(1)}%`);
  }
  out();
};

const pad = (value, width) => String(value).padEnd(width);
const dim = (value) => `\u001b[2m${value}\u001b[0m`;
const truncate = (value, max) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

const printUsage = () => {
  process.stdout.write(
    [
      "Intent Ledger ↔ PRD.md §2 drift diagnostic (read-only).",
      "",
      "Usage:  npm run intent:drift -- [options]",
      "",
      "Options:",
      "  --project, -p <name|id>  Only this project (name match is a substring, case-insensitive)",
      "  --db <path>              Database file (default: STARSHIP_DB_PATH, else userData/starship)",
      "  --verbose, -v            Show the first diverging sentence per drifted field",
      "  --json                   Emit raw JSON instead of the table",
      "  --help, -h               This message",
      "",
      "This script never writes to the database, the PRD files, or anything else.",
      ""
    ].join("\n")
  );
};

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

if (require.main === module) {
  main();
}

/**
 * Exported so sibling diagnostics reuse this exact §2 parser rather than
 * growing a second, silently diverging copy of the label-matching rules.
 */
module.exports = {
  FIELDS,
  parseIntentSection,
  findPrdValue,
  normalizeText,
  resolveDbPath,
  loadDatabase,
  readProjects
};
