import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { DiscussFieldRequest, DiscussFieldResponse } from "../shared/ipc";
import type { StarshipDb } from "./db";
import { getHeadlessCwd, runHeadlessClaude } from "./inception/headlessClaude";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null ? (value as JsonRecord) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const registerInceptionDiscussHandlers = (db: StarshipDb): void => {
  ipcMain.handle(
    "inception:discuss",
    (_event, request: DiscussFieldRequest): Promise<DiscussFieldResponse> =>
      generateDiscussReply(db, request)
  );
};

/**
 * One turn of the Discuss chat for a single Inception wizard field - used by
 * both the Intent Ledger step and the Requirements step. Fully stateless per
 * call, same as every other headless feature - the caller resends the whole
 * conversation history each turn since `claude -p` has no session-resume
 * concept in how this codebase invokes it. Only ever fires on an explicit
 * user "Send" click, never automatically - CLAUDE.md bans running headless
 * calls in a loop, and a multi-turn thread stays inside that rule as long as
 * every turn is its own click.
 */
export const generateDiscussReply = async (
  db: StarshipDb,
  request: DiscussFieldRequest
): Promise<DiscussFieldResponse> => {
  try {
    const prompt = fillPromptTemplate(readPromptTemplate(), {
      payload_json: JSON.stringify(
        {
          fieldLabel: request.fieldLabel,
          currentValue: request.currentValue,
          history: request.history,
          message: request.message,
          intentContext: request.intentContext ?? null
        },
        null,
        2
      )
    });

    const raw = await runHeadlessClaude(db, {
      cacheNamespace: "inception-discuss",
      prompt,
      cwd: getHeadlessCwd()
    });

    const parsed = extractDiscussResponse(raw);
    if (!parsed) {
      return { reply: "Couldn't reach the assistant right now.", proposedRewrite: null };
    }

    return parsed;
  } catch {
    return { reply: "Couldn't reach the assistant right now.", proposedRewrite: null };
  }
};

const extractDiscussResponse = (raw: string): DiscussFieldResponse | null => {
  const stripped = stripCodeFence(raw.trim());
  try {
    const parsed = JSON.parse(stripped) as unknown;
    const record = asRecord(parsed);
    if (!record) {
      return null;
    }

    const reply = asString(record.reply);
    if (!reply) {
      return null;
    }

    return {
      reply,
      proposedRewrite: asString(record.proposedRewrite)
    };
  } catch {
    return null;
  }
};

const stripCodeFence = (value: string): string => {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : value;
};

const readPromptTemplate = (): string => {
  const promptDir = process.env.STARSHIP_PROMPT_DIR ?? path.join(getAppRoot(), "prompts");
  const filePath = path.join(promptDir, "inception-discuss.md");

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
