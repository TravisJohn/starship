import { Notification } from "electron";
import type { ObservationSnapshot, ProjectId, PtySessionId } from "../../shared/ipc";
import { correlateSession } from "./correlate";
import { KanbanReducer } from "./kanban";
import { tailPermissionSignal } from "./permissionSignal";
import { StatusEngine, type EngineStatus } from "./statusEngine";
import { SubagentReducer } from "./subagents";
import { tailSession } from "./tailer";

export type StartObservingRequest = {
  ptySessionId: PtySessionId;
  projectId: ProjectId;
  projectName: string;
  projectPath: string;
  spawnTimeMs: number;
};

type ObservedSession = {
  kanban: KanbanReducer;
  subagents: SubagentReducer;
  status: StatusEngine;
  correlated: boolean;
  lastEngineStatus: EngineStatus | null;
  unsubscribeCorrelate: () => void;
  unsubscribeTail?: () => void;
  unsubscribePermissionSignal?: () => void;
  pollTimer?: ReturnType<typeof setInterval>;
};

// Re-checks status between records so a pending tool call that crosses the
// status engine's grace period is still caught with no new transcript
// activity to trigger it - well under the <2s Kanban-lag acceptance bar.
const STATUS_POLL_INTERVAL_MS = 500;

/**
 * Owns one observed session per launched pty: correlates it to its Claude
 * Code transcript, tails that transcript, and feeds the three Phase 3
 * reducers (Kanban, subagent strip, status engine). Read-only throughout -
 * see correlate.ts and tailer.ts for the underlying guarantees.
 */
export class ObservationManager {
  private readonly sessions = new Map<PtySessionId, ObservedSession>();

  startObserving(request: StartObservingRequest, send: (snapshot: ObservationSnapshot) => void): void {
    if (this.sessions.has(request.ptySessionId)) {
      return;
    }

    const session: ObservedSession = {
      kanban: new KanbanReducer(),
      subagents: new SubagentReducer(),
      status: new StatusEngine(),
      correlated: false,
      lastEngineStatus: null,
      unsubscribeCorrelate: () => {}
    };

    const emit = (): void => {
      if (!session.correlated) {
        send({
          ptySessionId: request.ptySessionId,
          projectId: request.projectId,
          status: "no-session-detected",
          kanban: [],
          subagents: []
        });
        return;
      }

      const result = session.status.computeStatus();
      send({
        ptySessionId: request.ptySessionId,
        projectId: request.projectId,
        status: result.status,
        decision: result.status === "decision-needed" ? result.decision : undefined,
        kanban: session.kanban.getState().tasks,
        subagents: session.subagents.getState().agents
      });

      if (result.status === "decision-needed" && session.lastEngineStatus !== "decision-needed") {
        notifyDecisionNeeded(request.projectName, result.decision.summary);
      }
      session.lastEngineStatus = result.status;
    };

    session.unsubscribeCorrelate = correlateSession(
      { ptySessionId: request.ptySessionId, projectPath: request.projectPath, spawnTimeMs: request.spawnTimeMs },
      (outcome) => {
        if (outcome.status !== "resolved" || !this.sessions.has(request.ptySessionId)) {
          return;
        }

        session.correlated = true;
        session.unsubscribeTail = tailSession(outcome.transcriptPath, (record) => {
          session.kanban.handleRecord(record);
          session.subagents.handleRecord(record);
          session.status.handleRecord(record);
          emit();
        });
        // The one signal the transcript structurally cannot provide in time
        // (see PHASE3_LOG.md "New finding"): Claude Code doesn't write a
        // tool_use record for a pending-approval call until after the human
        // answers it, so a real approval prompt is otherwise invisible for
        // its entire pending duration. Keyed by project path, not the
        // transcript, so it works the same way regardless of which session
        // file ends up correlated.
        session.unsubscribePermissionSignal = tailPermissionSignal(request.projectPath, (signal) => {
          session.status.handlePermissionSignal(signal);
          emit();
        });
        session.pollTimer = setInterval(emit, STATUS_POLL_INTERVAL_MS);
        emit();
      }
    );

    this.sessions.set(request.ptySessionId, session);
    emit();
  }

  stopObserving(ptySessionId: PtySessionId): void {
    const session = this.sessions.get(ptySessionId);
    if (!session) {
      return;
    }

    session.unsubscribeCorrelate();
    session.unsubscribeTail?.();
    session.unsubscribePermissionSignal?.();
    if (session.pollTimer) {
      clearInterval(session.pollTimer);
    }
    this.sessions.delete(ptySessionId);
  }

  stopAll(): void {
    for (const ptySessionId of [...this.sessions.keys()]) {
      this.stopObserving(ptySessionId);
    }
  }
}

const notifyDecisionNeeded = (projectName: string, summary: string): void => {
  if (!Notification.isSupported()) {
    return;
  }
  new Notification({ title: `${projectName} needs a decision`, body: summary }).show();
};
