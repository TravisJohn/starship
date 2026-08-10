import { ipcMain } from "electron";
import fs from "node:fs";
import type { InitialPlanRequest, InitialPlanResult } from "../shared/ipc";
import { findAllTranscriptsForProject } from "./dashboard";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null ? (value as JsonRecord) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const registerInitialPlanHandlers = (): void => {
  ipcMain.handle(
    "project:getInitialPlan",
    (_event, request: InitialPlanRequest): InitialPlanResult =>
      getInitialPlanForProject(request.projectPath)
  );
};

/**
 * The plan Claude proposed in its first real reply after the cold prompt -
 * captured verbatim from the oldest transcript, not regenerated or
 * summarized. Starship's own cold prompt (createProject.ts's
 * composeColdPrompt) explicitly asks for "a Phase 1 plan with discrete tasks
 * and dependencies, flag the largest risk, and wait for approval" - so this
 * is reading back a shape Starship itself elicited, not guessing at one.
 * No headless call: this is a deterministic read of already-local data.
 */
export const getInitialPlanForProject = (projectPath: string): InitialPlanResult => {
  const oldest = findAllTranscriptsForProject(projectPath).at(0);
  if (!oldest) {
    return { markdown: null, capturedAt: null };
  }

  return extractInitialPlan(oldest.path);
};

/**
 * Scans a transcript in order for the first assistant turn that said
 * anything (as opposed to an assistant turn that was pure tool_use), and
 * returns its text content untouched. Deliberately stops at the first one -
 * later turns are follow-up work, not the plan itself.
 */
export const extractInitialPlan = (transcriptPath: string): InitialPlanResult => {
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return { markdown: null, capturedAt: null };
  }

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
    if (!record || record.type !== "assistant") {
      continue;
    }

    const message = asRecord(record.message);
    const blocks = message?.content;
    if (!Array.isArray(blocks)) {
      continue;
    }

    const texts = blocks
      .map((block) => asRecord(block))
      .filter((block): block is JsonRecord => block !== null && block.type === "text")
      .map((block) => asString(block.text)?.trim())
      .filter((text): text is string => Boolean(text));

    if (texts.length > 0) {
      return { markdown: texts.join("\n\n"), capturedAt: asString(record.timestamp) };
    }
  }

  return { markdown: null, capturedAt: null };
};
