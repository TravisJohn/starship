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

  it("is not injective: a literal hyphen and a space collide", () => {
    expect(slugProjectPath("C:\\a b")).toBe(slugProjectPath("C:\\a-b"));
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
