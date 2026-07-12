import path from "node:path";

/**
 * Reproduces Claude Code's project-directory slug, reverse-engineered from
 * real `~/.claude/projects/<slug>/` directory names on this machine (not
 * documented anywhere): every `:`, `\`, `/`, and space in the absolute
 * project path becomes a literal `-`, one-for-one, with no collapsing of
 * runs.
 *
 * Confirmed examples:
 *   D:\WEB PROJECTS\starship
 *     -> D--WEB-PROJECTS-starship
 *   C:\Users\User\AppData\Local\Temp\...\Acceptance Project With Spaces
 *     -> C--Users-User-AppData-Local-Temp-...-Acceptance-Project-With-Spaces
 *
 * This is NOT injective: a literal hyphen and a space both map to `-`, so
 * `C:\a b` and `C:\a-b` collide. Callers must not treat a slug match alone
 * as proof of identity - cross-check against the transcript's own `cwd`
 * field (see correlate.ts).
 */
export const slugProjectPath = (absoluteProjectPath: string): string =>
  absoluteProjectPath.replace(/[:\\/ ]/g, "-");

export const resolveClaudeProjectDir = (
  projectPath: string,
  claudeProjectsRoot: string
): string => path.join(claudeProjectsRoot, slugProjectPath(path.resolve(projectPath)));
