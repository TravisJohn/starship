import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateGitTree, renderGitTreeHtml } from "./gitTree";

let repoPath: string;

const git = (args: string[]): void => {
  execFileSync("git", args, { cwd: repoPath, env: process.env });
};

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "starship-git-tree-"));
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Test User"]);
  git(["config", "user.email", "test@example.com"]);
});

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true });
});

const commit = (fileName: string, message: string): void => {
  fs.writeFileSync(path.join(repoPath, fileName), message);
  git(["add", fileName]);
  git(["commit", "-m", message]);
};

describe("generateGitTree", () => {
  it("returns commits newest-first with subject, author, and hash populated - what the whole feature is for", async () => {
    commit("a.txt", "first commit");
    commit("b.txt", "second commit");

    const result = await generateGitTree({ projectId: "p1", projectPath: repoPath });

    expect(result.notARepo).toBe(false);
    expect(result.commits).toHaveLength(2);
    expect(result.commits[0].subject).toBe("second commit");
    expect(result.commits[1].subject).toBe("first commit");
    expect(result.commits[0].author).toBe("Test User");
    expect(result.commits[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(result.commits[1].parents).toEqual([]);
  });

  it("flags a merge commit by its parent count - the one thing this pass deliberately does NOT try to lay out as separate branch lanes", async () => {
    commit("a.txt", "on main");
    git(["checkout", "-b", "feature"]);
    commit("b.txt", "on feature");
    git(["checkout", "main"]);
    git(["merge", "--no-ff", "-m", "merge feature", "feature"]);

    const result = await generateGitTree({ projectId: "p1", projectPath: repoPath });

    const merge = result.commits.find((c) => c.subject === "merge feature");
    expect(merge).toBeDefined();
    expect(merge?.isMerge).toBe(true);
    expect(merge?.parents).toHaveLength(2);
  });

  it("degrades to an empty, non-error result when the path isn't a git repo at all - same tolerant posture as File Map's missing-folder case", async () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), "starship-not-a-repo-"));
    try {
      const result = await generateGitTree({ projectId: "p1", projectPath: notARepo });
      expect(result.notARepo).toBe(true);
      expect(result.commits).toEqual([]);
    } finally {
      fs.rmSync(notARepo, { recursive: true, force: true });
    }
  });
});

describe("renderGitTreeHtml", () => {
  it("renders the honest empty state instead of a fabricated commit when there are none", () => {
    const html = renderGitTreeHtml({ commits: [], generatedAt: "2026-07-29T00:00:00.000Z", notARepo: false }, "Demo");
    expect(html).toContain("No commits yet");
  });

  it("never lets a commit subject break out of its JSON payload into raw HTML", () => {
    const html = renderGitTreeHtml(
      {
        commits: [
          {
            hash: "abc123",
            shortHash: "abc123",
            parents: [],
            author: "Test",
            date: "2026-07-29T00:00:00.000Z",
            refs: [],
            subject: "</script><script>alert(1)</script>",
            isMerge: false
          }
        ],
        generatedAt: "2026-07-29T00:00:00.000Z",
        notARepo: false
      },
      "Demo"
    );
    expect(html).not.toContain("</script><script>alert(1)</script>");
  });
});
