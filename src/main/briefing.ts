import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  BriefingGenerateRequest,
  BriefingGetLatestRequest,
  BriefingListHistoryRequest,
  SessionBriefing,
  SessionBriefingHistoryEntry
} from "../shared/ipc";
import {
  buildContinuityContext,
  buildDegradedSections,
  writeContinuityDocument,
  type ContinuityContext,
  type ContinuitySections,
  type ContinuityWriteResult
} from "./continuity";
import { findNewestTranscript } from "./dashboard";
import type { StarshipDb } from "./db";
import { getHeadlessCwd, runHeadlessClaude } from "./inception/headlessClaude";

const NARRATIVE_CHARACTER_BUDGET = 12000;

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null ? (value as JsonRecord) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const registerBriefingHandlers = (db: StarshipDb): void => {
  ipcMain.handle(
    "briefing:generate",
    (_event, request: BriefingGenerateRequest): Promise<SessionBriefing> =>
      generateSessionBriefing(db, request)
  );

  ipcMain.handle(
    "briefing:getLatest",
    (_event, request: BriefingGetLatestRequest): SessionBriefing | null =>
      db.getSessionBriefing(request.projectId)
  );

  ipcMain.handle(
    "briefing:listHistory",
    (_event, request: BriefingListHistoryRequest): SessionBriefingHistoryEntry[] =>
      db.listBriefingHistory(request.projectId)
  );
};

/**
 * Summarizes the most recent Claude Code session for a project, at decision
 * altitude, relating it back to the Intent Ledger - the "Exit and
 * Summarize" action on the Terminal page. Only one briefing is kept per
 * project (the latest); a Timeline assembling a history of these is later
 * PRD scope, not this pass.
 *
 * Falls back to a plain, honest notice (never a fabricated summary) if
 * there's no transcript yet or the headless call fails - matching the same
 * graceful-degradation pattern Inception's drafting pass already uses.
 */
export const generateSessionBriefing = async (
  db: StarshipDb,
  request: BriefingGenerateRequest
): Promise<SessionBriefing> => {
  const ledger = db.getIntentLedger(request.projectId);
  const context = buildContinuityContext(
    db.getProject(request.projectId)?.name ?? path.basename(request.projectPath),
    request.projectPath,
    ledger
  );

  const transcript = findNewestTranscript(request.projectPath);
  if (!transcript) {
    writeContinuity(db, request, context, null, {
      degraded: "No session activity was recorded for this project."
    });
    return db.saveSessionBriefing(request.projectId, "No recorded activity yet for this project.");
  }

  const narrative = buildSessionNarrative(transcript.path);
  if (narrative.trim().length === 0) {
    writeContinuity(db, request, context, transcript.mtimeMs, {
      degraded: "The session ran but produced no summarizable activity."
    });
    return db.saveSessionBriefing(
      request.projectId,
      "The session ran but produced no summarizable activity."
    );
  }

  const prompt = fillPromptTemplate(readPromptTemplate(), {
    payload_json: JSON.stringify(
      {
        intentLedger: ledger
          ? {
              purpose: ledger.purpose,
              successCriteria: ledger.successCriteria,
              acceptedTradeoffs: ledger.acceptedTradeoffs,
              neverDo: ledger.neverDo
            }
          : null,
        prdSummary: context.prdSummary,
        prdPhases: context.phases,
        latestProjectLogEntry: context.latestLogEntry,
        sessionNarrative: narrative
      },
      null,
      2
    )
  });

  try {
    const raw = await runHeadlessClaude(db, {
      cacheNamespace: "briefing",
      prompt,
      cwd: getHeadlessCwd()
    });

    // Extracted independently so a malformed handoff block can never cost the
    // builder the briefing he is actually waiting on, and vice versa.
    const summary = extractSummary(raw) ?? raw.trim();
    const sections = extractContinuity(raw);

    if (sections) {
      writeContinuity(db, request, context, transcript.mtimeMs, { sections });
    } else {
      writeContinuity(db, request, context, transcript.mtimeMs, {
        degraded: "The session ended before it could be summarized reliably."
      });
    }

    return db.saveSessionBriefing(request.projectId, summary);
  } catch (error) {
    writeContinuity(db, request, context, transcript.mtimeMs, {
      degraded: "The session ended before it could be summarized reliably."
    });
    return db.saveSessionBriefing(
      request.projectId,
      `Session activity was recorded, but the summary couldn't be generated: ${stringifyError(error)}`
    );
  }
};

/**
 * Writes the handoff and records the outcome in the activity log. Deliberately
 * fire-and-forget from the briefing's point of view: the write never throws
 * (see continuity.ts), and its outcome is observable in the Activity Log
 * rather than blocking the exit flow the builder is waiting on.
 */
const writeContinuity = (
  db: StarshipDb,
  request: BriefingGenerateRequest,
  context: ContinuityContext,
  transcriptMtimeMs: number | null,
  outcome: { sections: ContinuitySections } | { degraded: string }
): ContinuityWriteResult => {
  const degraded = "degraded" in outcome;
  const sections = degraded
    ? buildDegradedSections(context, outcome.degraded)
    : outcome.sections;

  const result = writeContinuityDocument({
    projectPath: request.projectPath,
    projectName: context.projectName,
    sections,
    degraded,
    transcriptMtimeMs
  });

  db.logActivity({
    eventType: `continuity_${result.status.replace(/-/g, "_")}`,
    projectId: request.projectId,
    detail: { filePath: result.filePath, detail: result.detail ?? null }
  });

  return result;
};

/**
 * A condensed, readable narrative of one transcript - the human's own
 * prompts, Claude's text responses, and a one-line mention of each tool
 * used - built specifically for feeding a summarization prompt. Distinct
 * from parser/parseLine.ts on purpose: that parser serves the Kanban/status
 * engine's need for structured tool-use/tool-result events, not readable
 * prose, and changing its shape risks the machinery Phase 3 already depends
 * on. This is intentionally a separate, simpler, best-effort reader.
 *
 * Bounded to the most recent NARRATIVE_CHARACTER_BUDGET characters so an
 * unusually long session can't blow through the headless call's context or
 * cost - recency is what a "where do things stand" briefing needs most.
 */
export const buildSessionNarrative = (transcriptPath: string): string => {
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return "";
  }

  const parts: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const record = asRecord(parsed);
    if (!record) {
      continue;
    }

    if (record.type === "user") {
      const text = extractUserPromptText(record);
      if (text) {
        parts.push(`Builder: ${text}`);
      }
      continue;
    }

    if (record.type === "assistant") {
      const message = asRecord(record.message);
      const content = message?.content;
      if (!Array.isArray(content)) {
        continue;
      }

      for (const block of content) {
        const blockRecord = asRecord(block);
        if (!blockRecord) {
          continue;
        }

        if (blockRecord.type === "text") {
          const text = asString(blockRecord.text);
          if (text && text.trim()) {
            parts.push(`Claude: ${text.trim()}`);
          }
        }

        if (blockRecord.type === "tool_use") {
          const toolName = asString(blockRecord.name);
          if (toolName) {
            parts.push(`Claude used ${toolName}${describeToolInputBriefly(blockRecord.input)}`);
          }
        }
      }
    }
  }

  const narrative = parts.join("\n");
  return narrative.length > NARRATIVE_CHARACTER_BUDGET
    ? narrative.slice(narrative.length - NARRATIVE_CHARACTER_BUDGET)
    : narrative;
};

const extractUserPromptText = (record: JsonRecord): string | null => {
  const message = asRecord(record.message);
  const content = message?.content;

  if (typeof content === "string") {
    return content.trim() || null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const texts = content
    .map((block) => asRecord(block))
    .filter((block): block is JsonRecord => block !== null && block.type === "text")
    .map((block) => asString(block.text))
    .filter((text): text is string => text !== null && text.trim().length > 0);

  return texts.length > 0 ? texts.join(" ").trim() : null;
};

const describeToolInputBriefly = (input: unknown): string => {
  const record = asRecord(input);
  if (!record) {
    return "";
  }

  const filePath = asString(record.file_path) ?? asString(record.path);
  if (filePath) {
    return ` (${filePath})`;
  }

  const command = asString(record.command);
  if (command) {
    return ` (${command.length > 80 ? `${command.slice(0, 80)}…` : command})`;
  }

  return "";
};

const readPromptTemplate = (): string => {
  const promptDir = process.env.STARSHIP_PROMPT_DIR ?? path.join(getAppRoot(), "prompts");
  const filePath = path.join(promptDir, "briefing.md");

  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt template missing: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (content.trim().length === 0) {
    throw new Error(`Prompt template is empty: ${filePath}`);
  }

  return content;
};

const fillPromptTemplate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Prompt placeholder has no value: ${key}`);
    }
    return value;
  });

export const extractSummary = (raw: string): string | null => {
  const stripped = stripCodeFence(raw.trim());
  try {
    const parsed = JSON.parse(stripped) as unknown;
    const record = asRecord(parsed);
    const summary = record ? asString(record.summary) : null;
    return summary ? summary.trim() : null;
  } catch {
    return null;
  }
};

/**
 * The handoff half of the same response. Returns null rather than a partial
 * object whenever the shape isn't what the prompt asked for - a half-parsed
 * handoff would be worse than an honest degraded one, since the next agent
 * has no way to tell which parts it can trust.
 */
export const extractContinuity = (raw: string): ContinuitySections | null => {
  const stripped = stripCodeFence(raw.trim());
  try {
    const parsed = JSON.parse(stripped) as unknown;
    const record = asRecord(parsed);
    const continuity = record ? asRecord(record.continuity) : null;
    if (!continuity) {
      return null;
    }

    const whereThisIs = asString(continuity.whereThisIs);
    const next = asString(continuity.next);
    if (whereThisIs === null || next === null) {
      return null;
    }

    return {
      whereThisIs,
      thisSession: asStringArray(continuity.thisSession),
      decided: asStringArray(continuity.decided),
      never: asStringArray(continuity.never),
      next
    };
  } catch {
    return null;
  }
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

const stripCodeFence = (value: string): string => {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : value;
};

const getAppRoot = (): string => {
  if (app && typeof app.getAppPath === "function") {
    return app.getAppPath();
  }
  return process.cwd();
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
