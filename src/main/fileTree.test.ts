import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProjectFileTree, DEFAULT_EXCLUDED_DIRS } from "./fileTree";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-file-tree-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const write = (relativePath: string, content: string): void => {
  const filePath = path.join(tempDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
};

describe("buildProjectFileTree", () => {
  it("returns null when the project root can't be read", () => {
    expect(buildProjectFileTree(path.join(tempDir, "missing"))).toBeNull();
  });

  it("builds nested folders and files with relative paths", () => {
    write("src/main/index.ts", "export function main() {}");
    write("README.md", "# hi");

    const tree = buildProjectFileTree(tempDir);
    expect(tree?.type).toBe("directory");
    expect(tree?.path).toBe("");

    const src = tree?.children?.find((n) => n.name === "src");
    expect(src?.type).toBe("directory");
    expect(src?.path).toBe("src");

    const main = src?.children?.find((n) => n.name === "main");
    const indexFile = main?.children?.find((n) => n.name === "index.ts");
    expect(indexFile).toEqual({
      name: "index.ts",
      path: "src/main/index.ts",
      type: "file",
      functions: ["main"]
    });

    const readme = tree?.children?.find((n) => n.name === "README.md");
    expect(readme).toEqual({
      name: "README.md",
      path: "README.md",
      type: "file",
      functions: null
    });
  });

  it("skips every DEFAULT_EXCLUDED_DIRS entry and never descends into it", () => {
    for (const dirName of DEFAULT_EXCLUDED_DIRS) {
      write(`${dirName}/should-not-appear.ts`, "export function hidden() {}");
    }
    write("src/app.ts", "export function app() {}");

    const tree = buildProjectFileTree(tempDir);
    const topLevelNames = tree?.children?.map((n) => n.name) ?? [];

    for (const dirName of DEFAULT_EXCLUDED_DIRS) {
      expect(topLevelNames).not.toContain(dirName);
    }
    expect(topLevelNames).toContain("src");
  });

  it("still shows a directory as an empty node when all its children are excluded", () => {
    write("vendor/node_modules/pkg/index.js", "module.exports = {};");

    const tree = buildProjectFileTree(tempDir);
    const vendor = tree?.children?.find((n) => n.name === "vendor");
    expect(vendor).toBeDefined();
    expect(vendor?.type).toBe("directory");
    expect(vendor?.children).toEqual([]);
  });

  it("sorts directories before files, alphabetically within each group", () => {
    write("b.ts", "export const b = 1;");
    write("a.ts", "export const a = 1;");
    write("zdir/inner.ts", "export const inner = 1;");

    const tree = buildProjectFileTree(tempDir);
    const names = tree?.children?.map((n) => n.name);
    expect(names).toEqual(["zdir", "a.ts", "b.ts"]);
  });

  it("attaches function extraction results only to supported extensions", () => {
    write("script.py", "def hidden():\n    pass\n");
    write("app.tsx", "export function App() { return null; }");

    const tree = buildProjectFileTree(tempDir);
    const py = tree?.children?.find((n) => n.name === "script.py");
    const tsx = tree?.children?.find((n) => n.name === "app.tsx");

    expect(py?.functions).toBeNull();
    expect(tsx?.functions).toEqual(["App"]);
  });
});
