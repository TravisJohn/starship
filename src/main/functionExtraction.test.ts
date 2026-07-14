import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractFunctionNames } from "./functionExtraction";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-function-extraction-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const writeFile = (name: string, content: string): string => {
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
};

describe("extractFunctionNames", () => {
  it("extracts a plain function declaration", () => {
    const filePath = writeFile("a.ts", "export function buildThing() { return 1; }");
    expect(extractFunctionNames(filePath)).toEqual(["buildThing"]);
  });

  it("extracts an arrow function assigned to a const", () => {
    const filePath = writeFile("a.ts", "export const buildThing = () => { return 1; };");
    expect(extractFunctionNames(filePath)).toEqual(["buildThing"]);
  });

  it("extracts a function expression assigned to a const", () => {
    const filePath = writeFile("a.js", "const buildThing = function () { return 1; };");
    expect(extractFunctionNames(filePath)).toEqual(["buildThing"]);
  });

  it("extracts class methods prefixed with the class name", () => {
    const filePath = writeFile(
      "a.ts",
      "class Widget { render() { return null; } static create() { return new Widget(); } }"
    );
    expect(extractFunctionNames(filePath)).toEqual(["Widget.render", "Widget.create"]);
  });

  it("skips anonymous inline callbacks with no bindable name", () => {
    const filePath = writeFile("a.ts", "[1, 2, 3].map(function (x) { return x * 2; });");
    expect(extractFunctionNames(filePath)).toEqual([]);
  });

  it("handles .tsx and .jsx script kinds", () => {
    const tsxPath = writeFile(
      "a.tsx",
      "export function Widget() { return <div>hi</div>; }"
    );
    expect(extractFunctionNames(tsxPath)).toEqual(["Widget"]);

    const jsxPath = writeFile(
      "b.jsx",
      "export function Widget() { return <div>hi</div>; }"
    );
    expect(extractFunctionNames(jsxPath)).toEqual(["Widget"]);
  });

  it("returns [] for a file that parses fine but has no functions", () => {
    const filePath = writeFile("a.ts", "export const value = 42;");
    expect(extractFunctionNames(filePath)).toEqual([]);
  });

  it("returns null for an unsupported extension without attempting a read", () => {
    const filePath = writeFile("a.py", "def build_thing():\n    return 1\n");
    expect(extractFunctionNames(filePath)).toBeNull();
  });

  it("returns null for a file that doesn't exist", () => {
    expect(extractFunctionNames(path.join(tempDir, "missing.ts"))).toBeNull();
  });

  it("returns null for a file over the size guard", () => {
    const filePath = writeFile("big.ts", `export const value = "${"x".repeat(600 * 1024)}";`);
    expect(extractFunctionNames(filePath)).toBeNull();
  });
});
