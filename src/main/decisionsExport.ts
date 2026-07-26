import { dialog, ipcMain } from "electron";
import fs from "node:fs";
import type { DecisionsExportRequest, DecisionsExportResponse } from "../shared/ipc";
import { findNewestTranscript } from "./dashboard";
import { buildTaskReasoningTimeline } from "./intentAnnotation";

/**
 * Exports the current transcript's task-reasoning pairs as-is - one JSON
 * object per line, no interpretation added - so Travis has a raw decision
 * trace to feed a separate model later. Deliberately a save-to-disk export
 * (same shape as fileMap:download) rather than new primary UI: per
 * CLAUDE.md's altitude discipline, this operational detail must stay out of
 * Starship's own surfaces, even though the file itself is fine to exist.
 */
export const registerDecisionsExportHandlers = (): void => {
  ipcMain.handle(
    "decisions:export",
    async (_event, request: DecisionsExportRequest): Promise<DecisionsExportResponse> => {
      const transcript = findNewestTranscript(request.projectPath);
      const timeline = transcript ? buildTaskReasoningTimeline(transcript.path) : [];

      const result = await dialog.showSaveDialog({
        title: "Export Session Decisions",
        defaultPath: `${sanitizeFileName(request.projectName)}-decisions.jsonl`,
        filters: [{ name: "JSON Lines", extensions: ["jsonl"] }]
      });

      if (result.canceled || !result.filePath) {
        return { savedPath: null, count: 0 };
      }

      const lines = timeline.map((entry) =>
        JSON.stringify({ task: entry.label, reasoning: entry.reasoning })
      );
      fs.writeFileSync(
        result.filePath,
        lines.length > 0 ? `${lines.join("\n")}\n` : "",
        "utf8"
      );

      return { savedPath: result.filePath, count: timeline.length };
    }
  );
};

const sanitizeFileName = (value: string): string => {
  const sanitized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").trim();
  return sanitized.length > 0 ? sanitized : "project";
};
