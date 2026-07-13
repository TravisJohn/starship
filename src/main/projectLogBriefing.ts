import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  ProjectLogSummarizeRequest,
  ProjectLogSummarizeResponse
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

export const registerProjectLogBriefingHandlers = (db: StarshipDb): void => {
  ipcMain.handle(
    "projectLog:summarize",
    async (
      _event,
      request: ProjectLogSummarizeRequest
    ): Promise<ProjectLogSummarizeResponse> => {
      const { summary } = await generateProjectLogBriefing(db, request);
      return { summary };
    }
  );
};

export const generateProjectLogBriefing = async (
  db: StarshipDb,
  request: { title: string; body: string }
): Promise<{ summary: string }> => {
  const fallback = request.body.trim();

  try {
    const prompt = fillPromptTemplate(readPromptTemplate(), {
      payload_json: JSON.stringify(
        {
          title: request.title,
          body: request.body
        },
        null,
        2
      )
    });
    const raw = await runHeadlessClaude(db, {
      cacheNamespace: "project-log-summary",
      prompt,
      cwd: getHeadlessCwd()
    });
    const summary = extractSummary(raw);
    return { summary: summary ?? fallback };
  } catch {
    return { summary: fallback };
  }
};

const readPromptTemplate = (): string => {
  const promptDir = process.env.STARSHIP_PROMPT_DIR ?? path.join(getAppRoot(), "prompts");
  const filePath = path.join(promptDir, "project-log-summary.md");

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

const extractSummary = (raw: string): string | null => {
  const stripped = stripCodeFence(raw.trim());
  try {
    const parsed = JSON.parse(stripped) as unknown;
    const record = asRecord(parsed);
    const summary = record ? asString(record.summary) : null;
    return summary && summary.trim() ? summary.trim() : null;
  } catch {
    return null;
  }
};

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
