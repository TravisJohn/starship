import fs from "node:fs";
import path from "node:path";
import { extractFunctionNames } from "./functionExtraction";

export type FileTreeNode = {
  name: string;
  path: string;
  type: "directory" | "file";
  children?: FileTreeNode[];
  functions?: string[] | null;
};

export const DEFAULT_EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "__pycache__",
  ".venv",
  "coverage",
  ".cache"
]);

/**
 * Real, whole-project folder/file structure (unlike the touched-files DAG,
 * which is derived from transcript history). Noise directories are skipped
 * before recursing - never descended into, so this stays cheap even for a
 * project with a huge node_modules tree. Tolerant throughout: symlinks and
 * unreadable entries are skipped rather than thrown, matching
 * `computeProjectSizeBytes`'s posture in dashboard.ts. Returns null only
 * when the project root itself can't be read.
 */
export const buildProjectFileTree = (projectPath: string): FileTreeNode | null => {
  let rootEntries: fs.Dirent[];
  try {
    rootEntries = fs.readdirSync(projectPath, { withFileTypes: true });
  } catch {
    return null;
  }

  return {
    name: path.basename(projectPath) || projectPath,
    path: "",
    type: "directory",
    children: buildChildren(projectPath, "", rootEntries)
  };
};

const buildChildren = (
  absoluteDir: string,
  relativeDir: string,
  entries: fs.Dirent[]
): FileTreeNode[] => {
  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const absolutePath = path.join(absoluteDir, entry.name);

    if (entry.isDirectory()) {
      if (DEFAULT_EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }

      let childEntries: fs.Dirent[];
      try {
        childEntries = fs.readdirSync(absolutePath, { withFileTypes: true });
      } catch {
        continue;
      }

      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        children: buildChildren(absolutePath, relativePath, childEntries)
      });
      continue;
    }

    if (entry.isFile()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "file",
        functions: extractFunctionNames(absolutePath)
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
};
