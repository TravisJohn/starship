import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  IntentAnnotationRequest,
  IntentAnnotationResult,
  KanbanTaskDto,
  TaskAnnotation
} from "../shared/ipc";
import { findNewestTranscript } from "./dashboard";
import type { StarshipDb } from "./db";
import { getHeadlessCwd, runHeadlessClaude } from "./inception/headlessClaude";
import { interpretTaskCreateInput } from "./parser";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null ? (value as JsonRecord) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export type TaskReasoning = {
  label: string;
  reasoning: string | null;
};

export const registerIntentAnnotationHandlers = (db: StarshipDb): void => {
  ipcMain.handle(
    "intent:annotate",
    (_event, request: IntentAnnotationRequest): Promise<IntentAnnotationResult> =>
      generateIntentAnnotation(db, request)
  );
};

/**
 * Extracts the nearest-preceding assistant reasoning text for every
 * `TaskCreate` call in one transcript's content, in the order those calls
 * appear. Deliberately does not track `TaskUpdate` - a status change doesn't
 * need its own rationale, only the original creation/positioning does.
 *
 * Mirrors buildSessionNarrative/buildFileTouchTimeline's tolerant per-line
 * JSON parse (skip unparseable lines, never throw).
 */
const extractTaskReasoningFromContent = (content: string): TaskReasoning[] => {
  const timeline: TaskReasoning[] = [];
  let mostRecentText: string | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const record = asRecord(parsed);
    if (!record || record.type !== "assistant") {
      continue;
    }

    const message = asRecord(record.message);
    const contentBlocks = message?.content;
    if (!Array.isArray(contentBlocks)) {
      continue;
    }

    for (const block of contentBlocks) {
      const blockRecord = asRecord(block);
      if (!blockRecord) {
        continue;
      }

      if (blockRecord.type === "text") {
        const text = asString(blockRecord.text);
        if (text && text.trim()) {
          mostRecentText = text.trim();
        }
        continue;
      }

      if (blockRecord.type !== "tool_use" || asString(blockRecord.name) !== "TaskCreate") {
        continue;
      }

      const shape = interpretTaskCreateInput(blockRecord.input);
      if (shape.form === "incremental") {
        timeline.push({ label: shape.label, reasoning: mostRecentText });
      } else if (shape.form === "bulk") {
        for (const item of shape.items) {
          timeline.push({ label: item.label, reasoning: mostRecentText });
        }
      }
    }
  }

  return timeline;
};

/**
 * Reads a single transcript and extracts its task-reasoning timeline. This
 * is a single transcript, not cross-session, so `mostRecentText` is never
 * reset mid-scan.
 */
export const buildTaskReasoningTimeline = (transcriptPath: string): TaskReasoning[] => {
  let content: string;
  try {
    content = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }

  return extractTaskReasoningFromContent(content);
};

export type SessionTaskReasoning = TaskReasoning & { sessionIndex: number };

/**
 * Same extraction, across every transcript a project has ever had - the
 * Decision Map's raw material (PRD §7's "idea -> reality" narrative, but as
 * a graph rather than prose). Mirrors buildFileTouchTimeline's per-transcript
 * reset: `mostRecentText` starts fresh at each transcript boundary, since
 * reasoning from one session shouldn't bleed into the next one's tasks.
 *
 * Each entry is tagged with `sessionIndex` (position in `transcriptPaths`,
 * which callers already hand in chronological order) so a session-grouped
 * view of the map doesn't need a second pass over the transcripts.
 */
export const buildTaskReasoningTimelineForProject = (
  transcriptPaths: string[]
): SessionTaskReasoning[] => {
  const timeline: SessionTaskReasoning[] = [];

  transcriptPaths.forEach((transcriptPath, sessionIndex) => {
    let content: string;
    try {
      content = fs.readFileSync(transcriptPath, "utf8");
    } catch {
      return;
    }

    for (const entry of extractTaskReasoningFromContent(content)) {
      timeline.push({ ...entry, sessionIndex });
    }
  });

  return timeline;
};

/**
 * Matches the current task snapshot back to reasoning captured from the
 * transcript, by exact label, in order, first-unused-match-wins. Never
 * throws on a missing match - a task with no captured reasoning (label
 * edited since, transcript didn't cover its creation) simply gets
 * `reasoning: null`, same "don't guess" posture as the rest of this phase.
 */
export const matchReasoningToTasks = (
  tasks: KanbanTaskDto[],
  timeline: TaskReasoning[]
): Array<KanbanTaskDto & { reasoning: string | null }> => {
  const remaining = [...timeline];

  return tasks.map((task) => {
    const matchIndex = remaining.findIndex((entry) => entry.label === task.label);
    if (matchIndex === -1) {
      return { ...task, reasoning: null };
    }

    const [matched] = remaining.splice(matchIndex, 1);
    return { ...task, reasoning: matched.reasoning };
  });
};

const defaultAnnotation = (taskId: string): TaskAnnotation => ({
  taskId,
  rationale: null,
  servesIntent: "none",
  note: ""
});

/**
 * Generates a per-task ordering rationale + Intent Ledger alignment tag, plus
 * one overall plan-vs-intent verdict, for the *current* task snapshot the
 * renderer already holds. Deliberately click-triggered by the caller, never
 * invoked on a timer or on every Kanban tick - CLAUDE.md bans running
 * headless calls in loops, and this is the same posture as Briefing/File
 * Map/Project Log Summary.
 *
 * Graceful degradation throughout: no tasks -> empty result, no ledger ->
 * still annotates ordering but tags everything "none", any headless failure
 * -> default annotations rather than an error. Never fabricates.
 */
export const generateIntentAnnotation = async (
  db: StarshipDb,
  request: { projectId: string; projectPath: string; tasks: KanbanTaskDto[] }
): Promise<IntentAnnotationResult> => {
  const generatedAt = new Date().toISOString();

  if (request.tasks.length === 0) {
    return {
      perTask: [],
      overall: { verdict: "No tasks yet — nothing to check against intent.", concerns: "" },
      generatedAt
    };
  }

  const transcript = findNewestTranscript(request.projectPath);
  const timeline = transcript ? buildTaskReasoningTimeline(transcript.path) : [];
  const matchedTasks = matchReasoningToTasks(request.tasks, timeline);

  const ledger = db.getIntentLedger(request.projectId);

  try {
    const prompt = fillPromptTemplate(readPromptTemplate(), {
      payload_json: JSON.stringify(
        {
          intentLedger: ledger
            ? {
                purpose: ledger.purpose,
                successCriteria: ledger.successCriteria,
                acceptedTradeoffs: ledger.acceptedTradeoffs,
                neverDo: ledger.neverDo
              }
            : null,
          tasks: matchedTasks.map((task) => ({
            label: task.label,
            status: task.status,
            reasoning: task.reasoning
          }))
        },
        null,
        2
      )
    });

    const raw = await runHeadlessClaude(db, {
      cacheNamespace: "intent-annotation",
      prompt,
      cwd: getHeadlessCwd()
    });

    const parsed = extractAnnotationResponse(raw);
    const perTask = reconcilePerTask(request.tasks, parsed?.perTask ?? []);
    const overall = parsed?.overall ?? {
      verdict: "The intent check couldn't be generated right now.",
      concerns: ""
    };

    return { perTask, overall, generatedAt };
  } catch {
    return {
      perTask: request.tasks.map((task) => defaultAnnotation(task.id)),
      overall: { verdict: "The intent check couldn't be generated right now.", concerns: "" },
      generatedAt
    };
  }
};

type RawPerTaskEntry = {
  label: string;
  rationale: string | null;
  servesIntent: TaskAnnotation["servesIntent"];
  note: string;
};

type RawAnnotationResponse = {
  perTask: RawPerTaskEntry[];
  overall: { verdict: string; concerns: string };
};

export const SERVES_INTENT_VALUES: TaskAnnotation["servesIntent"][] = [
  "purpose",
  "successCriteria",
  "acceptedTradeoffs",
  "neverDo",
  "none"
];

const extractAnnotationResponse = (raw: string): RawAnnotationResponse | null => {
  const stripped = stripCodeFence(raw.trim());
  try {
    const parsed = JSON.parse(stripped) as unknown;
    const record = asRecord(parsed);
    if (!record || !Array.isArray(record.perTask)) {
      return null;
    }

    const perTask = record.perTask
      .map((entry) => asRecord(entry))
      .filter((entry): entry is JsonRecord => entry !== null)
      .map((entry) => {
        const label = asString(entry.label);
        if (!label) {
          return null;
        }

        const servesIntentRaw = asString(entry.servesIntent);
        const servesIntent = SERVES_INTENT_VALUES.includes(
          servesIntentRaw as TaskAnnotation["servesIntent"]
        )
          ? (servesIntentRaw as TaskAnnotation["servesIntent"])
          : "none";

        return {
          label,
          rationale: asString(entry.rationale),
          servesIntent,
          note: asString(entry.note) ?? ""
        };
      })
      .filter((entry): entry is RawPerTaskEntry => entry !== null);

    const overallRecord = asRecord(record.overall);
    const overall = {
      verdict: (overallRecord ? asString(overallRecord.verdict) : null) ?? "",
      concerns: (overallRecord ? asString(overallRecord.concerns) : null) ?? ""
    };

    return { perTask, overall };
  } catch {
    return null;
  }
};

/**
 * Maps the LLM's label-keyed response back onto real task ids, same
 * order-preserving first-unused-match-wins rule as matchReasoningToTasks.
 * Response entries whose label doesn't match any current task are dropped
 * (the LLM referencing a label it wasn't given). Any current task with no
 * matching response entry still appears in the result with a default
 * annotation - every current task must be shown, annotated or not.
 */
const reconcilePerTask = (
  tasks: KanbanTaskDto[],
  rawPerTask: RawPerTaskEntry[]
): TaskAnnotation[] => {
  const remaining = [...rawPerTask];

  return tasks.map((task) => {
    const matchIndex = remaining.findIndex((entry) => entry.label === task.label);
    if (matchIndex === -1) {
      return defaultAnnotation(task.id);
    }

    const [matched] = remaining.splice(matchIndex, 1);
    return {
      taskId: task.id,
      rationale: matched.rationale,
      servesIntent: matched.servesIntent,
      note: matched.note
    };
  });
};

const stripCodeFence = (value: string): string => {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : value;
};

const readPromptTemplate = (): string => {
  const promptDir = process.env.STARSHIP_PROMPT_DIR ?? path.join(getAppRoot(), "prompts");
  const filePath = path.join(promptDir, "intent-annotation.md");

  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt template missing: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (content.trim().length === 0) {
    throw new Error(`Prompt template is empty: ${filePath}`);
  }

  return content;
};

const fillPromptTemplate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Prompt placeholder has no value: ${key}`);
    }
    return value;
  });

const getAppRoot = (): string => {
  if (app && typeof app.getAppPath === "function") {
    return app.getAppPath();
  }
  return process.cwd();
};
