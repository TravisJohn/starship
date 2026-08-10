#!/usr/bin/env node
"use strict";

/**
 * Intent Ledger backfill DRY RUN — READ ONLY, writes nothing.
 *
 * For every project with no `intent_ledger` row, reports whether its PRD.md §2
 * could supply all four ledger fields, and previews exactly what a backfill
 * would insert. There is no insert mode here by design: this script only ever
 * reports what *would* happen.
 *
 * The §2 parser, DB resolution, and project query are imported from
 * intent-drift.cjs so there is exactly one implementation of each.
 *
 *   npm run intent:backfill-dryrun
 *   npm run intent:backfill-dryrun -- --verbose
 */

const fs = require("node:fs");
const path = require("node:path");

const {
  FIELDS,
  parseIntentSection,
  findPrdValue,
  normalizeText,
  resolveDbPath,
  loadDatabase,
  readProjects
} = require("./intent-drift.cjs");

/**
 * Boilerplate that means "nobody filled this in". Template instructional prose
 * counts as absent content even though it parses as a value.
 */
const PLACEHOLDER_PATTERNS = [
  /^\{\{[a-z0-9_]+\}\}$/i,
  /^(tbd|todo|n\/a|none|-+)$/i,
  /^\[.*\]$/,
  /this section is the project's constitution/i
];

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath(options.db);

  if (!fs.existsSync(dbPath)) {
    process.stderr.write(`No Starship database at:\n  ${dbPath}\n`);
    process.exit(1);
  }

  const db = loadDatabase(dbPath);
  let candidates;
  try {
    // A null ledger_updated_at is the marker for "left join found no row".
    candidates = readProjects(db, options.project).filter(
      (row) => row.ledger_updated_at === null || row.ledger_updated_at === undefined
    );
  } finally {
    db.close();
  }

  const reports = candidates.map(inspectProject);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ dbPath, candidates: reports }, null, 2)}\n`);
    return;
  }

  printReport(reports, { dbPath, verbose: options.verbose });
};

const parseArgs = (argv) => {
  const options = { db: null, project: null, json: false, verbose: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--verbose" || arg === "-v") options.verbose = true;
    else if (arg === "--db") options.db = argv[++index] ?? null;
    else if (arg === "--project" || arg === "-p") options.project = argv[++index] ?? null;
  }
  return options;
};

const classifyValue = (value) => {
  if (value === null) return "label-missing";
  const text = normalizeText(value);
  if (text === "") return "empty";
  if (/\{\{[a-z0-9_]+\}\}/i.test(text)) return "placeholder";
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))) return "placeholder";
  return "ok";
};

const inspectProject = (row) => {
  const prdPath = path.join(row.path, "PRD.md");
  const report = {
    projectId: row.id,
    projectName: row.name,
    projectPath: row.path,
    prdPath,
    blocker: null,
    fields: [],
    backfillable: false
  };

  if (!fs.existsSync(row.path)) {
    report.blocker = "project folder missing";
    return report;
  }
  if (!fs.existsSync(prdPath)) {
    report.blocker = "no PRD.md";
    return report;
  }

  const section = parseIntentSection(fs.readFileSync(prdPath, "utf8"));
  if (section === null) {
    report.blocker = "no Intent Ledger section in PRD.md";
    return report;
  }

  for (const field of FIELDS) {
    const value = findPrdValue(section, field.prdLabel);
    const status = classifyValue(value);
    report.fields.push({
      field: field.label,
      status,
      chars: value === null ? 0 : normalizeText(value).length,
      value: value === null ? null : normalizeText(value)
    });
  }

  report.backfillable = report.fields.every((field) => field.status === "ok");
  return report;
};

const printReport = (reports, { dbPath, verbose }) => {
  const out = (line = "") => process.stdout.write(`${line}\n`);

  out();
  out("Intent Ledger backfill — DRY RUN (nothing is written)");
  out(`Database: ${dbPath}`);
  out(`Projects with no intent_ledger row: ${reports.length}`);
  out();

  out(
    `${pad("project", 28)}${pad("PRD §2", 34)}${pad("purpose", 14)}${pad("success", 14)}${pad(
      "tradeoffs",
      14
    )}${pad("neverDo", 14)}backfill?`
  );
  out("─".repeat(132));

  for (const report of reports) {
    if (report.blocker) {
      out(
        `${pad(report.projectName, 28)}${pad(report.blocker, 34)}${pad("—", 14)}${pad(
          "—",
          14
        )}${pad("—", 14)}${pad("—", 14)}no`
      );
      continue;
    }

    const cell = (key) => {
      const field = report.fields.find((entry) => entry.field === key);
      return field.status === "ok" ? `ok (${field.chars})` : field.status;
    };

    out(
      `${pad(report.projectName, 28)}${pad("section found", 34)}${pad(cell("purpose"), 14)}${pad(
        cell("successCriteria"),
        14
      )}${pad(cell("acceptedTradeoffs"), 14)}${pad(cell("neverDo"), 14)}${
        report.backfillable ? "YES" : "no"
      }`
    );
  }

  const ready = reports.filter((report) => report.backfillable);
  out();
  out("─".repeat(132));
  out(`Backfillable now : ${ready.length} of ${reports.length}`);
  out(`Blocked          : ${reports.length - ready.length}`);
  out();

  if (ready.length > 0) {
    out("Preview of what would be inserted");
    out();
    for (const report of ready) {
      out("─".repeat(78));
      out(`${report.projectName}  ${report.projectPath}`);
      out(`  source: ${report.prdPath}`);
      for (const field of report.fields) {
        out(`  ${field.field}:`);
        out(`    ${truncate(field.value, verbose ? 4000 : 200)}`);
      }
      out();
    }
  }

  out("Dry run only — no rows were inserted, and this script has no insert mode.");
  out();
};

const pad = (value, width) => String(value).padEnd(width);
const truncate = (value, max) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

main();
