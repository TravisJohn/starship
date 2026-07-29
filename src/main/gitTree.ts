import { dialog, ipcMain } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  GitCommitEntry,
  GitTreeDownloadRequest,
  GitTreeDownloadResponse,
  GitTreeGenerateRequest,
  GitTreeGenerateResponse,
  GitTreeResult
} from "../shared/ipc";
import type { StarshipDb } from "./db";

export const registerGitTreeHandlers = (db: StarshipDb): void => {
  ipcMain.handle(
    "gitTree:generate",
    async (_event, request: GitTreeGenerateRequest): Promise<GitTreeGenerateResponse> => {
      const result = await generateGitTree(request);
      const projectName =
        db.getProject(request.projectId)?.name ?? path.basename(request.projectPath);

      return {
        html: renderGitTreeHtml(result, projectName),
        commitCount: result.commits.length,
        generatedAt: result.generatedAt,
        notARepo: result.notARepo
      };
    }
  );

  ipcMain.handle(
    "gitTree:download",
    async (_event, request: GitTreeDownloadRequest): Promise<GitTreeDownloadResponse> => {
      const result = await dialog.showSaveDialog({
        title: "Save Git Tree",
        defaultPath: `${sanitizeFileName(request.projectName)}-git-tree.html`,
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

const resolveGitCommand = (): string => (os.platform() === "win32" ? "git.exe" : "git");

// Unit separator - not a character any real commit subject line will
// contain, unlike a comma or pipe which git subjects use freely.
const FIELD_SEP = "\x1f";

// Bounds a pathological project's history to a manageable artifact size,
// same rationale as PROMPT_PAYLOAD_BUDGET in decisionMap.ts - this is a
// display cap, not a data-loss concern, since `git log` itself is always
// re-runnable for the full history from a real terminal.
const COMMIT_LIMIT = 300;

const runGitLog = (cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      resolveGitCommand(),
      [
        "log",
        `--format=%H${FIELD_SEP}%h${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%ad${FIELD_SEP}%D${FIELD_SEP}%s`,
        "--date=iso-strict",
        "-n",
        String(COMMIT_LIMIT),
        "--no-color"
      ],
      { cwd, env: process.env, windowsHide: true }
    );

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

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `git log exited with ${code ?? "unknown"}`));
        return;
      }
      resolve(stdout);
    });
  });

const parseCommitLine = (line: string): GitCommitEntry | null => {
  const parts = line.split(FIELD_SEP);
  if (parts.length < 7) {
    return null;
  }

  const [hash, shortHash, parentsRaw, author, date, refsRaw, subject] = parts;
  if (!hash || !shortHash) {
    return null;
  }

  const parents = parentsRaw.trim().length > 0 ? parentsRaw.trim().split(" ") : [];
  const refs = refsRaw
    .split(",")
    .map((ref) => ref.trim())
    .filter((ref) => ref.length > 0);

  return {
    hash,
    shortHash,
    parents,
    author,
    date,
    refs,
    subject,
    isMerge: parents.length > 1
  };
};

/**
 * A straight, single-lane commit history - not a full multi-branch graph
 * with lane assignment (what gitk/GitKraken draw). Plain `git log` (HEAD
 * only, no --all) already linearizes history in one chronological pass; a
 * merge commit still appears, tagged with its parent count, it just isn't
 * drawn as a second visual lane. Assigning real branch lanes is a
 * meaningfully harder layout problem than this pass was scoped for - kept
 * as a possible later upgrade, not attempted here.
 */
export const generateGitTree = async (request: GitTreeGenerateRequest): Promise<GitTreeResult> => {
  const generatedAt = new Date().toISOString();

  try {
    const stdout = await runGitLog(request.projectPath);
    const commits = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(parseCommitLine)
      .filter((entry): entry is GitCommitEntry => entry !== null);

    return { commits, generatedAt, notARepo: false };
  } catch {
    // Covers "not a git repo yet", "git not on PATH", and any other spawn
    // failure alike - same tolerant-degradation posture as File Map's
    // "couldn't read the project folder", not a hard error surface.
    return { commits: [], generatedAt, notARepo: true };
  }
};

export const renderGitTreeHtml = (result: GitTreeResult, projectName: string): string => {
  const data = serializeJsonForScript({ commits: result.commits });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(projectName)} Git Tree</title>
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
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header { padding: 20px 24px 14px; border-bottom: 1px solid var(--soft); }
    h1 { margin: 0; font-size: 18px; font-weight: 700; }
    .meta { margin-top: 8px; color: var(--muted); font-size: 12px; }
    .wrap {
      display: grid;
      grid-template-rows: 1fr auto;
      height: calc(100vh - 76px);
      min-height: 420px;
    }
    .stage { overflow: auto; padding: 16px 24px; }
    .empty {
      display: grid;
      height: 100%;
      place-items: center;
      padding: 24px;
      color: var(--muted);
      text-align: center;
      font-size: 13px;
    }
    .commit {
      display: flex;
      gap: 12px;
      border: 1px solid var(--soft);
      background: var(--panel);
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 8px;
      cursor: pointer;
    }
    .commit:hover { border-color: var(--accent); }
    .commit .hash {
      flex-shrink: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: var(--accent);
      padding-top: 1px;
    }
    .commit .body { min-width: 0; flex: 1; }
    .commit .subject {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .commit .sub { margin-top: 3px; font-size: 11px; color: var(--muted); }
    .refs { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
    .tag {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--soft);
      color: var(--muted);
    }
    .tag.ref { border-color: var(--accent); color: var(--accent); }
    .tag.merge { border-color: #f59e0b; color: #f59e0b; }
    .detail {
      border-top: 1px solid var(--soft);
      background: #111113;
      padding: 14px 24px;
      min-height: 72px;
      max-height: 220px;
      overflow: auto;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .detail strong { color: var(--text); }
    .detail .row { margin-top: 6px; }
    .detail .label { color: var(--text); font-weight: 600; margin-right: 6px; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(projectName)} Git Tree</h1>
    <div class="meta">${result.commits.length} commit${result.commits.length === 1 ? "" : "s"}, generated ${escapeHtml(result.generatedAt)}</div>
  </header>
  <div class="wrap">
    <div class="stage" id="stage"></div>
    <div class="detail" id="detail"><strong>Commit details</strong></div>
  </div>
  <script>
    const data = ${data};
    const stage = document.getElementById("stage");
    const detail = document.getElementById("detail");
    const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

    const byHash = new Map(data.commits.map((c) => [c.hash, c]));

    function commitHtml(commit) {
      const tags = commit.refs.map((ref) => '<span class="tag ref">' + esc(ref) + '</span>');
      if (commit.isMerge) {
        tags.push('<span class="tag merge">merge \\u00d7' + commit.parents.length + '</span>');
      }

      return '<div class="commit" data-hash="' + esc(commit.hash) + '">' +
        '<div class="hash">' + esc(commit.shortHash) + '</div>' +
        '<div class="body">' +
          '<div class="subject">' + esc(commit.subject) + '</div>' +
          '<div class="sub">' + esc(commit.author) + ' \\u00b7 ' + esc(commit.date) + '</div>' +
          (tags.length ? '<div class="refs">' + tags.join("") + '</div>' : '') +
        '</div>' +
      '</div>';
    }

    function render() {
      if (data.commits.length === 0) {
        stage.innerHTML = '<div class="empty">No commits yet - this fills in once the project has a git history.</div>';
        return;
      }

      stage.innerHTML = data.commits.map(commitHtml).join("");

      stage.querySelectorAll(".commit").forEach((el) => {
        el.addEventListener("click", () => {
          const commit = byHash.get(el.getAttribute("data-hash"));
          if (!commit) return;

          let html = '<strong>' + esc(commit.subject) + '</strong>';
          html += '<div class="row"><span class="label">Hash</span>' + esc(commit.hash) + '</div>';
          html += '<div class="row"><span class="label">Author</span>' + esc(commit.author) + '</div>';
          html += '<div class="row"><span class="label">Date</span>' + esc(commit.date) + '</div>';
          html += '<div class="row"><span class="label">Parents</span>' + (commit.parents.length ? commit.parents.map((p) => esc(p.slice(0, 12))).join(", ") : "none (root commit)") + '</div>';
          detail.innerHTML = html;
        });
      });
    }

    render();
  </script>
</body>
</html>`;
};

const serializeJsonForScript = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");

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

const sanitizeFileName = (value: string): string => {
  const sanitized = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").trim();
  return sanitized.length > 0 ? sanitized : "project";
};
