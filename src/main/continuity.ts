import fs from "node:fs";
import path from "node:path";
import type { IntentLedger, PrdPhase, ProjectLogEntry } from "../shared/ipc";
import { findLatestProjectLogEntry, readPrdPhases, readPrdSummary } from "./dashboard";

/**
 * CONTINUITY.md - the thin, provider-agnostic handoff note. See
 * `templates/CONTINUITY.md` for the artifact's own rules.
 *
 * This module owns the Starship-generated version: the one written when a
 * session ends through Exit & Summarize, including the case the agent-side
 * directive cannot cover at all - a session that hit a usage limit and had no
 * turn left in which to write its own.
 *
 * Writing into an existing project is a deliberate, narrow exception to prime
 * directive 1, amended 2026-08-07. This file is the only path Starship may
 * write, it is always overwritten, and it is never read back as a source of
 * truth - only inspected to decide whether an agent already wrote a better
 * one (see shouldPreserveExisting).
 */

export const CONTINUITY_FILENAME = "CONTINUITY.md";

export const STARSHIP_PROVENANCE = "Produced by Starship at session exit.";

/** templates/CONTINUITY.md caps DECIDED at five bullets. Enforced here rather than asked for. */
const MAX_DECIDED_BULLETS = 5;

/**
 * How close to the session's own transcript an agent-authored file must be to
 * count as "written by this session". An agent that writes CONTINUITY.md as
 * its last act does so *before* its closing message lands in the transcript,
 * so the file is always slightly older than the transcript's final write - a
 * plain "newer than the transcript" test would never hold. A generous window
 * distinguishes this-session from a stale file left over days ago, which is
 * the only distinction that actually matters.
 */
const AGENT_AUTHORED_TOLERANCE_MS = 10 * 60 * 1000;

export type ContinuitySections = {
  whereThisIs: string;
  thisSession: string[];
  decided: string[];
  never: string[];
  next: string;
};

export type ContinuityContext = {
  projectName: string;
  prdSummary: string | null;
  phases: PrdPhase[];
  latestLogEntry: ProjectLogEntry | null;
  ledger: IntentLedger | null;
};

export type ContinuityWriteStatus =
  | "written"
  | "written-degraded"
  | "skipped-agent-authored"
  | "failed";

export type ContinuityWriteResult = {
  status: ContinuityWriteStatus;
  filePath: string | null;
  detail?: string;
};

/**
 * The durable half of the note. Everything here is read from artifacts that
 * survive a session ending badly - the PRD, the project log, the Intent
 * Ledger - which is what keeps WHERE THIS IS, DECIDED and NEVER trustworthy
 * even when the transcript is truncated mid-thought. Only THIS SESSION and
 * NEXT depend on the session itself, so degradation stays confined to them.
 */
export const buildContinuityContext = (
  projectName: string,
  projectPath: string,
  ledger: IntentLedger | null
): ContinuityContext => ({
  projectName,
  prdSummary: readPrdSummary(projectPath),
  phases: readPrdPhases(projectPath),
  latestLogEntry: findLatestProjectLogEntry(projectPath),
  ledger
});

/**
 * The note is pasted through three different terminals, so it is ASCII or it
 * is nothing. Known typographic characters are folded to their ASCII
 * equivalent rather than dropped, so text stays readable; anything else
 * outside ASCII is removed.
 */
export const toAscii = (value: string): string =>
  value
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[•·]/g, "-")
    .replace(/[^\x09\x0A\x20-\x7E]/g, "");

/**
 * One level of "- " bullets, one line each. A model that returns its own
 * bullet markers, blank entries or multi-line prose still produces a valid
 * single-level list.
 */
export const normalizeBullets = (values: string[]): string[] =>
  values
    .map((value) => value.replace(/\s+/g, " ").replace(/^[-*•]\s*/, "").trim())
    .filter((value) => value.length > 0);

export const capDecided = (bullets: string[]): string[] =>
  bullets.slice(0, MAX_DECIDED_BULLETS);

/**
 * What the note says when the session itself yielded nothing reliable. The
 * durable sections are still populated from context; only the two
 * transcript-derived sections degrade, and they say so rather than guessing.
 * An empty section is safe - a confidently wrong one is not, which is why
 * THIS SESSION names the doubt instead of staying silent.
 */
export const buildDegradedSections = (
  context: ContinuityContext,
  reason: string
): ContinuitySections => ({
  whereThisIs: describeDurableState(context),
  thisSession: [
    `${reason} Treat this section as incomplete and check git status before continuing.`
  ],
  decided: context.latestLogEntry
    ? [`Most recent recorded decision: ${context.latestLogEntry.title}`]
    : [],
  never: ledgerToNeverBullets(context.ledger),
  next: "Not recorded. The previous session did not state a next step. Check git status and PROJECT_LOG.md before choosing one."
});

const describeDurableState = (context: ContinuityContext): string => {
  const parts: string[] = [];
  if (context.prdSummary) {
    parts.push(context.prdSummary);
  }
  if (context.phases.length > 0) {
    parts.push(`The PRD lists ${context.phases.length} phases: ${context.phases.map((phase) => phase.title).join("; ")}.`);
  }
  if (context.latestLogEntry) {
    // Project log headings conventionally lead with their own date
    // ("## 2026-07-25 - ..."), and extractDatedHeadings keeps the whole
    // heading as the title. Prefixing the date again reads as a stutter.
    const { date, title } = context.latestLogEntry;
    const entry = title.startsWith(date) ? title : `${date}: ${title}`;
    parts.push(`Latest project log entry: ${entry}.`);
  }

  return parts.length > 0
    ? parts.join(" ")
    : "No PRD or project log was found for this project, so its state could not be described from durable sources.";
};

const ledgerToNeverBullets = (ledger: IntentLedger | null): string[] =>
  ledger && ledger.neverDo.trim().length > 0
    ? normalizeBullets(ledger.neverDo.split(/\r?\n/))
    : [];

/**
 * Renders the final document and enforces every format rule the template
 * states, rather than trusting the model to have followed them: ASCII only,
 * one level of bullets, DECIDED capped at five. A section with nothing real
 * in it says so plainly instead of being padded or silently omitted.
 */
export const renderContinuityDocument = (input: {
  projectName: string;
  sections: ContinuitySections;
  producedBy: string;
  sessionEndedOn: string;
}): string => {
  const { sections } = input;

  const lines = [
    `HANDOFF - ${input.projectName}`,
    `Session ended ${input.sessionEndedOn}. ${input.producedBy}`,
    "",
    "WHERE THIS IS",
    sections.whereThisIs.trim() || "Not recorded.",
    "",
    "THIS SESSION",
    ...renderBullets(normalizeBullets(sections.thisSession), "Nothing recorded for this session."),
    "",
    "DECIDED - do not reopen without cause",
    ...renderBullets(
      capDecided(normalizeBullets(sections.decided)),
      "Nothing recorded."
    ),
    "",
    "NEVER - hard constraints",
    ...renderBullets(
      normalizeBullets(sections.never),
      "No Intent Ledger has been captured for this project, so no hard constraints are recorded."
    ),
    "",
    "NEXT",
    sections.next.trim() || "Not recorded.",
    ""
  ];

  return toAscii(lines.join("\n"));
};

const renderBullets = (bullets: string[], emptyNotice: string): string[] =>
  bullets.length > 0 ? bullets.map((bullet) => `- ${bullet}`) : [emptyNotice];

/**
 * True when the existing file was written by an agent rather than by Starship.
 * A file with no recognisable provenance line is treated as Starship's to
 * replace - this file is disposable by design and Starship owns the path.
 */
export const isAgentAuthored = (existing: string): boolean => {
  const match = existing.match(/^Session ended .*?\.\s*Produced by (.+?)\.\s*$/m);
  if (!match) {
    return false;
  }

  return !/starship/i.test(match[1]);
};

/**
 * The clobber guard. An agent that wrote its own note during this session had
 * context Starship can only infer from a transcript, so that version wins. A
 * stale agent-authored file from an earlier session does not.
 */
export const shouldPreserveExisting = (
  existing: string | null,
  existingMtimeMs: number | null,
  transcriptMtimeMs: number | null
): boolean => {
  if (existing === null || existingMtimeMs === null) {
    return false;
  }

  if (!isAgentAuthored(existing)) {
    return false;
  }

  if (transcriptMtimeMs === null) {
    return true;
  }

  return existingMtimeMs >= transcriptMtimeMs - AGENT_AUTHORED_TOLERANCE_MS;
};

export const formatSessionDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Writes the note, or explains why it didn't. Never throws: a handoff that
 * can't be written must not take the session-end briefing down with it, since
 * the briefing is what the builder is actually waiting on.
 */
export const writeContinuityDocument = (input: {
  projectPath: string;
  projectName: string;
  sections: ContinuitySections;
  degraded: boolean;
  transcriptMtimeMs: number | null;
  now?: Date;
}): ContinuityWriteResult => {
  const filePath = path.join(input.projectPath, CONTINUITY_FILENAME);

  try {
    const existing = readIfPresent(filePath);
    if (shouldPreserveExisting(existing.text, existing.mtimeMs, input.transcriptMtimeMs)) {
      return {
        status: "skipped-agent-authored",
        filePath,
        detail: "An agent wrote its own handoff during this session; that version is kept."
      };
    }

    const document = renderContinuityDocument({
      projectName: input.projectName,
      sections: input.sections,
      producedBy: STARSHIP_PROVENANCE,
      sessionEndedOn: formatSessionDate(input.now ?? new Date())
    });

    fs.writeFileSync(filePath, document, "utf8");
    return { status: input.degraded ? "written-degraded" : "written", filePath };
  } catch (error: unknown) {
    return {
      status: "failed",
      filePath,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
};

const readIfPresent = (
  filePath: string
): { text: string | null; mtimeMs: number | null } => {
  try {
    return {
      text: fs.readFileSync(filePath, "utf8"),
      mtimeMs: fs.statSync(filePath).mtimeMs
    };
  } catch {
    return { text: null, mtimeMs: null };
  }
};
