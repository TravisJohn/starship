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
  ProjectLogEntry,
  ProjectPhasesRequest
} from "../shared/ipc";
import { emptyNoteStatusCounts, type StarshipDb } from "./db";
import { resolveClaudeProjectDir } from "./observation/slug";
import { parseSessionLine } from "./parser";

const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

export const registerDashboardHandlers = (db: StarshipDb): void => {
  ipcMain.handle("dashboard:getState", () => getDashboardState(db, false));

  ipcMain.handle("dashboard:locateRoot", async () => {
    const result = await dialog.showOpenDialog({
      title: "Locate Root",
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    db.setRootPath(result.filePaths[0]);
    return getDashboardState(db, true);
  });

  ipcMain.handle("dashboard:rescan", () => getDashboardState(db, true));

  ipcMain.handle(
    "dashboard:setIgnored",
    (_event, request: DashboardSetIgnoredRequest): MissionProject => {
      db.setProjectIgnored(request.projectPath, request.ignored);

      const resolvedPath = path.resolve(request.projectPath);
      const project = db.listProjects().find((item) => item.path === resolvedPath);
      if (!project) {
        throw new Error(`Project not found: ${resolvedPath}`);
      }

      return decorateProjects(db, [project], false)[0];
    }
  );

  ipcMain.handle(
    "dashboard:refreshProject",
    (_event, request: { projectId: string }): MissionProject => {
      const project = db.getProject(request.projectId);
      if (!project) {
        throw new Error(`Project not found: ${request.projectId}`);
      }

      return decorateProjects(db, [project], false)[0];
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

const getDashboardState = (db: StarshipDb, forceRefresh: boolean): MissionDashboardState => {
  const rootPath = db.getRootPath();
  if (!rootPath) {
    return { rootPath: null, projects: [] };
  }

  const discovered = discoverImmediateChildDirectories(rootPath);
  const projects = db.syncDiscoveredProjects(discovered.paths);

  return {
    rootPath,
    projects: decorateProjects(db, projects, forceRefresh),
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

const decorateProjects = (
  db: StarshipDb,
  projects: Project[],
  forceRefresh: boolean
): MissionProject[] => {
  const ignoredByPath = db.getIgnoredProjectPaths(projects.map((project) => project.path));
  const noteStatusCounts = db.getNoteStatusCounts(projects.map((project) => project.id));

  return projects.map((project) => {
    const transcripts = findAllTranscriptsForProject(project.path);
    const newest = transcripts.at(-1) ?? null;

    return {
      ...project,
      ignored: ignoredByPath.get(project.path) ?? false,
      lastActivityAt: newest ? new Date(newest.mtimeMs).toISOString() : null,
      prdSummary: readPrdSummary(project.path),
      projectLogEntry: findLatestProjectLogEntry(project.path),
      sizeBytes: getCachedProjectSizeBytes(project.path, forceRefresh),
      activityHeatmap: computeSevenDayActivity(transcripts),
      noteStatusCounts: noteStatusCounts.get(project.id) ?? emptyNoteStatusCounts()
    };
  });
};

/**
 * computeProjectSizeBytes walks the whole project tree (including
 * node_modules - see its own docs for why) and can genuinely take seconds
 * for a large real project. That's fine for an explicit Rescan click, but
 * unacceptable for the plain "load the dashboard" / "navigate back to it"
 * path, which fires on every MissionDashboard mount. Cache in-memory per
 * project path for the life of this process - recomputed only when the
 * caller explicitly asks (Rescan, Locate Root, Re-point Root), never on a
 * quiet getState().
 */
const projectSizeCache = new Map<string, number | null>();

export const getCachedProjectSizeBytes = (
  projectPath: string,
  forceRefresh: boolean
): number | null => {
  const resolvedPath = path.resolve(projectPath);
  if (!forceRefresh && projectSizeCache.has(resolvedPath)) {
    return projectSizeCache.get(resolvedPath) ?? null;
  }

  const size = computeProjectSizeBytes(resolvedPath);
  projectSizeCache.set(resolvedPath, size);
  return size;
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
  return findAllTranscriptsForProject(projectPath).at(-1) ?? null;
};

export const findAllTranscriptsForProject = (
  projectPath: string
): { path: string; mtimeMs: number }[] => {
  const projectDir = resolveClaudeProjectDir(projectPath, CLAUDE_PROJECTS_ROOT);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const transcripts: { path: string; mtimeMs: number }[] = [];
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

    transcripts.push({ path: transcriptPath, mtimeMs: stat.mtimeMs });
  }

  return transcripts.sort((a, b) => a.mtimeMs - b.mtimeMs);
};

/**
 * Recursive disk size of the whole project folder, no exclusions (matches
 * "size of the whole project" literally rather than inventing an exclusion
 * policy - e.g. node_modules is included). Tolerant throughout: symlinks are
 * skipped to avoid cycles, any unreadable file/dir is skipped rather than
 * thrown, and only a fully unreadable root returns null.
 */
export const computeProjectSizeBytes = (projectPath: string): number | null => {
  let rootEntries: fs.Dirent[];
  try {
    rootEntries = fs.readdirSync(projectPath, { withFileTypes: true });
  } catch {
    return null;
  }

  let total = 0;
  const walk = (dirPath: string, entries: fs.Dirent[]): void => {
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        let childEntries: fs.Dirent[];
        try {
          childEntries = fs.readdirSync(entryPath, { withFileTypes: true });
        } catch {
          continue;
        }
        walk(entryPath, childEntries);
        continue;
      }

      if (entry.isFile()) {
        try {
          total += fs.statSync(entryPath).size;
        } catch {
          continue;
        }
      }
    }
  };

  walk(projectPath, rootEntries);
  return total;
};

/**
 * Buckets transcript file mtimes into the last 7 calendar days (local time,
 * oldest first) - counts transcripts *touched*, not raw tool/turn counts, a
 * coarse "how active recently" signal in the same spirit as the existing
 * "Last Activity" timestamp rather than a generated narrative subject to
 * the stricter altitude-discipline rule for briefings.
 */
export const computeSevenDayActivity = (
  transcripts: { mtimeMs: number }[]
): { date: string; count: number }[] => {
  const days: { date: string; count: number }[] = [];
  const today = new Date();

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    days.push({ date: formatLocalDate(day), count: 0 });
  }

  const countByDate = new Map(days.map((day) => [day.date, day]));
  for (const transcript of transcripts) {
    const date = formatLocalDate(new Date(transcript.mtimeMs));
    const bucket = countByDate.get(date);
    if (bucket) {
      bucket.count += 1;
    }
  }

  return days;
};

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export const findLatestProjectLogEntry = (
  projectPath: string
): ProjectLogEntry | null => {
  let content: string;
  try {
    content = fs.readFileSync(path.join(projectPath, "PROJECT_LOG.md"), "utf8");
  } catch {
    return null;
  }

  if (content.trim().length === 0) {
    return null;
  }

  const lines = content.split(/\r?\n/);
  const headings: { date: string; title: string; lineIndex: number }[] = [];

  for (const [lineIndex, line] of lines.entries()) {
    const match = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (!match) {
      continue;
    }

    headings.push({
      date: match[1],
      title: line.replace(/^##\s+/, "").trim(),
      lineIndex
    });
  }

  if (headings.length === 0) {
    return null;
  }

  // A single productive day commonly produces several same-dated entries -
  // both real examples this was built against turned out to be single-date
  // logs (TicTacToe: all four entries on one day; Huddle: all seven). ISO
  // date strings alone can't break that tie, and which position ("first in
  // file" or "last in file") is actually the more recent entry depends
  // entirely on the log's own convention (chronological vs "newest at the
  // top"). Two signals, in order:
  //  1. If the file has 2+ *distinct* dates, compare the first and last
  //     dated heading found - reliable regardless of any single-date runs
  //     elsewhere in the file.
  //  2. Otherwise (every heading shares one date, so signal 1 is a no-op),
  //     fall back to an explicit convention statement some logs include as
  //     a preamble before the first heading (Huddle literally says "Newest
  //     entries at the top."). Absence of such a statement defaults to
  //     chronological (oldest-first), matching TicTacToe's real log, which
  //     states no convention at all.
  const distinctDates = new Set(headings.map((heading) => heading.date));
  const isReverseChronological =
    distinctDates.size > 1
      ? headings[0].date > headings[headings.length - 1].date
      : /newest[^.\n]{0,40}top/i.test(lines.slice(0, headings[0].lineIndex).join("\n"));

  const maxDate = headings.reduce(
    (max, heading) => (heading.date > max ? heading.date : max),
    headings[0].date
  );
  const candidates = headings.filter((heading) => heading.date === maxDate);
  const latest = isReverseChronological ? candidates[0] : candidates[candidates.length - 1];

  const bodyLines: string[] = [];
  for (const line of lines.slice(latest.lineIndex + 1)) {
    const headingMatch = line.match(/^(#+)\s/);
    if (headingMatch && headingMatch[1].length <= 2) {
      break;
    }

    const trimmed = line.trim();
    if (trimmed.length > 0) {
      bodyLines.push(trimmed);
    }
  }

  return {
    date: latest.date,
    title: latest.title,
    body: bodyLines.join(" ").replace(/\s+/g, " ").trim()
  };
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
