import { dialog, ipcMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  DashboardLaunchRequest,
  DashboardLaunchResponse,
  DashboardSetIgnoredRequest,
  MissionDashboardState,
  MissionProject,
  PrdPhase,
  Project,
  ProjectPhasesRequest
} from "../shared/ipc";
import type { StarshipDb } from "./db";
import { resolveClaudeProjectDir } from "./observation/slug";
import { parseSessionLine } from "./parser";

const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

export const registerDashboardHandlers = (db: StarshipDb): void => {
  ipcMain.handle("dashboard:getState", () => getDashboardState(db));

  ipcMain.handle("dashboard:locateRoot", async () => {
    const result = await dialog.showOpenDialog({
      title: "Locate Root",
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    db.setRootPath(result.filePaths[0]);
    return getDashboardState(db);
  });

  ipcMain.handle("dashboard:rescan", () => getDashboardState(db));

  ipcMain.handle(
    "dashboard:setIgnored",
    (_event, request: DashboardSetIgnoredRequest): MissionProject => {
      db.setProjectIgnored(request.projectPath, request.ignored);

      const resolvedPath = path.resolve(request.projectPath);
      const project = db.listProjects().find((item) => item.path === resolvedPath);
      if (!project) {
        throw new Error(`Project not found: ${resolvedPath}`);
      }

      return decorateProjects(db, [project])[0];
    }
  );

  ipcMain.handle(
    "dashboard:launch",
    (_event, request: DashboardLaunchRequest): DashboardLaunchResponse => {
      const project = db.getProject(request.projectId);
      if (!project) {
        throw new Error(`Project not found: ${request.projectId}`);
      }

      assertLaunchableProject(project);
      return { project };
    }
  );

  ipcMain.handle(
    "project:getPhases",
    (_event, request: ProjectPhasesRequest): PrdPhase[] => readPrdPhases(request.projectPath)
  );
};

const getDashboardState = (db: StarshipDb): MissionDashboardState => {
  const rootPath = db.getRootPath();
  if (!rootPath) {
    return { rootPath: null, projects: [] };
  }

  const discovered = discoverImmediateChildDirectories(rootPath);
  const projects = db.syncDiscoveredProjects(discovered.paths);

  return {
    rootPath,
    projects: decorateProjects(db, projects),
    scanError: discovered.error
  };
};

const discoverImmediateChildDirectories = (
  rootPath: string
): { paths: string[]; error?: string } => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch (error: unknown) {
    return {
      paths: [],
      error: `Could not scan root folder: ${stringifyError(error)}`
    };
  }

  const paths = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootPath, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

  return { paths };
};

const decorateProjects = (db: StarshipDb, projects: Project[]): MissionProject[] => {
  const ignoredByPath = db.getIgnoredProjectPaths(projects.map((project) => project.path));

  return projects.map((project) => ({
    ...project,
    ignored: ignoredByPath.get(project.path) ?? false,
    lastActivityAt: readLastClaudeActivityAt(project.path),
    prdSummary: readPrdSummary(project.path)
  }));
};

/**
 * The newest transcript file under this project's `~/.claude/projects/<slug>/`
 * directory whose own `cwd` actually matches this project (guards against
 * the slug function's known collisions - see slug.ts). Shared by the
 * dashboard's "last activity" display and the session-briefing generator
 * (briefing.ts), which needs the transcript *path*, not just its mtime.
 */
export const findNewestTranscript = (
  projectPath: string
): { path: string; mtimeMs: number } | null => {
  const projectDir = resolveClaudeProjectDir(projectPath, CLAUDE_PROJECTS_ROOT);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return null;
  }

  let newest: { path: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const transcriptPath = path.join(projectDir, entry.name);
    if (!transcriptBelongsToProject(transcriptPath, projectPath)) {
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(transcriptPath);
    } catch {
      continue;
    }

    if (!newest || stat.mtimeMs > newest.mtimeMs) {
      newest = { path: transcriptPath, mtimeMs: stat.mtimeMs };
    }
  }

  return newest;
};

const readLastClaudeActivityAt = (projectPath: string): string | null => {
  const newest = findNewestTranscript(projectPath);
  return newest ? new Date(newest.mtimeMs).toISOString() : null;
};

export const readPrdSummary = (projectPath: string): string | null => {
  let content: string;
  try {
    content = fs.readFileSync(path.join(projectPath, "PRD.md"), "utf8");
  } catch {
    return null;
  }

  if (content.trim().length === 0) {
    return null;
  }

  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) =>
    /^#{1,6}\s*1\.\s*one-?liner/i.test(line)
  );
  if (headingIndex === -1) {
    return null;
  }

  const summaryLines: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (/^#/.test(line)) {
      break;
    }

    const trimmed = line.trim();
    if (trimmed.length > 0) {
      summaryLines.push(trimmed);
    }
  }

  const summary = summaryLines.join(" ").replace(/\s+/g, " ").trim();
  return summary.length > 0 ? summary : null;
};

/**
 * Every phase listed in the project's own PRD.md (`## 9. Phases`, tolerant
 * of numbering/casing drift the same way `readPrdSummary` is for the
 * one-liner heading), split at each `### Phase N — ...` sub-heading.
 *
 * Deliberately does not attempt to say which phase is "current" - nothing
 * in the transcript reliably signals that a phase has been completed, and
 * guessing wrong would be worse than not guessing. This is a roadmap
 * listing, not a progress tracker.
 */
export const readPrdPhases = (projectPath: string): PrdPhase[] => {
  let content: string;
  try {
    content = fs.readFileSync(path.join(projectPath, "PRD.md"), "utf8");
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const sectionStartIndex = lines.findIndex((line) => /^#{1,6}\s*\d+\.\s*phases/i.test(line));
  if (sectionStartIndex === -1) {
    return [];
  }

  const sectionHeadingDepth = (lines[sectionStartIndex].match(/^#+/)?.[0] ?? "").length;
  const sectionLines: string[] = [];
  for (const line of lines.slice(sectionStartIndex + 1)) {
    const headingMatch = line.match(/^(#+)\s/);
    if (headingMatch && headingMatch[1].length <= sectionHeadingDepth) {
      break;
    }
    sectionLines.push(line);
  }

  const phases: PrdPhase[] = [];
  let currentTitle: string | null = null;
  let currentBody: string[] = [];

  const flush = (): void => {
    if (currentTitle !== null) {
      phases.push({
        title: currentTitle.trim(),
        body: currentBody.join(" ").replace(/\s+/g, " ").trim()
      });
    }
  };

  for (const line of sectionLines) {
    const phaseHeadingMatch = line.match(/^#+\s*(Phase\s+.+)$/i);
    if (phaseHeadingMatch) {
      flush();
      currentTitle = phaseHeadingMatch[1];
      currentBody = [];
      continue;
    }

    const trimmed = line.trim();
    if (currentTitle !== null && trimmed.length > 0) {
      currentBody.push(trimmed);
    }
  }
  flush();

  return phases;
};

const transcriptBelongsToProject = (
  transcriptPath: string,
  projectPath: string
): boolean => {
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return false;
  }

  const resolvedProjectPath = path.resolve(projectPath).toLowerCase();
  for (const line of content.split("\n")) {
    for (const record of parseSessionLine(line)) {
      if (record.kind === "session-meta" && record.cwd) {
        return path.resolve(record.cwd).toLowerCase() === resolvedProjectPath;
      }
    }
  }

  return false;
};

const assertLaunchableProject = (project: Project): void => {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(project.path);
  } catch {
    throw new Error(`Project folder no longer exists. Rescan the dashboard: ${project.path}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Project path is no longer a folder. Rescan the dashboard: ${project.path}`);
  }
};

const stringifyError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
