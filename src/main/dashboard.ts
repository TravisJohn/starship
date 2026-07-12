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
  Project
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
    lastActivityAt: readLastClaudeActivityAt(project.path)
  }));
};

const readLastClaudeActivityAt = (projectPath: string): string | null => {
  const projectDir = resolveClaudeProjectDir(projectPath, CLAUDE_PROJECTS_ROOT);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return null;
  }

  let newestMs: number | null = null;
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

    newestMs = newestMs === null ? stat.mtimeMs : Math.max(newestMs, stat.mtimeMs);
  }

  return newestMs === null ? null : new Date(newestMs).toISOString();
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
