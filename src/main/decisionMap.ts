import { app, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  DecisionEvidenceEntry,
  DecisionMapDownloadRequest,
  DecisionMapDownloadResponse,
  DecisionMapGenerateRequest,
  DecisionMapGenerateResponse,
  DecisionRecordCoverage,
  DecisionRecordEntry,
  DecisionRecordResult,
  DecisionReversibility,
  DecisionServesIntent
} from "../shared/ipc";
import { extractDatedHeadings, findAllTranscriptsForProject } from "./dashboard";
import type { StarshipDb } from "./db";
import { getHeadlessCwd, runHeadlessClaude } from "./inception/headlessClaude";
import { buildTaskReasoningTimelineForProject } from "./intentAnnotation";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const registerDecisionMapHandlers = (db: StarshipDb): void => {
  ipcMain.handle(
    "decisionMap:generate",
    async (_event, request: DecisionMapGenerateRequest): Promise<DecisionMapGenerateResponse> => {
      const result = await generateDecisionMap(db, request);
      const projectName =
        db.getProject(request.projectId)?.name ?? path.basename(request.projectPath);

      return {
        html: renderDecisionMapHtml(result, projectName),
        decisionCount: result.decisions.length,
        coverage: result.coverage,
        generatedAt: result.generatedAt
      };
    }
  );

  ipcMain.handle(
    "decisionMap:download",
    async (_event, request: DecisionMapDownloadRequest): Promise<DecisionMapDownloadResponse> => {
      const result = await dialog.showSaveDialog({
        title: "Save Decision Record",
        defaultPath: `${sanitizeFileName(request.projectName)}-decision-record.html`,
        filters: [{ name: "HTML", extensions: ["html"] }]
      });

      if (result.canceled || !result.filePath) {
        return { savedPath: null };
      }

      fs.writeFileSync(result.filePath, request.html, "utf8");
      return { savedPath: result.filePath };
    }
  );
};

const LOG_FILE_NAMES = ["PROJECT_LOG.md", "BACKFILL_LOG.md", "DATA_DICTIONARY.md"];

export type ProjectLogFile = { file: string; content: string };

/**
 * The project's own permanent, git-tracked record - the Decision Record's
 * spine. Tolerant of any subset missing (mirrors readPrdSummary's
 * try/catch-return pattern): a project with none of these still runs, just
 * transcript-only, with coverage saying so.
 */
export const readProjectLogs = (projectPath: string): ProjectLogFile[] => {
  const logs: ProjectLogFile[] = [];

  for (const file of LOG_FILE_NAMES) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(projectPath, file), "utf8");
    } catch {
      continue;
    }

    if (content.trim().length > 0) {
      logs.push({ file, content });
    }
  }

  return logs;
};

export type ReasoningCluster = {
  reasoning: string;
  occurrenceCount: number;
  sessionId: string;
};

const sessionIdFromTranscriptPath = (transcriptPath: string): string =>
  path.basename(transcriptPath, ".jsonl");

/**
 * Groups every TaskCreate-preceding reasoning string (buildTaskReasoningTimelineForProject,
 * already built for Intent annotation - reused unchanged) by exact text, so N work
 * items sharing one rationale (e.g. 26 "Player-level backfill: <season>" tasks
 * governed by one "newest season first" decision) become one candidate with
 * occurrenceCount: N, rather than N separate task titles. Entries with no
 * captured reasoning are dropped outright - no reasoning means nothing to
 * extract a decision from. TaskCreate content itself (the task labels) is
 * never used as decision content, only as the mechanism for finding and
 * counting the reasoning that governed it.
 */
export const buildReasoningClusters = (
  transcripts: { path: string }[]
): ReasoningCluster[] => {
  const timeline = buildTaskReasoningTimelineForProject(
    transcripts.map((transcript) => transcript.path)
  );

  const byReasoning = new Map<string, { occurrenceCount: number; sessionId: string }>();

  for (const entry of timeline) {
    const reasoning = entry.reasoning?.trim();
    if (!reasoning) {
      continue;
    }

    const existing = byReasoning.get(reasoning);
    if (existing) {
      existing.occurrenceCount += 1;
      continue;
    }

    const transcript = transcripts[entry.sessionIndex];
    byReasoning.set(reasoning, {
      occurrenceCount: 1,
      sessionId: transcript ? sessionIdFromTranscriptPath(transcript.path) : "unknown"
    });
  }

  return Array.from(byReasoning.entries()).map(([reasoning, value]) => ({
    reasoning,
    occurrenceCount: value.occurrenceCount,
    sessionId: value.sessionId
  }));
};

export type DecisionExcerpt = {
  sessionId: string;
  userQuestion: string | null;
  assistantText: string;
};

/**
 * Phrases decisions tend to announce themselves with - used only to locate
 * high-signal passages worth handing to the model, never as the extraction
 * itself. Deliberately a wide net (some of these, like "instead of", are
 * common enough to over-match): over-collection here is cheap, since every
 * candidate still has to pass the model's own judgment and this module's
 * verbatim-evidence check before becoming a decision. "bad idea" was missing
 * from an earlier pass despite being named explicitly in the brief's own
 * blind-spot description - confirmed live: it's the exact phrase the
 * flagship parallel-vs-sequential backfill decision actually used
 * ("parallel backfill runs specifically are a bad idea for two separate
 * reasons"), and its absence meant that decision never surfaced at all.
 */
const DECISION_LANGUAGE_PATTERNS = [
  "one real decision to flag",
  "let me flag one real risk before",
  "this needs your input",
  "bad idea",
  "i'd suggest",
  "the tradeoff is",
  "instead of",
  "rather than"
];

const containsDecisionLanguage = (text: string): boolean => {
  const lower = text.toLowerCase();
  return DECISION_LANGUAGE_PATTERNS.some((pattern) => lower.includes(pattern));
};

const EXCERPT_WINDOW = 1500;

/**
 * A window of `text` centered on whichever decision-language phrase matched,
 * not just the first EXCERPT_WINDOW characters - a match near the end of a
 * long turn would otherwise be truncated away entirely.
 */
const windowAroundMatch = (text: string): string => {
  if (text.length <= EXCERPT_WINDOW) {
    return text;
  }

  const lower = text.toLowerCase();
  const matchIndexes = DECISION_LANGUAGE_PATTERNS.map((pattern) => lower.indexOf(pattern)).filter(
    (index) => index !== -1
  );
  const center = matchIndexes.length > 0 ? Math.min(...matchIndexes) : 0;
  const half = Math.floor(EXCERPT_WINDOW / 2);
  const start = Math.max(0, center - half);
  return text.slice(start, Math.min(text.length, start + EXCERPT_WINDOW));
};

/**
 * The blind spot this rebuild exists to fix: assistant text using
 * decision-sounding language, independent of whether any TaskCreate is
 * nearby (the parallel-vs-sequential backfill decision was never a task -
 * it was a direct answer to "can we explore parallel run?"). A preceding
 * human-typed question is attached for context when one exists, using a
 * detection rule confirmed against a real transcript: a "user" record with a
 * plain-string message and `origin.kind === "human"`. This is deliberately
 * distinct from the two other same-shape "user" records real transcripts
 * contain - `tool_result` envelopes (structured content, not a plain string)
 * and `<task-notification>` background-task messages (plain string, but
 * `origin.kind: "task-notification"`) - so neither is ever mistaken for a
 * genuine question the builder typed.
 */
export const findDecisionLanguageExcerpts = (
  transcripts: { path: string }[]
): DecisionExcerpt[] => {
  const excerpts: DecisionExcerpt[] = [];

  for (const transcript of transcripts) {
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(transcript.path, "utf8");
    } catch {
      continue;
    }

    const sessionId = sessionIdFromTranscriptPath(transcript.path);
    let mostRecentHumanQuestion: string | null = null;

    for (const line of fileContent.split("\n")) {
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
        const message = asRecord(record.message);
        const messageContent = message?.content;
        const origin = asRecord(record.origin);
        if (typeof messageContent === "string" && origin?.kind === "human") {
          mostRecentHumanQuestion = messageContent.trim();
        }
        continue;
      }

      if (record.type !== "assistant") {
        continue;
      }

      const message = asRecord(record.message);
      const contentBlocks = message?.content;
      if (!Array.isArray(contentBlocks)) {
        continue;
      }

      for (const block of contentBlocks) {
        const blockRecord = asRecord(block);
        if (!blockRecord || blockRecord.type !== "text") {
          continue;
        }

        const text = asString(blockRecord.text);
        if (!text || !containsDecisionLanguage(text)) {
          continue;
        }

        excerpts.push({
          sessionId,
          userQuestion: mostRecentHumanQuestion,
          assistantText: windowAroundMatch(text.trim())
        });
      }
    }
  }

  return excerpts;
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const containsVerbatim = (source: string, anchor: string): boolean =>
  normalizeWhitespace(source).includes(normalizeWhitespace(anchor));

const buildLogRef = (file: string, date: string | null): string => (date ? `${file}#${date}` : file);

/**
 * The dated heading immediately before where `anchor` appears in `log`, or
 * null if the log has no dated headings at all (DATA_DICTIONARY.md) or the
 * anchor sits before the first one. Never guesses a date it can't locate.
 */
const dateForLogAnchor = (log: ProjectLogFile, anchor: string): string | null => {
  const anchorIndex = log.content.indexOf(anchor);
  if (anchorIndex === -1) {
    return null;
  }

  const headings = extractDatedHeadings(log.content);
  if (headings.length === 0) {
    return null;
  }

  const linesBeforeAnchor = log.content.slice(0, anchorIndex).split(/\r?\n/).length - 1;
  let latestBefore: string | null = null;
  for (const heading of headings) {
    if (heading.lineIndex > linesBeforeAnchor) {
      break;
    }
    latestBefore = heading.date;
  }

  return latestBefore;
};

type RawEvidence =
  | { source: "log"; file: string; anchor: string }
  | { source: "transcript"; sessionId: string; anchor: string };

type RawDecision = {
  chose: string;
  over: string;
  because: string;
  evidence: RawEvidence[];
  servesIntent: DecisionServesIntent | null;
  reversible: DecisionReversibility | null;
  collapsed: number;
  supersedesChose: string | null;
  isRecapOnly: boolean;
};

const SERVES_INTENT_RECORD_VALUES: DecisionServesIntent[] = [
  "purpose",
  "successCriteria",
  "acceptedTradeoffs",
  "neverDo"
];

const REVERSIBILITY_VALUES: DecisionReversibility[] = ["cheap", "load-bearing"];

/**
 * Code-side enforcement of "because - two sentences maximum" - the prompt
 * asks for this, but a model doesn't always comply, and this rule exists to
 * protect altitude discipline, not to be optional. Sentence-splitting is a
 * light heuristic (naive on abbreviations/decimals), not full NLP - good
 * enough to cap length without rejecting an otherwise-valid decision over it.
 */
const truncateToTwoSentences = (text: string): string => {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!sentences || sentences.length <= 2) {
    return text;
  }
  return sentences.slice(0, 2).join("").trim();
};

const parseRawEvidence = (entry: JsonRecord): RawEvidence | null => {
  const source = asString(entry.source);
  const anchor = asString(entry.anchor)?.trim();
  if (!anchor || (source !== "log" && source !== "transcript")) {
    return null;
  }

  if (source === "log") {
    const file = asString(entry.file)?.trim();
    return file ? { source: "log", file, anchor } : null;
  }

  const sessionId = asString(entry.sessionId)?.trim();
  return sessionId ? { source: "transcript", sessionId, anchor } : null;
};

/**
 * `over`/`chose`/`because` empty -> null here, which drops the whole raw
 * decision before it's ever considered - this is rejection rule 1 ("no
 * stated alternative -> no node") enforced at parse time, not left to the
 * model's self-policing.
 */
const parseRawDecision = (entry: JsonRecord): RawDecision | null => {
  const chose = asString(entry.chose)?.trim();
  const over = asString(entry.over)?.trim();
  const becauseRaw = asString(entry.because)?.trim();
  if (!chose || !over || !becauseRaw) {
    return null;
  }
  const because = truncateToTwoSentences(becauseRaw);

  const evidence = Array.isArray(entry.evidence)
    ? entry.evidence
        .map((item) => asRecord(item))
        .filter((item): item is JsonRecord => item !== null)
        .map((item) => parseRawEvidence(item))
        .filter((item): item is RawEvidence => item !== null)
    : [];

  const servesIntentRaw = asString(entry.servesIntent);
  const servesIntent = SERVES_INTENT_RECORD_VALUES.includes(
    servesIntentRaw as DecisionServesIntent
  )
    ? (servesIntentRaw as DecisionServesIntent)
    : null;

  const reversibleRaw = asString(entry.reversible);
  const reversible = REVERSIBILITY_VALUES.includes(reversibleRaw as DecisionReversibility)
    ? (reversibleRaw as DecisionReversibility)
    : null;

  const collapsedRaw = entry.collapsed;
  const collapsed =
    typeof collapsedRaw === "number" && Number.isFinite(collapsedRaw)
      ? Math.max(1, Math.round(collapsedRaw))
      : 1;

  return {
    chose,
    over,
    because,
    evidence,
    servesIntent,
    reversible,
    collapsed,
    supersedesChose: asString(entry.supersedesChose)?.trim() || null,
    isRecapOnly: entry.isRecapOnly === true
  };
};

const extractDecisionResponse = (raw: string): RawDecision[] | null => {
  const stripped = stripCodeFence(raw.trim());
  try {
    const parsed = JSON.parse(stripped) as unknown;
    const record = asRecord(parsed);
    if (!record || !Array.isArray(record.decisions)) {
      return null;
    }

    return record.decisions
      .map((entry) => asRecord(entry))
      .filter((entry): entry is JsonRecord => entry !== null)
      .map((entry) => parseRawDecision(entry))
      .filter((entry): entry is RawDecision => entry !== null);
  } catch {
    return null;
  }
};

/**
 * The real enforcement of rejection rule 2 ("no evidence anchor -> no
 * node"): checks the model's claimed anchor against the exact source it says
 * it came from, not just that some anchor string was present. A decision
 * with one valid and one invalid evidence entry keeps only the valid one; a
 * decision with none valid is dropped entirely by the caller.
 */
const verifyEvidence = (
  raw: RawEvidence,
  logs: ProjectLogFile[],
  clusters: ReasoningCluster[],
  excerpts: DecisionExcerpt[]
): DecisionEvidenceEntry | null => {
  if (raw.source === "log") {
    const log = logs.find((entry) => entry.file === raw.file);
    if (!log || !containsVerbatim(log.content, raw.anchor)) {
      return null;
    }

    return { source: "log", ref: buildLogRef(raw.file, dateForLogAnchor(log, raw.anchor)), anchor: raw.anchor };
  }

  const inCluster = clusters.some(
    (cluster) => cluster.sessionId === raw.sessionId && containsVerbatim(cluster.reasoning, raw.anchor)
  );
  const inExcerpt = excerpts.some(
    (excerpt) =>
      excerpt.sessionId === raw.sessionId &&
      (containsVerbatim(excerpt.assistantText, raw.anchor) ||
        (excerpt.userQuestion !== null && containsVerbatim(excerpt.userQuestion, raw.anchor)))
  );

  return inCluster || inExcerpt
    ? { source: "transcript", ref: raw.sessionId, anchor: raw.anchor }
    : null;
};

const CHEAP_LANGUAGE = /\b(later|can be added|without rework|non-destructive|deferr?ed?)\b/i;
const LOAD_BEARING_LANGUAGE =
  /\b(load-bearing|hard to (reverse|undo|unwind)|costly to (reverse|undo|change)|would require (a |significant )?rewrite|locks? (us|you|the project)? ?into|irreversible|no going back|can'?t be undone|cannot be undone)\b/i;

/**
 * Light sanity net for rule "reversible only when the session states it,
 * never inferred": rejects the clearest hallucinations (a reversible tag
 * with no matching reversibility language anywhere in its own evidence)
 * without claiming to perfectly verify a semantic judgment. Checks against
 * vocabulary matching the CLAIMED tag, not one shared pattern - "cheap" and
 * "load-bearing" are opposite claims and need opposite evidence; a single
 * cheap-leaning regex applied to both would mean "load-bearing" could only
 * ever survive by the evidence text accidentally also containing a
 * cheap-sounding word, which is nonsensical.
 */
const evidenceStatesReversibility = (
  evidence: DecisionEvidenceEntry[],
  tag: DecisionReversibility
): boolean => {
  const pattern = tag === "cheap" ? CHEAP_LANGUAGE : LOAD_BEARING_LANGUAGE;
  return evidence.some((entry) => pattern.test(entry.anchor));
};

const isoDateFromMillis = (mtimeMs: number): string => new Date(mtimeMs).toISOString().slice(0, 10);

const resolveDecisionDate = (
  evidence: DecisionEvidenceEntry[],
  sessionDates: Map<string, string>
): string | null => {
  const dates = evidence
    .map((entry) =>
      entry.source === "log" ? entry.ref.split("#")[1] ?? null : sessionDates.get(entry.ref) ?? null
    )
    .filter((date): date is string => date !== null);

  return dates.length > 0 ? dates.reduce((earliest, date) => (date < earliest ? date : earliest)) : null;
};

const sortMostRecentFirst = (decisions: DecisionRecordEntry[]): DecisionRecordEntry[] =>
  [...decisions].sort((a, b) => {
    if (a.date === b.date) return 0;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? 1 : -1;
  });

const buildValidatedDecisions = (
  rawDecisions: RawDecision[],
  logs: ProjectLogFile[],
  clusters: ReasoningCluster[],
  excerpts: DecisionExcerpt[],
  sessionDates: Map<string, string>,
  hasLedger: boolean
): DecisionRecordEntry[] => {
  type Draft = DecisionRecordEntry & { supersedesChose: string | null };
  const drafts: Draft[] = [];

  rawDecisions
    .filter((raw) => !raw.isRecapOnly) // rule 4: a recap belongs to the session it recaps, not this one
    .forEach((raw, index) => {
      const evidence = raw.evidence
        .map((item) => verifyEvidence(item, logs, clusters, excerpts))
        .filter((item): item is DecisionEvidenceEntry => item !== null);

      if (evidence.length === 0) {
        return;
      }

      drafts.push({
        id: `decision-${index}`,
        chose: raw.chose,
        over: raw.over,
        because: raw.because,
        evidence,
        servesIntent: hasLedger ? raw.servesIntent : null,
        reversible:
          raw.reversible && evidenceStatesReversibility(evidence, raw.reversible) ? raw.reversible : null,
        collapsed: raw.collapsed,
        supersedes: null,
        date: resolveDecisionDate(evidence, sessionDates),
        supersedesChose: raw.supersedesChose
      });
    });

  const idByChose = new Map(drafts.map((draft) => [draft.chose, draft.id]));
  const resolved = drafts.map((draft) => {
    const { supersedesChose, ...entry } = draft;
    const supersedes =
      supersedesChose && supersedesChose !== draft.chose ? idByChose.get(supersedesChose) ?? null : null;
    return { ...entry, supersedes };
  });

  return sortMostRecentFirst(resolved);
};

// headlessClaude.ts pipes the prompt over stdin, not a CLI argument, so this
// is no longer bounded by Windows's ~32K command-line limit (that was the
// original reason for a tight budget here, before the stdin fix). This still
// exists to bound headless-call cost/latency for a pathological project.
//
// 120,000 was tried first and was still too tight in practice: NoFlightZone's
// three real log files alone are ~100,000 characters once JSON-serialized,
// which left almost no room for transcript excerpts - and because
// boundForPrompt drops the OLDEST excerpts first (lowest priority under
// budget pressure), the one older session holding the flagship
// parallel-vs-sequential decision this whole rebuild was designed around got
// dropped entirely, while only the newest session's excerpts survived. Raised
// to comfortably fit a real dense project's full logs AND all its transcript
// excerpts without dropping anything, while still bounding a truly
// pathological project (e.g. logs an order of magnitude larger than this).
export const PROMPT_PAYLOAD_BUDGET = 250000;

const payloadSize = (payload: unknown): number => JSON.stringify(payload).length;

type PromptCandidates = { logs: ProjectLogFile[]; clusters: ReasoningCluster[]; excerpts: DecisionExcerpt[] };

/**
 * Fits candidates within PROMPT_PAYLOAD_BUDGET, dropping lowest-priority
 * material first: oldest excerpts, then oldest clusters, and only as a last
 * resort truncating log content itself (kept from the END of each file -
 * these logs are written chronologically, newest at the bottom, so the tail
 * is the most relevant text to keep). The returned, possibly-bounded arrays
 * are used for BOTH the prompt and evidence validation - a decision can
 * never be "verified" against text the model was never actually shown.
 */
export const boundForPrompt = (
  logs: ProjectLogFile[],
  clusters: ReasoningCluster[],
  excerpts: DecisionExcerpt[]
): PromptCandidates => {
  let boundedExcerpts = excerpts;
  let boundedClusters = clusters;
  let boundedLogs = logs;

  const fits = (): boolean =>
    payloadSize({ logs: boundedLogs, reasoningClusters: boundedClusters, excerpts: boundedExcerpts }) <=
    PROMPT_PAYLOAD_BUDGET;

  while (!fits() && boundedExcerpts.length > 0) {
    boundedExcerpts = boundedExcerpts.slice(1);
  }

  while (!fits() && boundedClusters.length > 0) {
    boundedClusters = boundedClusters.slice(1);
  }

  if (!fits() && boundedLogs.length > 0) {
    const perFileBudget = Math.max(500, Math.floor(PROMPT_PAYLOAD_BUDGET / boundedLogs.length));
    boundedLogs = boundedLogs.map((log) => ({
      file: log.file,
      content:
        log.content.length <= perFileBudget
          ? log.content
          : log.content.slice(log.content.length - perFileBudget)
    }));
  }

  return { logs: boundedLogs, clusters: boundedClusters, excerpts: boundedExcerpts };
};

const computeCoverage = (
  decisions: DecisionRecordEntry[],
  logs: ProjectLogFile[],
  transcripts: { mtimeMs: number }[]
): Omit<DecisionRecordCoverage, "extractionError"> => {
  const fromLogs = decisions.filter((entry) => entry.evidence.some((e) => e.source === "log")).length;
  const fromTranscript = decisions.filter((entry) =>
    entry.evidence.some((e) => e.source === "transcript")
  ).length;

  const headingDates = logs.flatMap((log) => extractDatedHeadings(log.content).map((h) => h.date));
  const logsDateRange =
    headingDates.length > 0
      ? {
          earliest: headingDates.reduce((a, b) => (a < b ? a : b)),
          latest: headingDates.reduce((a, b) => (a > b ? a : b))
        }
      : null;

  const transcriptDates = transcripts.map((t) => isoDateFromMillis(t.mtimeMs));
  const transcriptDateRange =
    transcriptDates.length > 0
      ? {
          earliest: transcriptDates.reduce((a, b) => (a < b ? a : b)),
          latest: transcriptDates.reduce((a, b) => (a > b ? a : b))
        }
      : null;

  return {
    totalDecisions: decisions.length,
    fromLogs,
    fromTranscript,
    hasProjectLogs: logs.length > 0,
    logsDateRange,
    transcriptDateRange,
    transcriptCoveragePartial:
      logsDateRange !== null &&
      transcriptDateRange !== null &&
      transcriptDateRange.earliest > logsDateRange.earliest
  };
};

const describeExtractionError = (
  error: unknown,
  logCount: number,
  clusterCount: number,
  excerptCount: number
): string =>
  `${stringifyError(error)} - ${logCount} log file(s), ${clusterCount} reasoning cluster(s), and ${excerptCount} transcript excerpt(s) were found but couldn't be structured into decisions this time.`;

/**
 * The whole project's decision history, sourced from its own git-tracked
 * logs (the spine) plus selective transcript reading that fills one named
 * gap: decisions that arose from a direct question mid-session and never
 * reached a log entry. One click-triggered, cached headless call per
 * generation - never a sweep of raw transcript text, never a loop.
 */
export const generateDecisionMap = async (
  db: StarshipDb,
  request: DecisionMapGenerateRequest
): Promise<DecisionRecordResult> => {
  const generatedAt = new Date().toISOString();

  const logs = readProjectLogs(request.projectPath);
  const transcripts = findAllTranscriptsForProject(request.projectPath);
  const clusters = transcripts.length > 0 ? buildReasoningClusters(transcripts) : [];
  const excerpts = transcripts.length > 0 ? findDecisionLanguageExcerpts(transcripts) : [];

  if (logs.length === 0 && clusters.length === 0 && excerpts.length === 0) {
    return {
      decisions: [],
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
      generatedAt
    };
  }

  const ledger = db.getIntentLedger(request.projectId);
  const sessionDates = new Map(
    transcripts.map((transcript) => [
      sessionIdFromTranscriptPath(transcript.path),
      isoDateFromMillis(transcript.mtimeMs)
    ])
  );

  // Bound BEFORE building the prompt, and reuse the exact same bounded
  // arrays for evidence validation below - whatever the model was actually
  // shown is the only thing an anchor can ever be verified against.
  const bounded = boundForPrompt(logs, clusters, excerpts);

  try {
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
          logs: bounded.logs.map((log) => ({ file: log.file, content: log.content })),
          reasoningClusters: bounded.clusters.map((cluster) => ({
            reasoning: cluster.reasoning,
            occurrenceCount: cluster.occurrenceCount,
            sessionId: cluster.sessionId
          })),
          excerpts: bounded.excerpts.map((excerpt) => ({
            sessionId: excerpt.sessionId,
            userQuestion: excerpt.userQuestion,
            assistantText: excerpt.assistantText
          }))
        },
        null,
        2
      )
    });

    const raw = await runHeadlessClaude(db, {
      cacheNamespace: "decision-map",
      prompt,
      cwd: getHeadlessCwd()
    });

    const rawDecisions = extractDecisionResponse(raw) ?? [];
    const decisions = buildValidatedDecisions(
      rawDecisions,
      bounded.logs,
      bounded.clusters,
      bounded.excerpts,
      sessionDates,
      ledger !== null
    );

    return {
      decisions,
      coverage: { ...computeCoverage(decisions, logs, transcripts), extractionError: null },
      generatedAt
    };
  } catch (error) {
    return {
      decisions: [],
      coverage: {
        ...computeCoverage([], logs, transcripts),
        extractionError: describeExtractionError(error, logs.length, clusters.length, excerpts.length)
      },
      generatedAt
    };
  }
};

const stripCodeFence = (value: string): string => {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : value;
};

const readPromptTemplate = (): string => {
  const promptDir = process.env.STARSHIP_PROMPT_DIR ?? path.join(getAppRoot(), "prompts");
  const filePath = path.join(promptDir, "decision-map.md");

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

const getAppRoot = (): string => {
  if (app && typeof app.getAppPath === "function") {
    return app.getAppPath();
  }
  return process.cwd();
};

const sanitizeFileName = (value: string): string => {
  const sanitized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").trim();
  return sanitized.length > 0 ? sanitized : "project";
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const formatDateRangeText = (range: { earliest: string; latest: string } | null): string =>
  range ? `${range.earliest} to ${range.latest}` : "none found";

const renderCoverageMeta = (coverage: DecisionRecordCoverage, generatedAt: string): string => {
  const plural = coverage.totalDecisions === 1 ? "" : "s";
  const lines: string[] = [];

  lines.push(
    `<div><strong>${coverage.totalDecisions}</strong> decision${plural} — ${coverage.fromLogs} from this project's own logs, ${coverage.fromTranscript} from session transcripts. Generated ${escapeHtml(generatedAt)}.</div>`
  );

  lines.push(
    coverage.hasProjectLogs
      ? `<div>Logs cover ${escapeHtml(formatDateRangeText(coverage.logsDateRange))}.</div>`
      : `<div>No project logs found (PROJECT_LOG.md / BACKFILL_LOG.md / DATA_DICTIONARY.md) — this record is transcript-only.</div>`
  );

  const partialNote =
    coverage.transcriptCoveragePartial && coverage.logsDateRange
      ? ` Older sessions appear to have been cleaned up before ${escapeHtml(coverage.logsDateRange.earliest)} — transcript enrichment before then is likely incomplete.`
      : "";
  lines.push(
    `<div>Session transcripts on disk cover ${escapeHtml(formatDateRangeText(coverage.transcriptDateRange))}.${partialNote}</div>`
  );

  return lines.join("\n");
};

const renderErrorBanner = (coverage: DecisionRecordCoverage): string =>
  coverage.extractionError
    ? `<div class="error-banner">Extraction failed: ${escapeHtml(coverage.extractionError)}</div>`
    : "";

export const renderDecisionMapHtml = (result: DecisionRecordResult, projectName: string): string => {
  const data = serializeJsonForScript({ decisions: result.decisions });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(projectName)} Decision Record</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #09090b;
      --panel: #18181b;
      --line: #3f3f46;
      --text: #f4f4f5;
      --muted: #a1a1aa;
      --soft: #27272a;
      --accent: #38bdf8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header { padding: 20px 24px 14px; border-bottom: 1px solid var(--soft); }
    h1 { margin: 0; font-size: 18px; font-weight: 700; }
    .meta { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.6; }
    .meta strong { color: var(--text); }
    .error-banner {
      margin-top: 10px;
      padding: 8px 12px;
      border: 1px solid #f59e0b55;
      background: #f59e0b15;
      border-radius: 6px;
      color: #fbbf24;
      font-size: 12px;
    }
    .modes { display: flex; gap: 6px; margin-top: 12px; }
    .modes button {
      appearance: none;
      border: 1px solid var(--soft);
      background: var(--panel);
      color: var(--muted);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
    }
    .modes button.active { border-color: var(--accent); color: var(--text); }
    .wrap {
      display: grid;
      grid-template-rows: 1fr auto;
      height: calc(100vh - 190px);
      min-height: 420px;
    }
    .stage { overflow: auto; padding: 16px 24px; }
    .empty {
      display: grid;
      height: 100%;
      place-items: center;
      padding: 24px;
      color: var(--muted);
      text-align: center;
      font-size: 13px;
    }
    .group-label {
      margin: 18px 0 8px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    .group-label:first-child { margin-top: 0; }
    .card {
      border: 1px solid var(--soft);
      background: var(--panel);
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 10px;
      cursor: pointer;
    }
    .card:hover { border-color: var(--accent); }
    .card .chose { font-size: 16px; font-weight: 600; color: var(--text); }
    .card .over { margin-top: 3px; font-size: 13px; color: var(--muted); }
    .card .because { margin-top: 6px; font-size: 13px; color: #d4d4d8; line-height: 1.5; }
    .tags { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
    .tag {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--soft);
      color: var(--muted);
    }
    .tag.intent { border-color: var(--accent); color: var(--accent); }
    .tag.collapsed { border-color: #52525b; color: #a1a1aa; }
    .tag.reversible-cheap { border-color: #4ade80; color: #4ade80; }
    .tag.reversible-load-bearing { border-color: #f59e0b; color: #f59e0b; }
    .supersedes { margin-top: 6px; font-size: 11px; color: var(--muted); font-style: italic; }
    .detail {
      border-top: 1px solid var(--soft);
      background: #111113;
      padding: 14px 24px;
      min-height: 72px;
      max-height: 220px;
      overflow: auto;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .detail strong { color: var(--text); }
    .detail .evidence-item {
      margin-top: 8px;
      padding: 8px 10px;
      background: #0f0f12;
      border: 1px solid var(--soft);
      border-radius: 6px;
    }
    .detail .evidence-ref { font-size: 11px; color: var(--accent); margin-bottom: 4px; }
    .detail .evidence-anchor { font-size: 12px; color: #d4d4d8; white-space: pre-wrap; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(projectName)} Decision Record</h1>
    <div class="meta">
      ${renderCoverageMeta(result.coverage, result.generatedAt)}
    </div>
    ${renderErrorBanner(result.coverage)}
    <div class="modes" id="modes">
      <button type="button" data-mode="recent" class="active">Recent</button>
      <button type="button" data-mode="sessions">Sessions</button>
      <button type="button" data-mode="intent">Intent Lanes</button>
    </div>
  </header>
  <div class="wrap">
    <div class="stage" id="stage"></div>
    <div class="detail" id="detail"><strong>Decision details</strong></div>
  </div>
  <script>
    const data = ${data};
    const stage = document.getElementById("stage");
    const detail = document.getElementById("detail");
    const modesEl = document.getElementById("modes");
    const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

    const INTENT_LABELS = {
      purpose: "Purpose",
      successCriteria: "Success Criteria",
      acceptedTradeoffs: "Accepted Tradeoff",
      neverDo: "Never Do"
    };

    const byId = new Map(data.decisions.map((d) => [d.id, d]));
    let currentMode = "recent";

    function cardHtml(decision) {
      const tags = [];
      if (decision.servesIntent) {
        tags.push('<span class="tag intent">' + esc(INTENT_LABELS[decision.servesIntent] || decision.servesIntent) + '</span>');
      }
      if (decision.reversible) {
        tags.push('<span class="tag reversible-' + decision.reversible + '">' + esc(decision.reversible) + '</span>');
      }
      if (decision.collapsed > 1) {
        tags.push('<span class="tag collapsed">\\u00d7' + decision.collapsed + '</span>');
      }

      const supersedesTarget = decision.supersedes ? byId.get(decision.supersedes) : null;
      const supersedesLine = supersedesTarget
        ? '<div class="supersedes">Supersedes: ' + esc(supersedesTarget.chose) + '</div>'
        : '';

      return '<div class="card" data-id="' + esc(decision.id) + '">' +
        '<div class="chose">' + esc(decision.chose) + '</div>' +
        '<div class="over">instead of ' + esc(decision.over) + '</div>' +
        '<div class="because">' + esc(decision.because) + '</div>' +
        (tags.length ? '<div class="tags">' + tags.join("") + '</div>' : '') +
        supersedesLine +
        '</div>';
    }

    function groupLabelHtml(label) {
      return '<div class="group-label">' + esc(label) + '</div>';
    }

    function render() {
      Array.from(modesEl.children).forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === currentMode));

      if (data.decisions.length === 0) {
        stage.innerHTML = '<div class="empty">No decisions captured yet - this fills in as sessions run and the project\\'s logs grow.</div>';
        return;
      }

      let html = "";
      if (currentMode === "recent") {
        html = data.decisions.map(cardHtml).join("");
      } else if (currentMode === "sessions") {
        const order = [];
        const bySession = new Map();
        data.decisions.forEach((d) => {
          const transcriptEvidence = d.evidence.find((e) => e.source === "transcript");
          const key = transcriptEvidence ? transcriptEvidence.ref : "Logged, no session";
          if (!bySession.has(key)) {
            bySession.set(key, []);
            order.push(key);
          }
          bySession.get(key).push(d);
        });
        html = order.map((key) => groupLabelHtml(key) + bySession.get(key).map(cardHtml).join("")).join("");
      } else if (currentMode === "intent") {
        const order = ["purpose", "successCriteria", "acceptedTradeoffs", "neverDo", null];
        html = order.map((key) => {
          const items = data.decisions.filter((d) => d.servesIntent === key);
          if (items.length === 0) return "";
          return groupLabelHtml(key ? INTENT_LABELS[key] : "Unattributed") + items.map(cardHtml).join("");
        }).join("");
      }

      stage.innerHTML = html;

      stage.querySelectorAll(".card").forEach((el) => {
        el.addEventListener("click", () => {
          const decision = byId.get(el.getAttribute("data-id"));
          if (!decision) return;

          let detailHtml = '<strong>' + esc(decision.chose) + '</strong>';
          decision.evidence.forEach((entry) => {
            const refLabel = entry.source === "log" ? entry.ref : "session " + entry.ref;
            detailHtml += '<div class="evidence-item"><div class="evidence-ref">' + esc(refLabel) + '</div><div class="evidence-anchor">' + esc(entry.anchor) + '</div></div>';
          });
          detail.innerHTML = detailHtml;
        });
      });
    }

    modesEl.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      currentMode = button.dataset.mode;
      render();
    });

    render();
  </script>
</body>
</html>`;
};

const serializeJsonForScript = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c");

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return map[char];
  });
