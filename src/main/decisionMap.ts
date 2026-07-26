import { app, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  DecisionMapDownloadRequest,
  DecisionMapDownloadResponse,
  DecisionMapEdge,
  DecisionMapGenerateRequest,
  DecisionMapGenerateResponse,
  DecisionMapNode,
  DecisionMapResult
} from "../shared/ipc";
import { findAllTranscriptsForProject } from "./dashboard";
import type { StarshipDb } from "./db";
import { getHeadlessCwd, runHeadlessClaude } from "./inception/headlessClaude";
import {
  buildTaskReasoningTimelineForProject,
  SERVES_INTENT_VALUES,
  type SessionTaskReasoning
} from "./intentAnnotation";

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
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
        generatedAt: result.generatedAt
      };
    }
  );

  ipcMain.handle(
    "decisionMap:download",
    async (_event, request: DecisionMapDownloadRequest): Promise<DecisionMapDownloadResponse> => {
      const result = await dialog.showSaveDialog({
        title: "Save Decision Map",
        defaultPath: `${sanitizeFileName(request.projectName)}-decision-map.html`,
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

/**
 * The whole project's decision history as a graph, not a single session's -
 * every TaskCreate across every transcript this project has ever had
 * (buildTaskReasoningTimelineForProject), with a click-triggered, cached
 * headless pass inferring which decisions logically follow from which
 * others (not just chronological order) plus an Intent Ledger alignment
 * tag per decision. Same graceful-degradation posture as File Map/Intent
 * annotation: no transcripts or no captured decisions -> empty graph;
 * headless failure -> nodes with a default "none" tag and no edges, never
 * a thrown error.
 */
export const generateDecisionMap = async (
  db: StarshipDb,
  request: DecisionMapGenerateRequest
): Promise<DecisionMapResult> => {
  const generatedAt = new Date().toISOString();

  const transcripts = findAllTranscriptsForProject(request.projectPath);
  if (transcripts.length === 0) {
    return { nodes: [], edges: [], generatedAt };
  }

  const timeline = buildTaskReasoningTimelineForProject(
    transcripts.map((transcript) => transcript.path)
  );
  if (timeline.length === 0) {
    return { nodes: [], edges: [], generatedAt };
  }

  const nodes = buildNodes(timeline);
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
          decisions: timeline.map((entry) => ({
            label: entry.label,
            reasoning: entry.reasoning
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

    const parsed = extractDecisionMapResponse(raw);
    return {
      nodes: reconcileNodes(nodes, parsed?.nodes ?? []),
      edges: reconcileEdges(nodes, parsed?.edges ?? []),
      generatedAt
    };
  } catch {
    return { nodes, edges: [], generatedAt };
  }
};

const buildNodes = (timeline: SessionTaskReasoning[]): DecisionMapNode[] =>
  timeline.map((entry, index) => ({
    id: `decision-${index}`,
    label: entry.label,
    servesIntent: "none",
    sessionIndex: entry.sessionIndex
  }));

type RawNode = { label: string; servesIntent: DecisionMapNode["servesIntent"] };
type RawEdge = { from: string; to: string; reason: string };
type RawDecisionMapResponse = { nodes: RawNode[]; edges: RawEdge[] };

const extractDecisionMapResponse = (raw: string): RawDecisionMapResponse | null => {
  const stripped = stripCodeFence(raw.trim());
  try {
    const parsed = JSON.parse(stripped) as unknown;
    const record = asRecord(parsed);
    if (!record) {
      return null;
    }

    const nodes = Array.isArray(record.nodes)
      ? record.nodes
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonRecord => entry !== null)
          .map((entry) => {
            const label = asString(entry.label);
            if (!label) {
              return null;
            }
            const servesIntentRaw = asString(entry.servesIntent);
            const servesIntent = SERVES_INTENT_VALUES.includes(
              servesIntentRaw as DecisionMapNode["servesIntent"]
            )
              ? (servesIntentRaw as DecisionMapNode["servesIntent"])
              : "none";
            return { label, servesIntent };
          })
          .filter((entry): entry is RawNode => entry !== null)
      : [];

    const edges = Array.isArray(record.edges)
      ? record.edges
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonRecord => entry !== null)
          .map((entry) => ({
            from: asString(entry.from)?.trim() ?? "",
            to: asString(entry.to)?.trim() ?? "",
            reason: asString(entry.reason)?.trim() ?? ""
          }))
          .filter((entry) => entry.from.length > 0 && entry.to.length > 0 && entry.reason.length > 0)
      : [];

    return { nodes, edges };
  } catch {
    return null;
  }
};

/**
 * Maps the LLM's label-keyed servesIntent tags back onto real node ids, by
 * exact label, in order, first-unused-match-wins - same reconciliation
 * convention as intentAnnotation.ts's reconcilePerTask. A node the LLM
 * didn't tag keeps the default "none" rather than being dropped: every
 * captured decision must appear in the map, tagged or not.
 */
const reconcileNodes = (nodes: DecisionMapNode[], rawNodes: RawNode[]): DecisionMapNode[] => {
  const remaining = [...rawNodes];

  return nodes.map((node) => {
    const matchIndex = remaining.findIndex((entry) => entry.label === node.label);
    if (matchIndex === -1) {
      return node;
    }

    const [matched] = remaining.splice(matchIndex, 1);
    return { ...node, servesIntent: matched.servesIntent };
  });
};

/**
 * Maps the LLM's label-keyed edges back onto real node ids, by exact label,
 * first-unused-match-wins per side. An edge referencing a label with no
 * matching node (the LLM citing something it wasn't given) is dropped.
 */
const reconcileEdges = (nodes: DecisionMapNode[], rawEdges: RawEdge[]): DecisionMapEdge[] => {
  const edges: DecisionMapEdge[] = [];

  for (const rawEdge of rawEdges) {
    const from = nodes.find((node) => node.label === rawEdge.from);
    const to = nodes.find((node) => node.label === rawEdge.to);
    if (!from || !to) {
      continue;
    }

    edges.push({ from: from.id, to: to.id, reason: rawEdge.reason });
  }

  return edges;
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

export const renderDecisionMapHtml = (result: DecisionMapResult, projectName: string): string => {
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
  <title>${escapeHtml(projectName)} Decision Map</title>
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
      --purpose: #38bdf8;
      --successCriteria: #4ade80;
      --acceptedTradeoffs: #c084fc;
      --neverDo: #f59e0b;
      --none: #52525b;
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
    h1 { margin: 0; font-size: 18px; font-weight: 700; }
    .meta { margin-top: 6px; color: var(--muted); font-size: 12px; }
    .legend {
      display: flex;
      gap: 14px;
      margin-top: 10px;
      flex-wrap: wrap;
      font-size: 11px;
      color: var(--muted);
    }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .swatch { width: 10px; height: 10px; border-radius: 999px; display: inline-block; }
    .modes {
      display: flex;
      gap: 6px;
      margin-top: 10px;
    }
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
    .modes button.active {
      border-color: var(--accent);
      color: var(--text);
    }
    .wrap {
      display: grid;
      grid-template-rows: 1fr auto;
      height: calc(100vh - 140px);
      min-height: 420px;
    }
    .stage { overflow: auto; padding: 16px; min-height: 0; display: flex; }
    .stage.fit { overflow: hidden; }
    .stage.fit svg { width: 100%; height: 100%; }
    .empty {
      display: grid;
      height: 100%;
      width: 100%;
      place-items: center;
      padding: 24px;
      color: var(--muted);
      text-align: center;
      font-size: 13px;
    }
    svg {
      display: block;
      margin: 0 auto;
      border: 1px solid var(--soft);
      border-radius: 8px;
      background: #0f0f12;
      flex-shrink: 0;
    }
    .edge { stroke: var(--line); stroke-width: 1.5; fill: none; opacity: 0.65; }
    .lane-label { fill: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
    .node rect { fill: var(--panel); stroke-width: 2; rx: 6; cursor: pointer; }
    .node text { fill: var(--text); font-size: 12px; pointer-events: none; }
    .detail {
      border-top: 1px solid var(--soft);
      background: #111113;
      padding: 14px 24px;
      min-height: 72px;
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
    <h1>${escapeHtml(projectName)} Decision Map</h1>
    <div class="meta">${result.nodes.length} decisions, ${result.edges.length} connections, generated ${escapeHtml(result.generatedAt)}</div>
    <div class="legend">
      <span><span class="swatch" style="background:var(--purpose)"></span>Purpose</span>
      <span><span class="swatch" style="background:var(--successCriteria)"></span>Success Criteria</span>
      <span><span class="swatch" style="background:var(--acceptedTradeoffs)"></span>Accepted Tradeoff</span>
      <span><span class="swatch" style="background:var(--neverDo)"></span>Never Do</span>
      <span><span class="swatch" style="background:var(--none)"></span>Unattributed</span>
    </div>
    <div class="modes" id="modes">
      <button type="button" data-mode="tree">Tree</button>
      <button type="button" data-mode="sessions">Sessions</button>
      <button type="button" data-mode="intent">Intent Lanes</button>
      <button type="button" id="fit-toggle" style="margin-left:12px">Fit to Screen</button>
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

    const NODE_W = 240;
    const NODE_H = 40;
    const MARGIN_X = 24;
    const MARGIN_Y = 24;
    const INTENT_DIMENSIONS = ["purpose", "successCriteria", "acceptedTradeoffs", "neverDo", "none"];
    const INTENT_LABELS = {
      purpose: "Purpose",
      successCriteria: "Success Criteria",
      acceptedTradeoffs: "Accepted Tradeoff",
      neverDo: "Never Do",
      none: "Unattributed"
    };

    // Only edges consistent with the original chronological order the
    // decisions arrived in (main process never reorders them) count as
    // "earlier -> later" for the tree layout - guards against a
    // hallucinated backward/self edge ever causing infinite recursion.
    const indexById = new Map(data.nodes.map((node, i) => [node.id, i]));
    const forwardEdges = data.edges.filter((edge) => {
      const fromIndex = indexById.get(edge.from);
      const toIndex = indexById.get(edge.to);
      return fromIndex !== undefined && toIndex !== undefined && fromIndex < toIndex;
    });

    /**
     * Nodes positioned by actual dependency depth, not forced into one
     * column: a decision with two follow-ups visibly branches, decisions
     * that converge visibly merge. Depth = longest path from any root
     * (a node with no captured parent).
     */
    function computeTreeLayout() {
      const parentsOf = new Map(data.nodes.map((n) => [n.id, []]));
      forwardEdges.forEach((edge) => parentsOf.get(edge.to).push(edge.from));

      const depthOf = new Map();
      const depthFor = (id) => {
        if (depthOf.has(id)) return depthOf.get(id);
        depthOf.set(id, 0); // cycle guard: assume 0 while resolving, corrected below if wrong
        const parents = parentsOf.get(id) || [];
        const depth = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(depthFor));
        depthOf.set(id, depth);
        return depth;
      };
      data.nodes.forEach((n) => depthFor(n.id));

      const levels = [];
      data.nodes.forEach((n) => {
        const d = depthOf.get(n.id);
        (levels[d] = levels[d] || []).push(n);
      });

      const colWidth = NODE_W + 40;
      const rowHeight = NODE_H + 60;
      const maxRowCount = Math.max(1, ...levels.map((l) => l.length));
      const positions = new Map();
      // Every level shares one coordinate origin (x=0 = left edge of the
      // widest level) rather than each being centered on its own - a
      // narrower level is inset relative to the widest one, so the whole
      // tree reads as centered rather than each row centering independently.
      levels.forEach((nodesAtLevel, level) => {
        const rowInset = ((maxRowCount - nodesAtLevel.length) * colWidth) / 2;
        nodesAtLevel.forEach((node, i) => {
          positions.set(node.id, {
            x: rowInset + i * colWidth + colWidth / 2,
            y: level * rowHeight
          });
        });
      });

      return {
        positions,
        contentWidth: maxRowCount * colWidth,
        contentHeight: levels.length * rowHeight - (rowHeight - NODE_H),
        edgeShape: "vertical",
        lanes: null
      };
    }

    /** One horizontal lane per session, time flowing left to right. */
    function computeLaneLayout(laneKeyOf, laneOrder, laneLabelOf) {
      const laneHeight = NODE_H + 40;
      const colWidth = NODE_W + 30;
      const positions = new Map();
      data.nodes.forEach((node, i) => {
        const laneIndex = laneOrder.indexOf(laneKeyOf(node));
        positions.set(node.id, { x: i * colWidth + colWidth / 2, y: laneIndex * laneHeight });
      });

      return {
        positions,
        contentWidth: Math.max(1, data.nodes.length) * colWidth,
        contentHeight: laneOrder.length * laneHeight,
        edgeShape: "horizontal",
        lanes: laneOrder.map((key, i) => ({ label: laneLabelOf(key), y: i * laneHeight }))
      };
    }

    function computeSessionsLayout() {
      const sessions = Array.from(new Set(data.nodes.map((n) => n.sessionIndex))).sort((a, b) => a - b);
      return computeLaneLayout(
        (node) => node.sessionIndex,
        sessions,
        (key) => "Session " + (key + 1)
      );
    }

    function computeIntentLayout() {
      return computeLaneLayout(
        (node) => node.servesIntent || "none",
        INTENT_DIMENSIONS,
        (key) => INTENT_LABELS[key]
      );
    }

    const LAYOUTS = { tree: computeTreeLayout, sessions: computeSessionsLayout, intent: computeIntentLayout };
    let currentMode = "tree";
    let fitToScreen = false;

    function edgePath(edgeShape, x0, y0, x1, y1) {
      if (edgeShape === "vertical") {
        const midY = y0 + (y1 - y0) / 2;
        return "M " + x0 + " " + y0 + " C " + x0 + " " + midY + ", " + x1 + " " + midY + ", " + x1 + " " + y1;
      }
      const midX = x0 + (x1 - x0) / 2;
      return "M " + x0 + " " + y0 + " C " + midX + " " + y0 + ", " + midX + " " + y1 + ", " + x1 + " " + y1;
    }

    function render() {
      Array.from(modesEl.children).forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === currentMode));

      if (data.nodes.length === 0) {
        stage.innerHTML = '<div class="empty">No decisions captured yet - this fills in as sessions run.</div>';
        return;
      }

      const layout = LAYOUTS[currentMode]();
      const laneLabelWidth = layout.lanes ? 120 : 0;
      const contentWidth = layout.contentWidth + laneLabelWidth;
      const naturalWidth = contentWidth + MARGIN_X * 2;
      const naturalHeight = layout.contentHeight + MARGIN_Y * 2 + NODE_H;

      // Fit to Screen: the svg's viewBox stays at the graph's natural size,
      // but CSS (.stage.fit svg { width/height: 100% }) stretches/shrinks it
      // to exactly fill the stage, so the browser's own default
      // preserveAspectRatio scaling shows the whole graph with no scroll -
      // simpler and more robust than computing a manual scale factor.
      stage.classList.toggle("fit", fitToScreen);
      const availableWidth = fitToScreen ? naturalWidth : Math.max(560, stage.clientWidth - 32);
      const availableHeight = fitToScreen ? naturalHeight : Math.max(320, stage.clientHeight - 32);
      const width = Math.max(availableWidth, naturalWidth);
      const height = Math.max(availableHeight, naturalHeight);
      // True centering (this is what was missing before): content sits in
      // the middle of the stage when it's narrower/shorter than the
      // viewport, instead of pinned to a fixed left/top margin.
      const offsetX = MARGIN_X + laneLabelWidth + Math.max(0, (width - MARGIN_X * 2 - contentWidth) / 2);
      const offsetY = MARGIN_Y + Math.max(0, (height - MARGIN_Y * 2 - layout.contentHeight) / 2) + NODE_H / 2;

      const cx = (id) => offsetX + layout.positions.get(id).x;
      const cy = (id) => offsetY + layout.positions.get(id).y;

      const laneMarkup = layout.lanes
        ? layout.lanes.map((lane) =>
            '<text class="lane-label" x="' + (offsetX - laneLabelWidth + 8) + '" y="' + (offsetY + lane.y + 4) + '">' + esc(lane.label) + '</text>'
          ).join("")
        : "";

      const edgeMarkup = data.edges
        .map((edge) => {
          if (!layout.positions.has(edge.from) || !layout.positions.has(edge.to)) return "";
          const x0 = cx(edge.from) + (layout.edgeShape === "horizontal" ? NODE_W / 2 : 0);
          const y0 = cy(edge.from) + (layout.edgeShape === "vertical" ? NODE_H / 2 : 0);
          const x1 = cx(edge.to) + (layout.edgeShape === "horizontal" ? -NODE_W / 2 : 0);
          const y1 = cy(edge.to) + (layout.edgeShape === "vertical" ? -NODE_H / 2 : 0);
          return '<path class="edge" data-reason="' + esc(edge.reason) + '" d="' + edgePath(layout.edgeShape, x0, y0, x1, y1) + '"></path>';
        }).join("");

      const nodeMarkup = data.nodes.map((node) => {
        const x = cx(node.id) - NODE_W / 2;
        const y = cy(node.id) - NODE_H / 2;
        const color = "var(--" + (node.servesIntent || "none") + ")";
        return '<g class="node" data-id="' + esc(node.id) + '" transform="translate(' + x + ' ' + y + ')">' +
          '<rect width="' + NODE_W + '" height="' + NODE_H + '" style="stroke:' + color + '"></rect>' +
          '<title>' + esc(node.label) + '</title>' +
          '<text x="12" y="' + Math.round(NODE_H / 2 + 4) + '">' + esc(node.label).slice(0, 34) + '</text>' +
          '</g>';
      }).join("");

      stage.innerHTML = '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Decision map">' + laneMarkup + edgeMarkup + nodeMarkup + '</svg>';

      stage.querySelectorAll(".node").forEach((el) => {
        el.addEventListener("click", () => {
          stage.querySelectorAll(".node rect").forEach((rect) => rect.style.strokeWidth = 2);
          const id = el.getAttribute("data-id");
          const node = data.nodes.find((n) => n.id === id);
          if (!node) return;
          el.querySelector("rect").style.strokeWidth = 3;

          const incoming = data.edges.filter((e) => e.to === id);
          const outgoing = data.edges.filter((e) => e.from === id);
          const labelFor = (nodeId) => {
            const n = data.nodes.find((candidate) => candidate.id === nodeId);
            return n ? n.label : nodeId;
          };

          let html = '<strong>' + esc(node.label) + '</strong>';
          if (incoming.length > 0) {
            html += '<ul>' + incoming.map((e) => '<li>Because of "' + esc(labelFor(e.from)) + '": ' + esc(e.reason) + '</li>').join("") + '</ul>';
          }
          if (outgoing.length > 0) {
            html += '<ul>' + outgoing.map((e) => '<li>Led to "' + esc(labelFor(e.to)) + '": ' + esc(e.reason) + '</li>').join("") + '</ul>';
          }
          if (incoming.length === 0 && outgoing.length === 0) {
            html += '<br>No captured connections to other decisions.';
          }
          detail.innerHTML = html;
        });
      });
    }

    modesEl.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      currentMode = button.dataset.mode;
      render();
    });

    const fitToggle = document.getElementById("fit-toggle");
    fitToggle.addEventListener("click", () => {
      fitToScreen = !fitToScreen;
      fitToggle.classList.toggle("active", fitToScreen);
      render();
    });

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(render, 100);
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
