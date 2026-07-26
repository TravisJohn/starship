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
import { generateDiscussReply } from "./inceptionDiscuss";

let tempDir: string;
let previousPromptDir: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-inception-discuss-"));
  previousPromptDir = process.env.STARSHIP_PROMPT_DIR;
  process.env.STARSHIP_PROMPT_DIR = tempDir;
  fs.writeFileSync(
    path.join(tempDir, "inception-discuss.md"),
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

  it("works for a requirements-step field, not just intent fields", async () => {
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({
        reply: "Who specifically hits this friction today?",
        proposedRewrite: null
      })
    );

    const result = await generateDiscussReply(makeDb(), {
      field: "audience",
      fieldLabel: "Who is it for, even if that is only you?",
      currentValue: "",
      history: [],
      message: "Just me for now, but maybe others later."
    });

    expect(result.reply).toBe("Who specifically hits this friction today?");
  });

  it("embeds the intent ledger in the prompt when intentContext is provided", async () => {
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({ reply: "Noted.", proposedRewrite: null })
    );

    await generateDiscussReply(makeDb(), {
      field: "outOfScope",
      fieldLabel: "What is explicitly out of scope for the first version?",
      currentValue: "",
      history: [],
      message: "Should multi-user support be out of scope?",
      intentContext: {
        purpose: "Help one person track their own habits.",
        successCriteria: "Used daily for a month.",
        acceptedTradeoffs: "No polish, just function.",
        neverDo: "Become a multi-user product.",
        learningGoal: "Learn SQLite."
      }
    });

    const prompt = vi.mocked(runHeadlessClaude).mock.calls[0][1].prompt;
    expect(prompt).toContain("Become a multi-user product.");
  });

  it("omits intentContext from the prompt payload when not provided", async () => {
    vi.mocked(runHeadlessClaude).mockResolvedValue(
      JSON.stringify({ reply: "Got it.", proposedRewrite: null })
    );

    await generateDiscussReply(makeDb(), {
      field: "purpose",
      fieldLabel: "Why should this project exist?",
      currentValue: "",
      history: [],
      message: "I want to learn Electron."
    });

    const prompt = vi.mocked(runHeadlessClaude).mock.calls[0][1].prompt;
    expect(prompt).toContain('"intentContext": null');
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
