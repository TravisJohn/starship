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
import { buildProjectFileTree, type FileTreeNode } from "./fileTree";
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
  tree: FileTreeNode | null;
};

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const countTreeFiles = (node: FileTreeNode | null): number => {
  if (!node) {
    return 0;
  }

  if (node.type === "file") {
    return 1;
  }

  return (node.children ?? []).reduce(
    (total, child) => total + countTreeFiles(child),
    0
  );
};

export const registerFileMapHandlers = (db: StarshipDb): void => {
  ipcMain.handle(
    "fileMap:generate",
    async (_event, request: FileMapGenerateRequest): Promise<FileMapGenerateResponse> => {
      const result = await generateFileMap(db, request);
      const projectName = db.getProject(request.projectId)?.name ?? path.basename(request.projectPath);
      return {
        html: renderFileMapHtml(result, projectName),
        fileCount: countTreeFiles(result.tree),
        edgeCount: result.edges.length,
        generatedAt: result.generatedAt,
        tree: result.tree
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
  // The tree has its own data source (the real project folder, not
  // transcript history) and no LLM call involved - it should render even
  // for a project with zero Claude sessions yet, independent of whatever
  // happens with the DAG below.
  const tree = buildProjectFileTree(request.projectPath);

  const transcripts = findAllTranscriptsForProject(request.projectPath);
  if (transcripts.length === 0) {
    return { nodes: [], edges: [], generatedAt, tree };
  }

  const timeline = buildFileTouchTimeline(transcripts.map((transcript) => transcript.path));
  if (timeline.length === 0) {
    return { nodes: [], edges: [], generatedAt, tree };
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
      generatedAt,
      tree
    };
  } catch {
    return { nodes, edges: [], generatedAt, tree };
  }
};

export const renderFileMapHtml = (
  result: FileMapResult,
  projectName: string
): string => {
  const treeFileCount = countTreeFiles(result.tree);
  const data = serializeJsonForScript({
    projectName,
    generatedAt: result.generatedAt,
    fileCount: treeFileCount,
    tree: result.tree
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
      --line-active: #38bdf8;
      --text: #f4f4f5;
      --muted: #a1a1aa;
      --soft: #27272a;
      --accent: #38bdf8;
      --tree-line: #52525b;
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
      height: 100%;
      place-items: center;
      padding: 24px;
      color: var(--muted);
      text-align: center;
      font-size: 13px;
    }
    .wrap {
      display: grid;
      grid-template-rows: 1fr auto;
      height: calc(100vh - 76px);
      min-height: 420px;
    }
    .tree-shell {
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 0;
      min-width: 0;
    }
    .panel-header {
      padding: 10px 20px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
      border-bottom: 1px solid var(--soft);
    }
    .stage {
      overflow: auto;
      padding: 16px;
      min-height: 0;
    }
    svg {
      display: block;
      min-width: 100%;
      border: 1px solid var(--soft);
      border-radius: 8px;
      background: #0f0f12;
    }
    .tree-edge {
      stroke: var(--tree-line);
      stroke-width: 1.5;
      fill: none;
      opacity: 0.7;
    }
    .tree-node rect {
      fill: var(--panel);
      stroke: #3f3f46;
      stroke-width: 1;
      rx: 6;
      cursor: pointer;
    }
    .tree-node.directory rect {
      stroke: #3f5a6b;
    }
    .tree-node.active rect {
      stroke: var(--accent);
      stroke-width: 2;
    }
    .tree-node text {
      fill: var(--text);
      font-size: 12px;
      pointer-events: none;
    }
    .tree-node .badge {
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
    .detail ul { margin: 6px 0 0; padding-left: 18px; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(projectName)} File Map</h1>
    <div class="meta">${treeFileCount} files in tree, generated ${escapeHtml(result.generatedAt)}</div>
  </header>
  <main id="app"></main>
  <script>
    const data = ${data};
    const app = document.getElementById("app");
    const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

    app.innerHTML = '<div class="wrap">'
      + '<div class="tree-shell"><div class="panel-header">File Tree</div><div class="stage" id="tree-stage"></div></div>'
      + '<div class="detail" id="detail"><strong>File details</strong></div></div>';

    const detail = document.getElementById("detail");

    // Horizontal collapsible file tree. Whole-project structure (not just
    // touched files), no LLM call involved. Every directory at depth >= 2
    // starts collapsed so
    // a real project doesn't render as an unusable wall of nodes on first
    // paint; root's own immediate children are expanded by default.
    const collapsed = new Set();

    function collectDirectoryPaths(node, out) {
      if (node.type !== "directory") return;
      if (node.path && node.path.split("/").length >= 2) out.push(node.path);
      (node.children || []).forEach((child) => collectDirectoryPaths(child, out));
    }

    if (data.tree) {
      const deepPaths = [];
      collectDirectoryPaths(data.tree, deepPaths);
      deepPaths.forEach((p) => collapsed.add(p));
    }

    function isLeafForLayout(node) {
      return node.type === "file" || !node.children || node.children.length === 0 || collapsed.has(node.path);
    }

    function countLayoutLeaves(node) {
      if (isLeafForLayout(node)) return 1;
      return node.children.reduce((total, child) => total + countLayoutLeaves(child), 0);
    }

    function layoutTree(root, rowHeight, levelGap) {
      const positions = new Map();
      let leafCounter = 0;

      function visit(node, depth) {
        const leaf = isLeafForLayout(node);
        let y;
        if (leaf) {
          y = leafCounter * rowHeight;
          leafCounter += 1;
        } else {
          const childYs = node.children.map((child) => visit(child, depth + 1));
          y = (Math.min.apply(null, childYs) + Math.max.apply(null, childYs)) / 2;
        }
        positions.set(node.path, { node, x: depth * levelGap, y, depth, leaf });
        return y;
      }

      visit(root, 0);
      return { positions, rowCount: leafCounter };
    }

    function renderTree() {
      const stage = document.getElementById("tree-stage");
      if (!data.tree) {
        stage.innerHTML = '<div class="empty">Couldn\\'t read the project folder.</div>';
        return;
      }
      if (!data.tree.children || data.tree.children.length === 0) {
        stage.innerHTML = '<div class="empty">No source files found.</div>';
        return;
      }

      const nodeWidth = 230;
      const marginX = 28;
      const marginY = 24;
      const levelGap = 260;
      const leafCount = countLayoutLeaves(data.tree);
      const availableHeight = Math.max(280, stage.clientHeight - marginY * 2);
      const rowHeight = Math.max(34, Math.min(42, Math.floor(availableHeight / Math.max(1, leafCount))));
      const nodeHeight = Math.min(36, rowHeight - 4);
      const textY = Math.round(nodeHeight / 2 + 4);
      const previousScrollLeft = stage.scrollLeft;
      const previousScrollTop = stage.scrollTop;

      const { positions, rowCount } = layoutTree(data.tree, rowHeight, levelGap);
      const maxDepth = Math.max.apply(null, Array.from(positions.values()).map((p) => p.depth));
      const stageWidth = Math.max(640, stage.clientWidth - 32);
      const width = Math.max(stageWidth, marginX * 2 + nodeWidth + maxDepth * levelGap);
      const contentHeight = marginY * 2 + Math.max(0, rowCount - 1) * rowHeight + nodeHeight;
      const height = Math.max(Math.max(320, stage.clientHeight - 32), contentHeight);

      const edgeMarkup = [];
      const nodeMarkup = [];

      positions.forEach((pos) => {
        const node = pos.node;
        const x = marginX + pos.x;
        const y = marginY + pos.y - nodeHeight / 2;

        if (node.type === "directory") {
          const childCount = (node.children || []).length;
          const isCollapsed = collapsed.has(node.path) && childCount > 0;
          const marker = childCount === 0 ? "" : (isCollapsed ? "+ " : "- ");
          const label = marker + (node.name || data.projectName);
          nodeMarkup.push(
            '<g class="tree-node directory" data-path="' + esc(node.path) + '" transform="translate(' + x + ' ' + y + ')">' +
            '<rect width="' + nodeWidth + '" height="' + nodeHeight + '"></rect>' +
            '<title>' + esc(node.path || data.projectName) + '</title>' +
            '<text x="10" y="' + textY + '">' + esc(label).slice(0, 32) + '</text>' +
            (childCount > 0 ? '<text class="badge" x="' + (nodeWidth - 10) + '" y="' + textY + '" text-anchor="end">' + childCount + '</text>' : '') +
            '</g>'
          );
        } else {
          const fnCount = Array.isArray(node.functions) ? node.functions.length : null;
          const badge = fnCount === null ? "" : (fnCount + " fn");
          nodeMarkup.push(
            '<g class="tree-node file" data-path="' + esc(node.path) + '" transform="translate(' + x + ' ' + y + ')">' +
            '<rect width="' + nodeWidth + '" height="' + nodeHeight + '"></rect>' +
            '<title>' + esc(node.path) + '</title>' +
            '<text x="10" y="' + textY + '">' + esc(node.name).slice(0, 28) + '</text>' +
            (badge ? '<text class="badge" x="' + (nodeWidth - 10) + '" y="' + textY + '" text-anchor="end">' + esc(badge) + '</text>' : '') +
            '</g>'
          );
        }

        if (node.type === "directory" && node.children && !collapsed.has(node.path)) {
          node.children.forEach((child) => {
            const childPos = positions.get(child.path);
            if (!childPos) return;
            const startX = x + nodeWidth;
            const startY = marginY + pos.y;
            const endX = marginX + childPos.x;
            const endY = marginY + childPos.y;
            const midX = startX + (endX - startX) / 2;
            edgeMarkup.push(
              '<path class="tree-edge" d="M ' + startX + ' ' + startY + ' H ' + midX + ' V ' + endY + ' H ' + endX + '"></path>'
            );
          });
        }
      });

      stage.innerHTML = '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Project file tree">' + edgeMarkup.join("") + nodeMarkup.join("") + '</svg>';
      stage.scrollLeft = previousScrollLeft;
      stage.scrollTop = previousScrollTop;

      stage.querySelectorAll(".tree-node.directory").forEach((el) => {
        el.addEventListener("click", () => {
          const p = el.getAttribute("data-path");
          if (collapsed.has(p)) collapsed.delete(p); else collapsed.add(p);
          renderTree();
        });
      });

      stage.querySelectorAll(".tree-node.file").forEach((el) => {
        el.addEventListener("click", () => {
          stage.querySelectorAll(".tree-node").forEach((item) => item.classList.toggle("active", item === el));
          const filePath = el.getAttribute("data-path");
          const pos = positions.get(filePath);
          const node = pos ? pos.node : null;
          if (!node) return;
          if (node.functions === null || node.functions === undefined) {
            detail.innerHTML = '<strong>' + esc(filePath) + '</strong><br>No functions extracted for this file type.';
          } else if (node.functions.length === 0) {
            detail.innerHTML = '<strong>' + esc(filePath) + '</strong><br>No functions found.';
          } else {
            detail.innerHTML = '<strong>' + esc(filePath) + '</strong><ul>' + node.functions.map((fn) => '<li>' + esc(fn) + '</li>').join("") + '</ul>';
          }
        });
      });
    }

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(renderTree, 100);
    });

    renderTree();
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
