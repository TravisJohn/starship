import path from "node:path";

/**
 * Reproduces Claude Code's project-directory slug, reverse-engineered from
 * real `~/.claude/projects/<slug>/` directory names on this machine (not
 * documented anywhere): every character that is not ASCII alphanumeric
 * becomes a literal `-`, one-for-one, with no collapsing of runs. Case is
 * preserved.
 *
 * An earlier version of this replaced only `:`, `\`, `/`, and space, which
 * matched most paths and so looked correct. It silently broke any project
 * whose folder name contained a `.` or `_`: `D:\WEB PROJECTS\Wise Cow 2.0`
 * resolved to `...-Wise-Cow-2.0`, a directory that does not exist, so no
 * transcript was ever found for it - no live signals, no last activity, and
 * nothing for the session briefing to summarize. Verified against all 24
 * real project directories on this machine by comparing each transcript's
 * own `cwd` field to its containing directory name; the rule below matched
 * every one, the old rule missed two.
 *
 * Confirmed examples:
 *   D:\WEB PROJECTS\starship     -> D--WEB-PROJECTS-starship
 *   D:\WEB PROJECTS\Wise Cow 2.0 -> D--WEB-PROJECTS-Wise-Cow-2-0
 *   D:\WEB PROJECTS\my_portfolio -> D--WEB-PROJECTS-my-portfolio
 *
 * This is NOT injective: a literal hyphen, a space, a dot and an underscore
 * all map to `-`, so `C:\a b` and `C:\a-b` collide. Callers must not treat a
 * slug match alone as proof of identity - cross-check against the
 * transcript's own `cwd` field (see correlate.ts).
 *
 * `templates/permission-hook.cjs` carries a copy of this rule (it runs as a
 * plain Node process outside Electron and cannot import from here). Keep the
 * two in sync.
 */
export const slugProjectPath = (absoluteProjectPath: string): string =>
  absoluteProjectPath.replace(/[^a-zA-Z0-9]/g, "-");

export const resolveClaudeProjectDir = (
  projectPath: string,
  claudeProjectsRoot: string
): string => path.join(claudeProjectsRoot, slugProjectPath(path.resolve(projectPath)));
