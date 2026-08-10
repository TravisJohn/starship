#!/usr/bin/env node
"use strict";

// Starship's PermissionRequest hook signal. Registered per-project in
// .claude/settings.json (written alongside this file at project creation).
// Fires exactly when Claude Code is about to show a real approval prompt,
// before the human answers it - the one moment the JSONL transcript itself
// cannot capture, since Claude Code writes no record for a pending-approval
// tool call until after the decision is made.
//
// This script only ever observes. It never returns an allow/deny decision -
// Claude Code still genuinely waits on the human. Any failure here (bad
// JSON, no write access, etc.) is swallowed and exits 0 rather than
// blocking or altering Claude Code's own permission flow.

const fs = require("node:fs");
const path = require("node:path");

// Keep in sync with src/main/observation/slug.ts - Starship reads the signal
// file back under the name this produces.
const slugProjectPath = (absoluteProjectPath) =>
  absoluteProjectPath.replace(/[^a-zA-Z0-9]/g, "-");

const resolveSignalsDir = () => {
  if (process.env.STARSHIP_SIGNALS_DIR) {
    return process.env.STARSHIP_SIGNALS_DIR;
  }
  // Mirrors Electron's default `app.getPath("userData")` for this app
  // (package.json name "starship") - this script runs as a plain Node
  // child process outside Electron, so it can't call that API directly.
  // Keep in sync with src/main/observation/permissionSignal.ts.
  const base = process.env.APPDATA || path.join(require("node:os").homedir(), ".config");
  return path.join(base, "starship", "signals");
};

let raw = "";
process.stdin.on("data", (chunk) => {
  raw += chunk;
});

process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(raw);
    const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
    const signalsDir = resolveSignalsDir();
    fs.mkdirSync(signalsDir, { recursive: true });

    const signalFile = path.join(signalsDir, `${slugProjectPath(path.resolve(cwd))}.ndjson`);
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        toolName: payload.tool_name ?? null,
        toolInput: payload.tool_input ?? null,
        sessionId: payload.session_id ?? null,
        promptId: payload.prompt_id ?? null
      }) + "\n";

    fs.appendFileSync(signalFile, line, "utf8");
  } catch {
    // Never block or alter Claude Code's permission flow over a signaling failure.
  }

  process.exit(0);
});
