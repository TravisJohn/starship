import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StarshipDb } from "./db";

vi.mock("electron", () => ({
  app: { getAppPath: vi.fn(), getPath: vi.fn() },
  ipcMain: { handle: vi.fn() }
}));

vi.mock("./inception/headlessClaude", () => ({
  getHeadlessCwd: vi.fn(() => "D:\\WEB PROJECTS\\starship"),
  runHeadlessClaude: vi.fn()
}));

import { runHeadlessClaude } from "./inception/headlessClaude";
import { generateDiscussReply } from "./intentDiscuss";

let tempDir: string;
let previousPromptDir: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-intent-discuss-"));
  previousPromptDir = process.env.STARSHIP_PROMPT_DIR;
  process.env.STARSHIP_PROMPT_DIR = tempDir;
  fs.writeFileSync(
    path.join(tempDir, "intent-discuss.md"),
    "Discuss.\n\nInput:\n{{payload_json}}",
    "utf8"
  );
  vi.mocked(runHeadlessClaude).mockReset();
});

afterEach(() => {
  if (previousPromptDir === undefined) {
    delete process.env.STARSHIP_PROMPT_DIR;
  } else {
    process.env.STARSHIP_PROMPT_DIR = previousPromptDir;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const makeDb = (): StarshipDb => ({}) as unknown as StarshipDb;

describe("generateDiscussReply", () => {
  it("returns the reply and proposed rewrite from a successful headless call", async () => {
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({
        reply: "What would make this project feel finished to you?",
        proposedRewrite: null
      })
    );

    const result = await generateDiscussReply(makeDb(), {
      field: "purpose",
      fieldLabel: "Why should this project exist?",
      currentValue: "",
      history: [],
      message: "I want to learn Electron."
    });

    expect(result).toEqual({
      reply: "What would make this project feel finished to you?",
      proposedRewrite: null
    });
  });

  it("sends the full conversation history embedded in the prompt", async () => {
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({ reply: "Got it.", proposedRewrite: "A tightened answer." })
    );

    await generateDiscussReply(makeDb(), {
      field: "purpose",
      fieldLabel: "Why should this project exist?",
      currentValue: "To learn.",
      history: [
        { role: "user", text: "I want to learn Electron." },
        { role: "assistant", text: "What specifically about Electron?" }
      ],
      message: "The IPC model, mostly."
    });

    const prompt = vi.mocked(runHeadlessClaude).mock.calls[0][1].prompt;
    expect(prompt).toContain("I want to learn Electron.");
    expect(prompt).toContain("What specifically about Electron?");
    expect(prompt).toContain("The IPC model, mostly.");
  });

  it("returns a proposed rewrite when the response includes one", async () => {
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({
        reply: "Here's a tighter version of your answer.",
        proposedRewrite: "To learn Electron's IPC model by building something real."
      })
    );

    const result = await generateDiscussReply(makeDb(), {
      field: "purpose",
      fieldLabel: "Why should this project exist?",
      currentValue: "To learn.",
      history: [],
      message: "Can you tighten that up?"
    });

    expect(result.proposedRewrite).toBe(
      "To learn Electron's IPC model by building something real."
    );
  });

  it("degrades gracefully when the headless call fails", async () => {
    vi.mocked(runHeadlessClaude).mockRejectedValue(new Error("claude unavailable"));

    const result = await generateDiscussReply(makeDb(), {
      field: "purpose",
      fieldLabel: "Why should this project exist?",
      currentValue: "",
      history: [],
      message: "Hello?"
    });

    expect(result).toEqual({
      reply: "Couldn't reach the assistant right now.",
      proposedRewrite: null
    });
  });

  it("degrades gracefully when the response isn't valid JSON", async () => {
    vi.mocked(runHeadlessClaude).mockResolvedValue("not json at all");

    const result = await generateDiscussReply(makeDb(), {
      field: "purpose",
      fieldLabel: "Why should this project exist?",
      currentValue: "",
      history: [],
      message: "Hello?"
    });

    expect(result).toEqual({
      reply: "Couldn't reach the assistant right now.",
      proposedRewrite: null
    });
  });

  it("degrades gracefully when the response is missing a reply field", async () => {
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({ proposedRewrite: "Some rewrite" })
    );

    const result = await generateDiscussReply(makeDb(), {
      field: "purpose",
      fieldLabel: "Why should this project exist?",
      currentValue: "",
      history: [],
      message: "Hello?"
    });

    expect(result).toEqual({
      reply: "Couldn't reach the assistant right now.",
      proposedRewrite: null
    });
  });
});
