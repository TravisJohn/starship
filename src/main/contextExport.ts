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
   * What the last session actually did. Only present once a session has ended
   * through Starship, and omitted rather than announced when empty - unlike
   * Rules and Intent, whose absence changes how the receiving agent should
   * behave, a missing session narrative just means nothing has happened yet,
   * which NEXT already says.
   */
  const sessionSection: Section | null =
    stored && normalizeBullets(stored.sections.thisSession).length > 0
      ? {
          heading: "MOST RECENT SESSION",
          lines: normalizeBullets(stored.sections.thisSession).map((b) => `- ${b}`)
        }
      : null;

  const decidedSection: Section | null =
    stored && normalizeBullets(stored.sections.decided).length > 0
      ? {
          heading: "DECIDED - do not reopen without cause",
          lines: normalizeBullets(stored.sections.decided).map((b) => `- ${b}`)
        }
      : null;

  /*
   * Rules and Intent are never dropped: a half-stated constraint is more
   * dangerous than an absent one, because it reads as complete. Everything
   * else gives way in ascending order of value to a receiving agent - the log
   * body first, then the session narrative, then state, then the settled
   * decisions, and only then the single most actionable line, NEXT. Rules is
   * truncated last of all, loudly, so the reader knows to open the file.
   */
  let includeLogBody = true;
  let includeSession = true;
  let includeState = true;
  let includeDecided = true;
  let includeNext = true;

  const assemble = (): string => {
    const parts = [
      header,
      renderSection(rulesSection),
      renderSection(neverSection),
      renderSection(intentSection),
      ...(includeState ? [renderSection(buildStateSection(context, includeLogBody))] : []),
      ...(includeSession && sessionSection ? [renderSection(sessionSection)] : []),
      ...(includeDecided && decidedSection ? [renderSection(decidedSection)] : []),
      ...(includeNext ? [renderSection(nextSection)] : [])
    ];
    return `${toAscii(parts.join("\n\n"))}\n`;
  };

  // Each notice is written to describe everything dropped up to that point,
  // since only the last one applied is shown.
  const ladder: { drop: () => void; notice: string }[] = [
    {
      drop: () => {
        includeLogBody = false;
      },
      notice: "The latest project log entry was reduced to its title to fit the size limit."
    },
    {
      drop: () => {
        includeSession = false;
      },
      notice:
        "The session narrative was dropped, and the latest log entry reduced to its title, to fit the size limit."
    },
    {
      drop: () => {
        includeState = false;
      },
      notice:
        "STATE and the session narrative were dropped to fit the size limit. Read PRD.md and PROJECT_LOG.md for them."
    },
    {
      drop: () => {
        includeDecided = false;
      },
      notice:
        "Everything except the rules, the intent and the next step was dropped to fit the size limit."
    },
    {
      drop: () => {
        includeNext = false;
      },
      notice:
        "Only the rules and the intent fit inside the size limit. Everything else was dropped."
    }
  ];

  let trimNotice: string | null = null;
  let text = assemble();

  for (const step of ladder) {
    if (bytesOf(text) <= MAX_BYTES) {
      break;
    }
    step.drop();
    trimNotice = step.notice;
    text = assemble();
  }

  if (bytesOf(text) <= MAX_BYTES) {
    const final = trimNotice ? appendNotice(text, trimNotice) : text;
    return {
      text: final,
      bytes: bytesOf(final),
      trimmed: trimNotice !== null,
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
