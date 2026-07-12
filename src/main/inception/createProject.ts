import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  InceptionCreateProjectRequest,
  InceptionCreateProjectResponse,
  IntentLedgerInput
} from "../../shared/ipc";
import type { StarshipDb } from "../db";

export const createInceptionProject = async (
  db: StarshipDb,
  request: InceptionCreateProjectRequest
): Promise<InceptionCreateProjectResponse> => {
  const projectPath = resolveProjectPath(
    request.interview.requirements.parentDirectory,
    request.interview.requirements.projectName
  );
  ensureCreatableProjectDirectory(projectPath);

  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(projectPath, "PRD.md"), request.prd, "utf8");
  fs.writeFileSync(path.join(projectPath, "CLAUDE.md"), request.claude, "utf8");

  await initializeGitRepository(projectPath);

  const project = db.addProject(projectPath);
  const intentLedger = db.saveIntentLedger(toIntentLedgerInput(project.id, request));
  const coldPrompt = composeColdPrompt(request);

  return {
    project,
    intentLedger,
    coldPrompt
  };
};

const resolveProjectPath = (
  parentDirectory: string,
  projectName: string
): string => {
  const parent = path.resolve(parentDirectory);
  const folderName = sanitizeFolderName(projectName);
  if (folderName.length === 0) {
    throw new Error("Project name does not produce a valid folder name.");
  }

  return path.join(parent, folderName);
};

const ensureCreatableProjectDirectory = (projectPath: string): void => {
  const parent = path.dirname(projectPath);
  if (!fs.existsSync(parent)) {
    throw new Error(`Parent directory does not exist: ${parent}`);
  }

  if (!fs.statSync(parent).isDirectory()) {
    throw new Error(`Parent path is not a directory: ${parent}`);
  }

  if (!fs.existsSync(projectPath)) {
    return;
  }

  if (!fs.statSync(projectPath).isDirectory()) {
    throw new Error(`Project path exists and is not a directory: ${projectPath}`);
  }

  if (fs.readdirSync(projectPath).length > 0) {
    throw new Error(`Project directory is not empty: ${projectPath}`);
  }
};

const initializeGitRepository = async (projectPath: string): Promise<void> => {
  await runGit(["init"], projectPath);
  await runGit(["add", "PRD.md", "CLAUDE.md"], projectPath);
  await runGit(
    [
      "-c",
      "user.name=Travis",
      "-c",
      "user.email=travis@starship.local",
      "commit",
      "-m",
      "chore: initial project brief"
    ],
    projectPath
  );
};

const runGit = (args: string[], cwd: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(resolveGitCommand(), args, {
      cwd,
      env: process.env,
      windowsHide: true
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`));
    });
  });

const resolveGitCommand = (): string => {
  if (os.platform() === "win32") {
    return "git.exe";
  }

  return "git";
};

const sanitizeFolderName = (projectName: string): string =>
  projectName
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");

const toIntentLedgerInput = (
  projectId: string,
  request: InceptionCreateProjectRequest
): IntentLedgerInput => ({
  projectId,
  purpose: request.interview.intent.purpose,
  successCriteria: request.interview.intent.successCriteria,
  acceptedTradeoffs: request.interview.intent.acceptedTradeoffs,
  neverDo: request.interview.intent.neverDo
});

const composeColdPrompt = (request: InceptionCreateProjectRequest): string => {
  const { intent, requirements } = request.interview;

  return [
    "Read PRD.md and CLAUDE.md in full before doing anything else.",
    "",
    "Intent Ledger:",
    `Purpose: ${intent.purpose}`,
    `Success definition: ${intent.successCriteria}`,
    `Accepted tradeoffs: ${intent.acceptedTradeoffs}`,
    `Never do: ${intent.neverDo}`,
    intent.learningGoal ? `Learning goal: ${intent.learningGoal}` : "",
    "",
    `Project premise: ${requirements.oneLiner}`,
    `First working version: ${requirements.firstVersionScope}`,
    "",
    "Present a Phase 1 plan with discrete tasks and dependencies, flag the largest risk, and wait for approval before code."
  ]
    .filter((line) => line.length > 0)
    .join("\n");
};
