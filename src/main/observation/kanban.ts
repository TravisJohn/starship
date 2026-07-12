import { interpretTaskCreateInput, interpretTaskCreateResult, interpretTaskUpdateInput } from "../parser";
import type { ParsedRecord, TaskStatus } from "../parser";

export type KanbanTask = {
  id: string;
  label: string;
  status: TaskStatus;
};

export type KanbanState = {
  tasks: KanbanTask[];
};

/**
 * Derives Kanban state from the tailed record stream. Read-only by
 * construction: it only ever reacts to TaskCreate/TaskUpdate tool_use and
 * their tool_results, never writes anything back - Claude Code owns task
 * state (CLAUDE.md: "Duplicate Claude Code's task state as a writable
 * source of truth" is a Never-do).
 *
 * The incremental TaskCreate shape (confirmed live on this machine) only
 * reveals a task's id in the *result*, not the request, so creation is a
 * two-step match: remember the label when the tool_use arrives, then
 * materialize the task once the matching tool_result assigns an id. The
 * bulk shape is self-contained but has no confirmed id scheme for later
 * TaskUpdate references, so its items are keyed by a synthetic
 * `<toolUseId>:<index>` id - if a real session's TaskUpdate calls reference
 * a different id scheme for bulk-created tasks, those updates will be
 * silently ignored (unknown id) rather than mis-attributed to the wrong
 * task, consistent with "don't guess" elsewhere in this phase. TaskStop's
 * id namespace is unconfirmed (see parser/taskShape.ts) and is not applied
 * to Kanban state at all for the same reason.
 */
export class KanbanReducer {
  private readonly tasksById = new Map<string, KanbanTask>();
  private readonly order: string[] = [];
  private readonly pendingCreationLabels = new Map<string, string>();

  /** Returns true if this record changed the visible Kanban state. */
  handleRecord(record: ParsedRecord): boolean {
    if (record.kind === "tool-use" && record.toolName === "TaskCreate") {
      return this.handleTaskCreateUse(record.toolUseId, record.input);
    }

    if (record.kind === "tool-result") {
      return this.handleToolResult(record.toolUseId, record.toolUseResult, record.isError);
    }

    if (record.kind === "tool-use" && record.toolName === "TaskUpdate") {
      return this.handleTaskUpdateUse(record.input);
    }

    return false;
  }

  getState(): KanbanState {
    return { tasks: this.order.map((id) => this.tasksById.get(id)!) };
  }

  private handleTaskCreateUse(toolUseId: string, input: unknown): boolean {
    const shape = interpretTaskCreateInput(input);

    if (shape.form === "incremental") {
      this.pendingCreationLabels.set(toolUseId, shape.label);
      return false;
    }

    if (shape.form === "bulk") {
      let changed = false;
      shape.items.forEach((item, index) => {
        const id = `${toolUseId}:${index}`;
        this.upsertTask(id, item.label, item.status);
        changed = true;
      });
      return changed;
    }

    return false;
  }

  private handleToolResult(toolUseId: string, toolUseResult: unknown, isError: boolean): boolean {
    const label = this.pendingCreationLabels.get(toolUseId);
    if (label === undefined) {
      return false;
    }
    this.pendingCreationLabels.delete(toolUseId);

    const result = interpretTaskCreateResult(toolUseResult, isError);
    if (!result.assigned) {
      return false;
    }

    this.upsertTask(result.taskId, label, "pending");
    return true;
  }

  private handleTaskUpdateUse(input: unknown): boolean {
    const shape = interpretTaskUpdateInput(input);
    if (!shape) {
      return false;
    }

    const task = this.tasksById.get(shape.taskId);
    if (!task) {
      return false;
    }

    task.status = shape.status;
    return true;
  }

  private upsertTask(id: string, label: string, status: TaskStatus): void {
    const existing = this.tasksById.get(id);
    if (existing) {
      existing.label = label;
      existing.status = status;
      return;
    }

    this.tasksById.set(id, { id, label, status });
    this.order.push(id);
  }
}
