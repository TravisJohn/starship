import { app, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  NarrativeJourneyChapter,
  NarrativeJourneyDownloadRequest,
  NarrativeJourneyDownloadResponse,
  NarrativeJourneyGenerateRequest,
  NarrativeJourneyGenerateResponse,
  NarrativeJourneyResult
} from "../shared/ipc";
import type { StarshipDb } from "./db";
import { getHeadlessCwd, runHeadlessClaude } from "./inception/headlessClaude";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const registerNarrativeJourneyHandlers = (db: StarshipDb): void => {
  ipcMain.handle(
    "narrativeJourney:generate",
    async (
      _event,
      request: NarrativeJourneyGenerateRequest
    ): Promise<NarrativeJourneyGenerateResponse> => {
      const result = await generateNarrativeJourney(db, request);
      const projectName =
        db.getProject(request.projectId)?.name ?? path.basename(request.projectPath);

      return {
        chapters: result.chapters,
        markdown: renderNarrativeJourneyMarkdown(result, projectName),
        generatedAt: result.generatedAt
      };
    }
  );

  ipcMain.handle(
    "narrativeJourney:download",
    async (
      _event,
      request: NarrativeJourneyDownloadRequest
    ): Promise<NarrativeJourneyDownloadResponse> => {
      const result = await dialog.showSaveDialog({
        title: "Save Narrative Journey",
        defaultPath: `${sanitizeFileName(request.projectName)}-narrative-journey.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }]
      });

      if (result.canceled || !result.filePath) {
        return { savedPath: null };
      }

      fs.writeFileSync(result.filePath, request.markdown, "utf8");
      return { savedPath: result.filePath };
    }
  );
};

/**
 * The project's whole history as one story, not a per-session list
 * (Timeline) or a graph (Decision Map). Reuses briefing_history's rows
 * directly - each is already a decision-altitude summary of one session
 * (from Exit & Summarize's own headless pass) - so this is a "summary of
 * summaries" rather than re-deriving anything from raw transcripts. Same
 * graceful-degradation posture as the rest of Starship: no history yet ->
 * empty chapters; headless failure -> one plain, honest chapter saying so.
 */
export const generateNarrativeJourney = async (
  db: StarshipDb,
  request: NarrativeJourneyGenerateRequest
): Promise<NarrativeJourneyResult> => {
  const generatedAt = new Date().toISOString();

  const history = db.listBriefingHistory(request.projectId);
  if (history.length === 0) {
    return { chapters: [], generatedAt };
  }

  const ledger = db.getIntentLedger(request.projectId);

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
          sessions: history.map((entry) => ({
            summary: entry.summary,
            date: entry.createdAt
          }))
        },
        null,
        2
      )
    });

    const raw = await runHeadlessClaude(db, {
      cacheNamespace: "narrative-journey",
      prompt,
      cwd: getHeadlessCwd()
    });

    const chapters = extractChapters(raw);
    if (chapters.length === 0) {
      throw new Error("Headless call returned no usable chapters.");
    }

    return { chapters, generatedAt };
  } catch (error) {
    return {
      chapters: [
        {
          title: "Journey",
          narrative: `The story couldn't be generated right now: ${stringifyError(error)}`
        }
      ],
      generatedAt
    };
  }
};

const extractChapters = (raw: string): NarrativeJourneyChapter[] => {
  const stripped = stripCodeFence(raw.trim());
  try {
    const parsed = JSON.parse(stripped) as unknown;
    const record = asRecord(parsed);
    if (!record || !Array.isArray(record.chapters)) {
      return [];
    }

    return record.chapters
      .map((entry) => asRecord(entry))
      .filter((entry): entry is JsonRecord => entry !== null)
      .map((entry) => ({
        title: asString(entry.title)?.trim() ?? "",
        narrative: asString(entry.narrative)?.trim() ?? ""
      }))
      .filter((chapter) => chapter.title.length > 0 && chapter.narrative.length > 0);
  } catch {
    return [];
  }
};

export const renderNarrativeJourneyMarkdown = (
  result: NarrativeJourneyResult,
  projectName: string
): string => {
  if (result.chapters.length === 0) {
    return `# ${projectName} — Narrative Journey\n\nNo sessions recorded yet.\n`;
  }

  const body = result.chapters
    .map((chapter) => `## ${chapter.title}\n\n${chapter.narrative}`)
    .join("\n\n");

  return `# ${projectName} — Narrative Journey\n\n${body}\n`;
};

const stripCodeFence = (value: string): string => {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : value;
};

const readPromptTemplate = (): string => {
  const promptDir = process.env.STARSHIP_PROMPT_DIR ?? path.join(getAppRoot(), "prompts");
  const filePath = path.join(promptDir, "narrative-journey.md");

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
