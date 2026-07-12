import type { TaskStatus } from "./types";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null ? (value as JsonRecord) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const normalizeStatus = (value: unknown): TaskStatus | null =>
  value === "pending" || value === "in_progress" || value === "completed" ? value : null;

/**
 * Interpretation of a `TaskCreate` tool_use `input`. Two shapes have been
 * observed on this machine across Claude Code point releases:
 *
 * - "incremental" (v2.1.191, v2.1.207 confirmed live): one task per call,
 *   `{subject, description, activeForm}`. No id in the input - the id is
 *   only known once the matching tool_result arrives (see
 *   interpretTaskCreateResult), so a caller must hold the label until then.
 * - "bulk" (v2.1.203 sample): `{tasks: "<JSON array string>"}` where each
 *   item is `{content, status, priority}`, fully self-contained (includes
 *   status), no need to wait for a result.
 *
 * Anything else degrades to "unknown" rather than throwing - a future
 * release changing this shape again should not crash Starship, just stop
 * populating the Kanban until this adapter is extended.
 */
export type TaskCreateInputShape =
  | { form: "incremental"; label: string }
  | { form: "bulk"; items: Array<{ label: string; status: TaskStatus }> }
  | { form: "unknown" };

export const interpretTaskCreateInput = (input: unknown): TaskCreateInputShape => {
  const record = asRecord(input);
  if (!record) {
    return { form: "unknown" };
  }

  const subject = asString(record.subject);
  if (subject) {
    return { form: "incremental", label: subject };
  }

  const tasksField = record.tasks;
  if (typeof tasksField === "string") {
    let parsedTasks: unknown;
    try {
      parsedTasks = JSON.parse(tasksField);
    } catch {
      return { form: "unknown" };
    }

    if (Array.isArray(parsedTasks)) {
      const items = parsedTasks
        .map((item) => asRecord(item))
        .filter((item): item is JsonRecord => item !== null)
        .map((item) => {
          const label = asString(item.content) ?? "";
          const status = normalizeStatus(item.status) ?? "pending";
          return { label, status };
        })
        .filter((item) => item.label !== "");
      return { form: "bulk", items };
    }
  }

  return { form: "unknown" };
};

/**
 * Interpretation of the tool_result matching a `TaskCreate` tool_use. Only
 * the incremental shape needs this (the id isn't known until the tool
 * responds); the bulk shape has everything it needs from the input alone.
 */
export type TaskCreateResultShape = { assigned: true; taskId: string } | { assigned: false };

export const interpretTaskCreateResult = (
  toolUseResult: unknown,
  isError: boolean
): TaskCreateResultShape => {
  if (isError) {
    return { assigned: false };
  }

  const record = asRecord(toolUseResult);
  const task = record ? asRecord(record.task) : null;
  const taskId = task ? asString(task.id) : null;
  return taskId ? { assigned: true, taskId } : { assigned: false };
};

/**
 * Interpretation of a `TaskUpdate` tool_use `input`. The id field's casing
 * has drifted (`taskId` in v2.1.191, `task_id` observed live on v2.1.207) -
 * both are accepted.
 */
export type TaskUpdateInputShape = { taskId: string; status: TaskStatus } | null;

export const interpretTaskUpdateInput = (input: unknown): TaskUpdateInputShape => {
  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const taskId = asString(record.taskId) ?? asString(record.task_id);
  const status = normalizeStatus(record.status);
  if (!taskId || !status) {
    return null;
  }

  return { taskId, status };
};

/**
 * Interpretation of a `TaskStop` tool_use `input`. Observed live id values
 * ("bhu9rwddo") do not resemble TaskCreate/TaskUpdate's sequential numeric
 * ids ("1", "2", ...), so this may address a different id namespace (e.g. a
 * background run rather than a todo item). Exposed for completeness; the
 * Kanban reducer only needs to act on it when the id matches a known task.
 */
export type TaskStopInputShape = { taskId: string } | null;

export const interpretTaskStopInput = (input: unknown): TaskStopInputShape => {
  const record = asRecord(input);
  if (!record) {
    return null;
  }

  const taskId = asString(record.task_id) ?? asString(record.taskId);
  return taskId ? { taskId } : null;
};
