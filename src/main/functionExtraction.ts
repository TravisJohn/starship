import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript-classic";

const SUPPORTED_EXTENSIONS: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX
};

const MAX_FILE_SIZE_BYTES = 512 * 1024;

/**
 * Returns `null` when extraction wasn't attempted (unsupported extension,
 * oversized file, unreadable file, or a parse failure) - reserved
 * separately from `[]`, which means "parsed fine, genuinely no functions."
 * The tree UI needs to tell these apart rather than showing an empty list
 * for a language it never actually looked at.
 */
export const extractFunctionNames = (filePath: string): string[] | null => {
  const scriptKind = SUPPORTED_EXTENSIONS[path.extname(filePath).toLowerCase()];
  if (scriptKind === undefined) {
    return null;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }

  if (stat.size > MAX_FILE_SIZE_BYTES) {
    return null;
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

    const names: string[] = [];
    visit(sourceFile, sourceFile, names);
    return names;
  } catch {
    return null;
  }
};

const visit = (node: ts.Node, sourceFile: ts.SourceFile, names: string[]): void => {
  if (ts.isFunctionDeclaration(node) && node.name) {
    names.push(node.name.text);
  } else if (ts.isMethodDeclaration(node)) {
    const methodName = propertyNameText(node.name, sourceFile);
    if (methodName) {
      const className = enclosingClassName(node);
      names.push(className ? `${className}.${methodName}` : methodName);
    }
  } else if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  ) {
    names.push(node.name.text);
  }

  ts.forEachChild(node, (child) => visit(child, sourceFile, names));
};

const propertyNameText = (name: ts.PropertyName, sourceFile: ts.SourceFile): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  // Computed property names (e.g. [Symbol.iterator]) - not a stable/bindable
  // name worth surfacing; source text is the honest fallback.
  return name.getText(sourceFile);
};

const enclosingClassName = (node: ts.Node): string | null => {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
      return current.name?.text ?? null;
    }
    current = current.parent;
  }
  return null;
};
