import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveClaudeProjectDir, slugProjectPath } from "./slug";

describe("slugProjectPath", () => {
  it("matches the real slug for D:\\WEB PROJECTS\\starship", () => {
    expect(slugProjectPath("D:\\WEB PROJECTS\\starship")).toBe("D--WEB-PROJECTS-starship");
  });

  it("matches the real slug for a temp path with spaces", () => {
    const input =
      "C:\\Users\\User\\AppData\\Local\\Temp\\starship-phase1-5Hl7Pz\\Acceptance Project With Spaces";
    const expected =
      "C--Users-User-AppData-Local-Temp-starship-phase1-5Hl7Pz-Acceptance-Project-With-Spaces";
    expect(slugProjectPath(input)).toBe(expected);
  });

  // Regression: the original rule replaced only `:\/ ` and left `.` and `_`
  // intact, so these two projects resolved to directories that do not exist.
  // Nothing was ever tailed for them - no live signals, no last activity, and
  // an empty session briefing on "exit and summarize".
  it("replaces a dot, so Wise Cow 2.0 resolves to its real directory", () => {
    expect(slugProjectPath("D:\\WEB PROJECTS\\Wise Cow 2.0")).toBe(
      "D--WEB-PROJECTS-Wise-Cow-2-0"
    );
  });

  it("replaces an underscore, so my_portfolio resolves to its real directory", () => {
    expect(slugProjectPath("D:\\WEB PROJECTS\\my_portfolio")).toBe(
      "D--WEB-PROJECTS-my-portfolio"
    );
  });

  it("preserves case, matching the real trAvIs directory", () => {
    expect(slugProjectPath("D:\\WEB PROJECTS\\trAvIs")).toBe("D--WEB-PROJECTS-trAvIs");
  });

  it("is not injective: hyphen, space, dot and underscore all collide", () => {
    expect(slugProjectPath("C:\\a b")).toBe(slugProjectPath("C:\\a-b"));
    expect(slugProjectPath("C:\\a.b")).toBe(slugProjectPath("C:\\a_b"));
  });
});

describe("resolveClaudeProjectDir", () => {
  it("joins the claude projects root with the slug", () => {
    const root = path.join("C:", "Users", "User", ".claude", "projects");
    expect(resolveClaudeProjectDir("D:\\WEB PROJECTS\\starship", root)).toBe(
      path.join(root, "D--WEB-PROJECTS-starship")
    );
  });
});
