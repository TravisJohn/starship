import { ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ContextExportRequest, ContextExportResult, PrdPhase } from "../shared/ipc";
import { buildContinuityContext, normalizeBullets, toAscii } from "./continuity";
import type { ContinuityContext } from "./continuity";
import type { StarshipDb } from "./db";

/**
 * 20 KB, roughly 5k tokens. The block exists to be pasted into a fresh agent's
 * first message, so it competes for the same context window as the work
 * itself - a "complete" export nobody can afford to paste is worth nothing.
 */
const MAX_BYTES = 20 * 1024;

const RULES_TRUNCATION_MARKER = "[RULES TRUNCATED - read CLAUDE.md in full before working]";

/**
 * The project's own working agreement, verbatim.
 *
 * Claude Code reads CLAUDE.md by itself, so for that audience this is
 * redundant - but Codex and Antigravity do not, and the whole point of the
 * block is that it is self-contained for whichever agent receives it. Read
 * tolerantly: a project with no CLAUDE.md is normal, not an error.
 */
export const readProjectRules = (projectPath: string): string | null => {
  try {
    const text = fs.readFileSync(path.join(projectPath, "CLAUDE.md"), "utf8").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
};

type Section = { heading: string; lines: string[] };

const renderSection = (section: Section): string =>
  [section.heading, ...section.lines].join("\n");

const bytesOf = (value: string): number => Buffer.byteLength(value, "utf8");

const bulletsOrNotice = (values: string[], notice: string): string[] => {
  const bullets = normalizeBullets(values);
  return bullets.length > 0 ? bullets.map((bullet) => `- ${bullet}`) : [notice];
};

/**
 * Phase bodies are deliberately dropped - only titles survive. A PRD's phase
 * bodies are the single largest thing that could land here, and the receiving
 * agent needs to know the sequence, not re-read the specification it can open
 * itself.
 */
const phaseLines = (phases: PrdPhase[]): string[] =>
  phases.map((phase, index) => `${index + 1}. ${phase.title}`);

const buildStateSection = (context: ContinuityContext, includeLogBody: boolean): Section => {
  const lines: string[] = [];

  if (context.prdSummary) {
    lines.push(context.prdSummary);
  }

  if (context.phases.length > 0) {
    lines.push("", "Phases listed in the PRD:", ...phaseLines(context.phases));
  }

  if (context.latestLogEntry) {
    const { date, title, body } = context.latestLogEntry;
    // Log headings conventionally lead with their own date, so prefixing it
    // again reads as a stutter.
    const heading = title.startsWith(date) ? title : `${date}: ${title}`;
    lines.push("", `Most recent project log entry - ${heading}`);
    if (includeLogBody && body.trim().length > 0) {
      lines.push(body.trim());
    }
  }

  if (lines.length === 0) {
    lines.push(
      "No PRD or project log was found, so this project's state could not be described from durable sources."
    );
  }

  return { heading: "STATE", lines };
};

export const buildContextExport = (
  db: StarshipDb,
  request: ContextExportRequest
): ContextExportResult => {
  const ledger = db.getIntentLedger(request.projectId);
  const context = buildContinuityContext(request.projectName, request.projectPath, ledger);
  const stored = db.getContinuitySections(request.projectId);
  const rules = readProjectRules(request.projectPath);

  const missingSections: string[] = [];
  if (!rules) missingSections.push("Rules");
  if (!ledger) missingSections.push("Intent Ledger");
  if (!stored) missingSections.push("Next Steps");

  const header = [
    `STARSHIP CONTEXT EXPORT - ${request.projectName}`,
    `Generated ${new Date().toISOString().slice(0, 10)}. Paste as the opening message of a new session.`,
    "Everything needed is in this block. Nothing here assumes access to a previous conversation."
  ].join("\n");

  const rulesSection: Section = {
    heading: "RULES",
    lines: [
      rules ??
        "This project has no CLAUDE.md, so no working agreement is recorded. Ask before assuming conventions."
    ]
  };

  const neverSection: Section = {
    heading: "NEVER - hard constraints",
    lines: bulletsOrNotice(
      ledger ? ledger.neverDo.split(/\r?\n/) : [],
      "No Intent Ledger has been captured for this project, so no hard constraints are recorded."
    )
  };

  const intentSection: Section = {
    heading: "INTENT LEDGER",
    lines: ledger
      ? [
          `Purpose: ${ledger.purpose || "Not recorded."}`,
          `Success looks like: ${ledger.successCriteria || "Not recorded."}`,
          `Tradeoffs accepted: ${ledger.acceptedTradeoffs || "Not recorded."}`,
          `Must never become: ${ledger.neverDo || "Not recorded."}`
        ]
      : [
          "No Intent Ledger has been captured for this project. Its purpose, success",
          "criteria and accepted tradeoffs are not recorded anywhere - ask before",
          "inferring them from the code."
        ]
  };

  const nextSection: Section = {
    heading: "NEXT",
    lines: stored
      ? [
          stored.sections.next.trim() || "Not recorded.",
          ...(stored.degraded
            ? [
                "",
                "This was reconstructed from durable state, not from a readable session.",
                "Treat it as a starting point and check git status before continuing."
              ]
            : [])
        ]
      : [
          "No session has ended through Starship for this project yet, so no next step",
          "is recorded. Check PROJECT_LOG.md and git status before choosing one."
        ]
  };

  /*
   * Assembly order is also the order of protection. Rules and Intent are never
   * trimmed: a half-stated constraint is more dangerous than an absent one,
   * because it reads as complete. State gives way first, then Next, and only
   * as a last resort is Rules truncated - loudly, with a marker, so the reader
   * knows to go and read the file.
   */
  const protectedText = [
    header,
    renderSection(rulesSection),
    renderSection(neverSection),
    renderSection(intentSection)
  ].join("\n\n");

  const nextText = renderSection(nextSection);
  let trimNotice: string | null = null;

  const assemble = (parts: string[]): string => `${toAscii(parts.join("\n\n"))}\n`;

  // Everything fits, with the log body included.
  const full = assemble([protectedText, renderSection(buildStateSection(context, true)), nextText]);
  if (bytesOf(full) <= MAX_BYTES) {
    return { text: full, bytes: bytesOf(full), trimmed: false, trimNotice: null, missingSections };
  }

  // Drop the log body first - it is prose the receiving agent can open itself.
  const withoutLogBody = assemble([
    protectedText,
    renderSection(buildStateSection(context, false)),
    nextText
  ]);
  if (bytesOf(withoutLogBody) <= MAX_BYTES) {
    trimNotice = "The latest project log entry was reduced to its title to fit the size limit.";
    return {
      text: appendNotice(withoutLogBody, trimNotice),
      bytes: bytesOf(appendNotice(withoutLogBody, trimNotice)),
      trimmed: true,
      trimNotice,
      missingSections
    };
  }

  // Then State entirely.
  const withoutState = assemble([protectedText, nextText]);
  if (bytesOf(withoutState) <= MAX_BYTES) {
    trimNotice =
      "The STATE section was dropped to fit the size limit. Read PRD.md and PROJECT_LOG.md for it.";
    return {
      text: appendNotice(withoutState, trimNotice),
      bytes: bytesOf(appendNotice(withoutState, trimNotice)),
      trimmed: true,
      trimNotice,
      missingSections
    };
  }

  // Then Next.
  const protectedOnly = assemble([protectedText]);
  if (bytesOf(protectedOnly) <= MAX_BYTES) {
    trimNotice =
      "STATE and NEXT were dropped to fit the size limit. The rules and intent below are complete.";
    return {
      text: appendNotice(protectedOnly, trimNotice),
      bytes: bytesOf(appendNotice(protectedOnly, trimNotice)),
      trimmed: true,
      trimNotice,
      missingSections
    };
  }

  // Last resort: the rules alone do not fit. Truncate at a line boundary and
  // say so, rather than emitting something that looks complete.
  trimNotice =
    "This project's CLAUDE.md alone exceeds the size limit, so RULES is truncated. Read CLAUDE.md in full.";
  const truncated = truncateRules({
    header,
    rules: rulesSection.lines.join("\n"),
    tail: [renderSection(neverSection), renderSection(intentSection)].join("\n\n"),
    notice: trimNotice
  });

  return {
    text: truncated,
    bytes: bytesOf(truncated),
    trimmed: true,
    trimNotice,
    missingSections
  };
};

const appendNotice = (text: string, notice: string): string =>
  `${text.trimEnd()}\n\nNOTE\n${notice}\n`;

const truncateRules = (input: {
  header: string;
  rules: string;
  tail: string;
  notice: string;
}): string => {
  const scaffold = assembleScaffold(input.header, "", input.tail, input.notice);
  const budget = MAX_BYTES - bytesOf(scaffold) - bytesOf(RULES_TRUNCATION_MARKER) - 2;

  const kept: string[] = [];
  let used = 0;
  for (const line of input.rules.split("\n")) {
    const cost = bytesOf(line) + 1;
    if (used + cost > budget) {
      break;
    }
    kept.push(line);
    used += cost;
  }

  return assembleScaffold(
    input.header,
    [...kept, RULES_TRUNCATION_MARKER].join("\n"),
    input.tail,
    input.notice
  );
};

const assembleScaffold = (
  header: string,
  rulesBody: string,
  tail: string,
  notice: string
): string =>
  `${toAscii([header, `RULES\n${rulesBody}`, tail].join("\n\n")).trimEnd()}\n\nNOTE\n${notice}\n`;

export const registerContextExportHandlers = (db: StarshipDb): void => {
  ipcMain.handle(
    "context:export",
    (_event, request: ContextExportRequest): ContextExportResult =>
      buildContextExport(db, request)
  );
};
