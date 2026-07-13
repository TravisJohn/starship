import { app, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  FileMapDownloadRequest,
  FileMapDownloadResponse,
  FileMapGenerateRequest,
  FileMapGenerateResponse
} from "../shared/ipc";
import { findAllTranscriptsForProject } from "./dashboard";
import type { StarshipDb } from "./db";
import { getHeadlessCwd, runHeadlessClaude } from "./inception/headlessClaude";

const TIMELINE_CHARACTER_BUDGET = 12000;

type JsonRecord = Record<string, unknown>;

export type FileTouch = {
  filePath: string;
  timestamp: string | null;
  reasoning: string | null;
};

export type FileMapNode = {
  filePath: string;
  order: number;
};

export type FileMapEdge = {
  from: string;
  to: string;
  reason: string;
};

export type FileMapResult = {
  nodes: FileMapNode[];
  edges: FileMapEdge[];
  generatedAt: string;
};

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const registerFileMapHandlers = (db: StarshipDb): void => {
  ipcMain.handle(
    "fileMap:generate",
    async (_event, request: FileMapGenerateRequest): Promise<FileMapGenerateResponse> => {
      const result = await generateFileMap(db, request);
      const projectName = db.getProject(request.projectId)?.name ?? path.basename(request.projectPath);
      return {
        html: renderFileMapHtml(result, projectName),
        fileCount: result.nodes.length,
        edgeCount: result.edges.length,
        generatedAt: result.generatedAt
      };
    }
  );

  ipcMain.handle(
    "fileMap:download",
    async (_event, request: FileMapDownloadRequest): Promise<FileMapDownloadResponse> => {
      const result = await dialog.showSaveDialog({
        title: "Save File Map",
        defaultPath: `${sanitizeFileName(request.projectName)}-file-map.html`,
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

export const buildFileTouchTimeline = (transcriptPaths: string[]): FileTouch[] => {
  const touches: FileTouch[] = [];

  for (const transcriptPath of transcriptPaths) {
    let content: string;
    try {
      content = fs.readFileSync(transcriptPath, "utf8");
    } catch {
      continue;
    }

    let mostRecentText: string | null = null;
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
      const contentBlocks = message?.content;
      if (!Array.isArray(contentBlocks)) {
        continue;
      }

      for (const block of contentBlocks) {
        const blockRecord = asRecord(block);
        if (!blockRecord) {
          continue;
        }

        if (blockRecord.type === "text") {
          const text = asString(blockRecord.text);
          if (text && text.trim()) {
            mostRecentText = text.trim();
          }
          continue;
        }

        if (blockRecord.type !== "tool_use") {
          continue;
        }

        const toolName = asString(blockRecord.name);
        if (toolName !== "Write" && toolName !== "Edit") {
          continue;
        }

        const input = asRecord(blockRecord.input);
        const filePath = input
          ? asString(input.file_path) ?? asString(input.path)
          : null;
        if (!filePath) {
          continue;
        }

        touches.push({
          filePath,
          timestamp: asString(record.timestamp),
          reasoning: mostRecentText
        });
      }
    }
  }

  return touches;
};

export const generateFileMap = async (
  db: StarshipDb,
  request: { projectId: string; projectPath: string }
): Promise<FileMapResult> => {
  const generatedAt = new Date().toISOString();
  const transcripts = findAllTranscriptsForProject(request.projectPath);
  if (transcripts.length === 0) {
    return { nodes: [], edges: [], generatedAt };
  }

  const timeline = buildFileTouchTimeline(transcripts.map((transcript) => transcript.path));
  if (timeline.length === 0) {
    return { nodes: [], edges: [], generatedAt };
  }

  const nodes = buildNodes(timeline);

  try {
    const nodePaths = new Set(nodes.map((node) => node.filePath));
    const prompt = fillPromptTemplate(readPromptTemplate(), {
      payload_json: JSON.stringify(
        {
          fileTouches: boundTimelineForPrompt(timeline)
        },
        null,
        2
      )
    });
    const raw = await runHeadlessClaude(db, {
      cacheNamespace: "file-map",
      prompt,
      cwd: getHeadlessCwd()
    });

    return {
      nodes,
      edges: extractEdges(raw).filter(
        (edge) => nodePaths.has(edge.from) && nodePaths.has(edge.to)
      ),
      generatedAt
    };
  } catch {
    return { nodes, edges: [], generatedAt };
  }
};

export const renderFileMapHtml = (
  result: FileMapResult,
  projectName: string
): string => {
  const data = serializeJsonForScript({
    projectName,
    generatedAt: result.generatedAt,
    nodes: result.nodes,
    edges: result.edges
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(projectName)} File Map</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #09090b;
      --panel: #18181b;
      --line: #3f3f46;
      --line-active: #34d399;
      --text: #f4f4f5;
      --muted: #a1a1aa;
      --soft: #27272a;
      --accent: #34d399;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      padding: 20px 24px 12px;
      border-bottom: 1px solid var(--soft);
    }
    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0;
    }
    .meta {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
    }
    .empty {
      display: grid;
      min-height: calc(100vh - 80px);
      place-items: center;
      padding: 24px;
      color: var(--muted);
      text-align: center;
    }
    .wrap {
      display: grid;
      grid-template-rows: 1fr auto;
      height: calc(100vh - 76px);
      min-height: 520px;
    }
    .stage {
      overflow: auto;
      padding: 24px;
    }
    svg {
      display: block;
      min-width: 100%;
      border: 1px solid var(--soft);
      border-radius: 8px;
      background: #0f0f12;
    }
    .edge {
      stroke: var(--line);
      stroke-width: 2;
      fill: none;
      opacity: 0.62;
      cursor: pointer;
    }
    .edge.active {
      stroke: var(--line-active);
      opacity: 1;
      stroke-width: 3;
    }
    .node rect {
      fill: var(--panel);
      stroke: #52525b;
      stroke-width: 1;
      rx: 8;
      cursor: pointer;
    }
    .node.active rect {
      stroke: var(--accent);
      stroke-width: 2;
    }
    .node text {
      fill: var(--text);
      font-size: 12px;
      pointer-events: none;
    }
    .order {
      fill: var(--muted);
      font-size: 10px;
    }
    .detail {
      border-top: 1px solid var(--soft);
      background: #111113;
      padding: 14px 24px;
      min-height: 64px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .detail strong { color: var(--text); }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(projectName)} File Map</h1>
    <div class="meta">${result.nodes.length} files, ${result.edges.length} relationships, generated ${escapeHtml(result.generatedAt)}</div>
  </header>
  <main id="app"></main>
  <script>
    const data = ${data};
    const app = document.getElementById("app");
    const basename = (filePath) => filePath.split(/[\\\\/]/).filter(Boolean).pop() || filePath;
    const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

    if (data.nodes.length === 0) {
      app.innerHTML = '<div class="empty">No files have been touched by Claude in this project yet.</div>';
    } else {
      renderGraph();
    }

    function renderGraph() {
      const nodeWidth = 210;
      const nodeHeight = 62;
      const marginX = 56;
      const marginY = 62;
      const gapX = data.nodes.length > 8 ? 180 : 220;
      const rowGap = 132;
      const rowCount = data.nodes.length > 8 ? 3 : 2;
      const width = Math.max(900, marginX * 2 + nodeWidth + gapX * Math.max(0, data.nodes.length - 1));
      const height = marginY * 2 + nodeHeight + rowGap * (rowCount - 1);
      const positions = new Map();

      data.nodes.forEach((node, index) => {
        positions.set(node.filePath, {
          x: marginX + index * gapX,
          y: marginY + (index % rowCount) * rowGap
        });
      });

      const edgeMarkup = data.edges.map((edge, index) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return "";
        const startX = from.x + nodeWidth;
        const startY = from.y + nodeHeight / 2;
        const endX = to.x;
        const endY = to.y + nodeHeight / 2;
        const curve = Math.max(60, Math.abs(endX - startX) / 2);
        return '<path class="edge" data-edge-index="' + index + '" data-from="' + esc(edge.from) + '" data-to="' + esc(edge.to) + '" data-reason="' + esc(edge.reason) + '" d="M ' + startX + ' ' + startY + ' C ' + (startX + curve) + ' ' + startY + ', ' + (endX - curve) + ' ' + endY + ', ' + endX + ' ' + endY + '" marker-end="url(#arrow)"><title>' + esc(edge.reason) + '</title></path>';
      }).join("");

      const nodeMarkup = data.nodes.map((node) => {
        const pos = positions.get(node.filePath);
        return '<g class="node" data-file="' + esc(node.filePath) + '" transform="translate(' + pos.x + ' ' + pos.y + ')"><rect width="' + nodeWidth + '" height="' + nodeHeight + '"></rect><title>' + esc(node.filePath) + '</title><text x="12" y="24">' + esc(basename(node.filePath)).slice(0, 28) + '</text><text class="order" x="12" y="44">#' + (node.order + 1) + ' ' + esc(node.filePath).slice(0, 38) + '</text></g>';
      }).join("");

      app.innerHTML = '<div class="wrap"><div class="stage"><svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="File relationship graph"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#3f3f46"></path></marker></defs>' + edgeMarkup + nodeMarkup + '</svg></div><div class="detail" id="detail">Click a file to highlight relationships. Click a relationship to read why it exists.</div></div>';

      const detail = document.getElementById("detail");
      document.querySelectorAll(".node").forEach((nodeElement) => {
        nodeElement.addEventListener("click", () => {
          const filePath = nodeElement.getAttribute("data-file");
          document.querySelectorAll(".node").forEach((item) => item.classList.toggle("active", item === nodeElement));
          document.querySelectorAll(".edge").forEach((edgeElement) => {
            edgeElement.classList.toggle("active", edgeElement.getAttribute("data-from") === filePath || edgeElement.getAttribute("data-to") === filePath);
          });
          detail.innerHTML = '<strong>' + esc(filePath) + '</strong>';
        });
      });

      document.querySelectorAll(".edge").forEach((edgeElement) => {
        edgeElement.addEventListener("click", () => {
          document.querySelectorAll(".node").forEach((item) => item.classList.remove("active"));
          document.querySelectorAll(".edge").forEach((item) => item.classList.toggle("active", item === edgeElement));
          detail.innerHTML = '<strong>' + esc(edgeElement.getAttribute("data-from")) + ' -> ' + esc(edgeElement.getAttribute("data-to")) + '</strong><br>' + esc(edgeElement.getAttribute("data-reason"));
        });
      });
    }
  </script>
</body>
</html>`;
};

const buildNodes = (timeline: FileTouch[]): FileMapNode[] => {
  const seen = new Set<string>();
  const nodes: FileMapNode[] = [];

  for (const touch of timeline) {
    if (seen.has(touch.filePath)) {
      continue;
    }

    seen.add(touch.filePath);
    nodes.push({ filePath: touch.filePath, order: nodes.length });
  }

  return nodes;
};

const boundTimelineForPrompt = (timeline: FileTouch[]): FileTouch[] => {
  const firstTouchByPath = new Map<string, FileTouch>();
  for (const touch of timeline) {
    if (!firstTouchByPath.has(touch.filePath)) {
      firstTouchByPath.set(touch.filePath, touch);
    }
  }

  const bounded: FileTouch[] = [];
  let size = 0;
  // Whole-project maps need early files as much as recent files, so keep the
  // first touch for each file in deterministic build order until the prompt
  // budget is reached rather than slicing off the oldest history.
  for (const touch of firstTouchByPath.values()) {
    const projected = JSON.stringify(touch).length;
    if (bounded.length > 0 && size + projected > TIMELINE_CHARACTER_BUDGET) {
      break;
    }

    bounded.push(touch);
    size += projected;
  }

  return bounded;
};

const extractEdges = (raw: string): FileMapEdge[] => {
  const stripped = stripCodeFence(raw.trim());
  try {
    const parsed = JSON.parse(stripped) as unknown;
    const record = asRecord(parsed);
    if (!record || !Array.isArray(record.edges)) {
      return [];
    }

    return record.edges
      .map((edge) => asRecord(edge))
      .filter((edge): edge is JsonRecord => edge !== null)
      .map((edge) => ({
        from: asString(edge.from)?.trim() ?? "",
        to: asString(edge.to)?.trim() ?? "",
        reason: asString(edge.reason)?.trim() ?? ""
      }))
      .filter((edge) => edge.from.length > 0 && edge.to.length > 0 && edge.reason.length > 0);
  } catch {
    return [];
  }
};

const stripCodeFence = (value: string): string => {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : value;
};

const readPromptTemplate = (): string => {
  const promptDir = process.env.STARSHIP_PROMPT_DIR ?? path.join(getAppRoot(), "prompts");
  const filePath = path.join(promptDir, "file-map.md");

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

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });

const serializeJsonForScript = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c");
