import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { StarshipDb } from "../db";

type HeadlessClaudeRequest = {
  cacheNamespace: string;
  prompt: string;
  cwd: string;
};

type ClaudeOutput = {
  result?: unknown;
  is_error?: unknown;
  error?: unknown;
};

export const runHeadlessClaude = async (
  db: StarshipDb,
  request: HeadlessClaudeRequest
): Promise<string> => {
  const cacheKey = createCacheKey(request.cacheNamespace, request.prompt);
  const cached = db.getHeadlessCache(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await spawnClaude(request.prompt, request.cwd);
  db.saveHeadlessCache(cacheKey, result);
  return result;
};

/**
 * The prompt is piped over stdin, not passed as a CLI argument - confirmed
 * live (`echo <prompt> | claude -p --output-format json` round-trips
 * correctly) before switching. A real run against NoFlightZone's project
 * logs (~100KB combined across the three files) crashed `spawn` with
 * `ENAMETOOLONG` when the prompt was a positional argument: Windows caps the
 * whole command line at ~32K characters, and no per-caller truncation budget
 * can fix that for a project whose own logs alone exceed it. Stdin has no
 * such limit.
 */
const spawnClaude = (prompt: string, cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(resolveClaudeCommand(), ["-p", "--output-format", "json"], {
      cwd,
      env: process.env,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `claude -p exited with ${code ?? "unknown"}: ${stderr.trim()}`
          )
        );
        return;
      }

      try {
        resolve(extractDraft(stdout));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.write(prompt, "utf8");
    child.stdin.end();
  });

const resolveClaudeCommand = (): string => {
  const configured = process.env.STARSHIP_CLAUDE_COMMAND;
  if (configured && configured.trim().length > 0) {
    return configured;
  }

  if (os.platform() === "win32") {
    return "claude.exe";
  }

  return "claude";
};

const extractDraft = (stdout: string): string => {
  const parsed = parseJson(stdout.trim()) as ClaudeOutput;
  if (!isObject(parsed)) {
    throw new Error("Headless Claude returned non-object JSON.");
  }

  if (parsed.is_error === true) {
    throw new Error(`Headless Claude error: ${String(parsed.error ?? "")}`);
  }

  const result =
    typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result);

  // `result` is only wrapped in `{draft: "..."}` for Inception's own
  // drafting prompts - every other caller (File Map, Decision Map,
  // Narrative Journey, Intent annotation) asks for its own JSON shape
  // directly, or the model may respond with plain, non-JSON prose (a
  // refusal or clarification) instead of complying with the "return only
  // JSON" instruction. Either case must fall through to the raw text below,
  // not throw - a caller's own extraction logic (e.g. decisionMap.ts's
  // extractDecisionResponse) already handles "this wasn't valid JSON"
  // gracefully; this function's job is only to unwrap the draft envelope
  // when one is actually present.
  let nested: unknown = null;
  try {
    nested = parseJson(stripCodeFence(result));
  } catch {
    nested = null;
  }

  if (isObject(nested) && typeof nested.draft === "string") {
    return nested.draft.trim();
  }

  return stripCodeFence(result).trim();
};

const parseJson = (value: string): unknown => JSON.parse(value);

const stripCodeFence = (value: string): string => {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const createCacheKey = (namespace: string, prompt: string): string =>
  createHash("sha256").update(`${namespace}\0${prompt}`).digest("hex");

export const getHeadlessCwd = (): string => path.resolve(process.cwd());
