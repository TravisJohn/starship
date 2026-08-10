import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StarshipDb } from "./db";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn()
  },
  ipcMain: {
    handle: vi.fn()
  }
}));

vi.mock("better-sqlite3", () => {
  type ActivityLogRow = {
    id: number;
    ts: string;
    event_type: string;
    project_id: string | null;
    detail: string | null;
  };

  type SessionBriefingRow = {
    project_id: string;
    summary: string;
    created_at: string;
    updated_at: string;
  };

  type BriefingHistoryRow = {
    id: number;
    project_id: string;
    summary: string;
    created_at: string;
  };

  type NoteRow = {
    id: string;
    project_id: string;
    text: string;
    content: string;
    status: string;
    created_at: string;
    updated_at: string;
  };

  type ProjectRow = {
    id: string;
    name: string;
    path: string;
    created_at: string;
  };

  type IntentLedgerRow = {
    project_id: string;
    purpose: string;
    success_criteria: string;
    accepted_tradeoffs: string;
    never_do: string;
    created_at: string;
    updated_at: string;
  };

  class FakeDatabase {
    private rows: ActivityLogRow[] = [];
    private nextId = 1;
    private briefings = new Map<string, SessionBriefingRow>();
    private briefingHistory: BriefingHistoryRow[] = [];
    private nextBriefingHistoryId = 1;
    private notes: NoteRow[] = [];
    private projects: ProjectRow[] = [];
    private intentLedgers = new Map<string, IntentLedgerRow>();

    pragma(): void {
      return undefined;
    }

    exec(): void {
      return undefined;
    }

    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return fn;
    }

    prepare(sql: string): {
      run: (...args: unknown[]) => { lastInsertRowid: number };
      get: (
        ...args: unknown[]
      ) =>
        | ActivityLogRow
        | SessionBriefingRow
        | NoteRow
        | ProjectRow
        | IntentLedgerRow
        | undefined;
      all: (
        ...args: unknown[]
      ) =>
        | ActivityLogRow[]
        | NoteRow[]
        | BriefingHistoryRow[]
        | { project_id: string; status: string; count: number }[]
        | { project_id: string }[];
    } {
      return {
        run: (...args: unknown[]) => {
          if (sql.includes("insert into activity_log")) {
            const [ts, eventType, projectId, detail] = args;
            const id = this.nextId;
            this.nextId += 1;
            this.rows.push({
              id,
              ts: String(ts),
              event_type: String(eventType),
              project_id: typeof projectId === "string" ? projectId : null,
              detail: typeof detail === "string" ? detail : null
            });
            return { lastInsertRowid: id };
          }

          if (sql.includes("insert into session_briefings")) {
            const [projectId, summary, createdAt, updatedAt] = args as string[];
            this.briefings.set(projectId, {
              project_id: projectId,
              summary,
              created_at: createdAt,
              updated_at: updatedAt
            });
            return { lastInsertRowid: 0 };
          }

          if (sql.includes("insert into briefing_history")) {
            const [projectId, summary, createdAt] = args as string[];
            const id = this.nextBriefingHistoryId;
            this.nextBriefingHistoryId += 1;
            this.briefingHistory.push({
              id,
              project_id: projectId,
              summary,
              created_at: createdAt
            });
            return { lastInsertRowid: id };
          }

          if (sql.includes("insert into notes")) {
            const [id, projectId, text, content, status, createdAt, updatedAt] =
              args as string[];
            this.notes.push({
              id,
              project_id: projectId,
              text,
              content,
              status,
              created_at: createdAt,
              updated_at: updatedAt
            });
            return { lastInsertRowid: 0 };
          }

          if (sql.includes("update notes set text")) {
            const [text, content, updatedAt, id] = args as string[];
            const note = this.notes.find((row) => row.id === id);
            if (note) {
              note.text = text;
              note.content = content;
              note.updated_at = updatedAt;
            }
            return { lastInsertRowid: 0 };
          }

          if (sql.includes("update notes set status")) {
            const [status, updatedAt, id] = args as [string, string, string];
            const note = this.notes.find((row) => row.id === id);
            if (note) {
              note.status = status;
              note.updated_at = updatedAt;
            }
            return { lastInsertRowid: 0 };
          }

          if (sql.includes("delete from notes")) {
            const [id] = args as string[];
            this.notes = this.notes.filter((row) => row.id !== id);
            return { lastInsertRowid: 0 };
          }

          if (sql.includes("insert into projects")) {
            const [id, name, projectPath, createdAt] = args as string[];
            this.projects.push({
              id,
              name,
              path: projectPath,
              created_at: createdAt
            });
            return { lastInsertRowid: 0 };
          }

          if (sql.includes("insert into intent_ledger")) {
            const [
              projectId,
              purpose,
              successCriteria,
              acceptedTradeoffs,
              neverDo,
              createdAt,
              updatedAt
            ] = args as string[];
            this.intentLedgers.set(projectId, {
              project_id: projectId,
              purpose,
              success_criteria: successCriteria,
              accepted_tradeoffs: acceptedTradeoffs,
              never_do: neverDo,
              created_at: createdAt,
              updated_at: updatedAt
            });
            return { lastInsertRowid: 0 };
          }

          return { lastInsertRowid: 0 };
        },
        get: (...args: unknown[]) => {
          if (sql.includes("from activity_log") && sql.includes("where id = ?")) {
            const [id] = args;
            return this.rows.find((row) => row.id === Number(id));
          }

          if (sql.includes("from session_briefings") && sql.includes("where project_id = ?")) {
            const [projectId] = args as string[];
            return this.briefings.get(projectId);
          }

          if (sql.includes("from notes") && sql.includes("where id = ?")) {
            const [id] = args as string[];
            return this.notes.find((row) => row.id === id);
          }

          if (sql.includes("from projects") && sql.includes("where id = ?")) {
            const [id] = args as string[];
            return this.projects.find((row) => row.id === id);
          }

          if (sql.includes("from projects") && sql.includes("where path = ?")) {
            const [projectPath] = args as string[];
            return this.projects.find((row) => row.path === projectPath);
          }

          if (
            sql.includes("from intent_ledger") &&
            sql.includes("where project_id = ?")
          ) {
            const [projectId] = args as string[];
            return this.intentLedgers.get(projectId);
          }

          return undefined;
        },
        all: (...args: unknown[]) => {
          if (sql.includes("from briefing_history")) {
            const [projectId] = args as string[];
            return this.briefingHistory
              .filter((row) => row.project_id === projectId)
              .sort((a, b) => a.id - b.id);
          }

          if (sql.includes("from notes") && sql.includes("where project_id = ?")) {
            const [projectId] = args as string[];
            return this.notes
              .filter((row) => row.project_id === projectId)
              .sort((a, b) => a.created_at.localeCompare(b.created_at));
          }

          if (sql.includes("from notes") && sql.includes("group by project_id, status")) {
            const projectIds = args as string[];
            const counts = new Map<string, Map<string, number>>();
            for (const note of this.notes) {
              if (!projectIds.includes(note.project_id)) continue;
              const perProject = counts.get(note.project_id) ?? new Map<string, number>();
              perProject.set(note.status, (perProject.get(note.status) ?? 0) + 1);
              counts.set(note.project_id, perProject);
            }
            const rows: { project_id: string; status: string; count: number }[] = [];
            for (const [project_id, perProject] of counts) {
              for (const [status, count] of perProject) {
                rows.push({ project_id, status, count });
              }
            }
            return rows;
          }

          if (
            sql.includes("from intent_ledger") &&
            sql.includes("project_id in")
          ) {
            const projectIds = args as string[];
            return projectIds
              .filter((projectId) => this.intentLedgers.has(projectId))
              .map((projectId) => ({ project_id: projectId }));
          }

          if (!sql.includes("from activity_log")) {
            return [];
          }

          if (sql.includes("where project_id = ? or project_id is null")) {
            const [projectId, limit] = args;
            return this.rows
              .filter(
                (row) => row.project_id === projectId || row.project_id === null
              )
              .slice(0, Number(limit));
          }

          const [limit] = args;
          return this.rows.slice(0, Number(limit));
        }
      };
    }

    close(): void {
      return undefined;
    }
  }

  return { default: FakeDatabase };
});

describe("StarshipDb activity log", () => {
  let tempDir: string;
  let db: StarshipDb;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-db-"));
    db = new StarshipDb(path.join(tempDir, "starship.sqlite"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  it("round-trips activity entries", () => {
    const root = db.logActivity({
      eventType: "root_located",
      detail: { rootPath: "D:\\Projects" }
    });
    const launch = db.logActivity({
      eventType: "launch_fired",
      projectId: "project-a",
      detail: { agent: "claude", dangerouslySkipPermissions: true }
    });

    expect(db.listActivity()).toEqual([
      {
        id: root.id,
        ts: root.ts,
        eventType: "root_located",
        projectId: null,
        detail: { rootPath: "D:\\Projects" }
      },
      {
        id: launch.id,
        ts: launch.ts,
        eventType: "launch_fired",
        projectId: "project-a",
        detail: { agent: "claude", dangerouslySkipPermissions: true }
      }
    ]);
  });

  it("filters to a project plus global entries", () => {
    const root = db.logActivity({ eventType: "root_located" });
    const projectA = db.logActivity({
      eventType: "intent_opened",
      projectId: "project-a"
    });
    db.logActivity({ eventType: "intent_opened", projectId: "project-b" });

    expect(db.listActivity({ projectId: "project-a" })).toEqual([root, projectA]);
  });

  it("respects limit", () => {
    const first = db.logActivity({ eventType: "first" });
    const second = db.logActivity({ eventType: "second" });
    db.logActivity({ eventType: "third" });

    expect(db.listActivity({ limit: 2 })).toEqual([first, second]);
  });

  it("preserves insertion order", () => {
    const first = db.logActivity({ eventType: "first" });
    const second = db.logActivity({ eventType: "second" });
    const third = db.logActivity({ eventType: "third" });

    expect(db.listActivity().map((entry) => entry.id)).toEqual([
      first.id,
      second.id,
      third.id
    ]);
  });
});

describe("StarshipDb session briefings", () => {
  let tempDir: string;
  let db: StarshipDb;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-db-briefing-"));
    db = new StarshipDb(path.join(tempDir, "starship.sqlite"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  it("returns null when no briefing has been saved yet", () => {
    expect(db.getSessionBriefing("project-a")).toBeNull();
  });

  it("saves and retrieves the latest briefing for a project", () => {
    const saved = db.saveSessionBriefing("project-a", "Built the game logic and wired up the UI.");
    expect(db.getSessionBriefing("project-a")).toEqual(saved);
  });

  it("keeps only the latest briefing per project - a second save replaces the first", () => {
    const first = db.saveSessionBriefing("project-a", "First summary.");
    const second = db.saveSessionBriefing("project-a", "Second, more recent summary.");

    expect(second.createdAt).toBe(first.createdAt);
    expect(db.getSessionBriefing("project-a")).toEqual(second);
  });

  it("keeps separate projects independent", () => {
    db.saveSessionBriefing("project-a", "Summary for A.");
    db.saveSessionBriefing("project-b", "Summary for B.");

    expect(db.getSessionBriefing("project-a")?.summary).toBe("Summary for A.");
    expect(db.getSessionBriefing("project-b")?.summary).toBe("Summary for B.");
  });

  it("returns an empty history for a project with no briefings yet", () => {
    expect(db.listBriefingHistory("project-a")).toEqual([]);
  });

  it("appends to history on every save, unlike the single overwritten latest row", () => {
    db.saveSessionBriefing("project-a", "First summary.");
    db.saveSessionBriefing("project-a", "Second summary.");
    db.saveSessionBriefing("project-a", "Third summary.");

    expect(db.listBriefingHistory("project-a").map((entry) => entry.summary)).toEqual([
      "First summary.",
      "Second summary.",
      "Third summary."
    ]);
  });

  it("orders history oldest first", () => {
    const first = db.saveSessionBriefing("project-a", "First summary.");
    db.saveSessionBriefing("project-a", "Second summary.");

    const history = db.listBriefingHistory("project-a");
    expect(history[0].summary).toBe(first.summary);
    expect(history[0].createdAt).toBe(first.createdAt);
  });

  it("keeps history independent per project", () => {
    db.saveSessionBriefing("project-a", "For A.");
    db.saveSessionBriefing("project-b", "For B.");

    expect(db.listBriefingHistory("project-a")).toHaveLength(1);
    expect(db.listBriefingHistory("project-b")).toHaveLength(1);
  });
});

describe("StarshipDb notes", () => {
  let tempDir: string;
  let db: StarshipDb;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-db-notes-"));
    db = new StarshipDb(path.join(tempDir, "starship.sqlite"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  it("returns an empty list for a project with no notes", () => {
    expect(db.listNotes("project-a")).toEqual([]);
  });

  it("adds a note with a subject and content, fresh by default", () => {
    const note = db.addNote({
      projectId: "project-a",
      text: "Try caching the query",
      content: "Could shave several seconds off the dashboard load."
    });

    expect(note.status).toBe("fresh");
    expect(note.text).toBe("Try caching the query");
    expect(note.content).toBe("Could shave several seconds off the dashboard load.");
    expect(db.listNotes("project-a")).toEqual([note]);
  });

  it("allows empty content - the subject alone is a valid note", () => {
    const note = db.addNote({ projectId: "project-a", text: "Quick idea", content: "" });
    expect(note.content).toBe("");
  });

  it("lists notes for a project in creation order", () => {
    const first = db.addNote({ projectId: "project-a", text: "First idea", content: "" });
    const second = db.addNote({ projectId: "project-a", text: "Second idea", content: "" });

    expect(db.listNotes("project-a")).toEqual([first, second]);
  });

  it("keeps separate projects independent", () => {
    db.addNote({ projectId: "project-a", text: "For A", content: "" });
    db.addNote({ projectId: "project-b", text: "For B", content: "" });

    expect(db.listNotes("project-a")).toHaveLength(1);
    expect(db.listNotes("project-b")).toHaveLength(1);
  });

  it("moves a note through its lifecycle stages", () => {
    const note = db.addNote({ projectId: "project-a", text: "Fix the bug", content: "" });

    const implemented = db.setNoteStatus(note.id, "implemented");
    expect(implemented.status).toBe("implemented");

    const tested = db.setNoteStatus(note.id, "tested");
    expect(tested.status).toBe("tested");

    const verified = db.setNoteStatus(note.id, "verified");
    expect(verified.status).toBe("verified");

    const backToFresh = db.setNoteStatus(note.id, "fresh");
    expect(backToFresh.status).toBe("fresh");
  });

  it("updates both subject and content", () => {
    const note = db.addNote({ projectId: "project-a", text: "Draft idea", content: "rough notes" });

    const updated = db.updateNote(note.id, { text: "Refined idea", content: "polished notes" });
    expect(updated.text).toBe("Refined idea");
    expect(updated.content).toBe("polished notes");
    expect(db.listNotes("project-a")).toEqual([updated]);
  });

  it("deletes a note", () => {
    const note = db.addNote({ projectId: "project-a", text: "Temporary", content: "" });
    db.deleteNote(note.id);

    expect(db.listNotes("project-a")).toEqual([]);
  });

  it("counts notes per status per project", () => {
    const first = db.addNote({ projectId: "project-a", text: "First", content: "" });
    db.addNote({ projectId: "project-a", text: "Second", content: "" });
    db.setNoteStatus(first.id, "verified");
    db.addNote({ projectId: "project-b", text: "Elsewhere", content: "" });

    const counts = db.getNoteStatusCounts(["project-a", "project-b"]);
    expect(counts.get("project-a")).toEqual({
      fresh: 1,
      implemented: 0,
      tested: 0,
      verified: 1
    });
    expect(counts.get("project-b")).toEqual({
      fresh: 1,
      implemented: 0,
      tested: 0,
      verified: 0
    });
  });

  it("zero-fills every requested project even with no notes at all", () => {
    const counts = db.getNoteStatusCounts(["project-a"]);
    expect(counts.get("project-a")).toEqual({
      fresh: 0,
      implemented: 0,
      tested: 0,
      verified: 0
    });
  });

  it("returns an empty map for an empty project id list", () => {
    expect(db.getNoteStatusCounts([])).toEqual(new Map());
  });
});

describe("StarshipDb intent ledger presence", () => {
  let tempDir: string;
  let db: StarshipDb;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starship-db-intent-"));
    db = new StarshipDb(path.join(tempDir, "starship.sqlite"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  it("reports no ledger for a shelved project that never went through Inception", () => {
    const project = db.addProject(path.join(tempDir, "shelved-project"));

    expect(db.getProjectIdsWithIntentLedger([project.id])).toEqual(new Set());
  });

  it("reports a ledger once intent is retrofitted onto an existing project", () => {
    const project = db.addProject(path.join(tempDir, "shelved-project"));
    db.saveIntentLedger({
      projectId: project.id,
      purpose: "Stop losing the thread between sessions.",
      successCriteria: "I can pick it up cold and know why it exists.",
      acceptedTradeoffs: "Single user, local only.",
      neverDo: "Never act on the project's behalf."
    });

    expect(db.getProjectIdsWithIntentLedger([project.id])).toEqual(
      new Set([project.id])
    );
  });

  /**
   * Retrofitted intent is often only partly recoverable, so the editor saves
   * whatever the builder can answer. A ledger with blank answers still counts
   * as captured - otherwise the shelf would keep nagging about a project the
   * builder has already deliberately answered.
   */
  it("counts a partially answered ledger as captured", () => {
    const project = db.addProject(path.join(tempDir, "half-answered"));
    db.saveIntentLedger({
      projectId: project.id,
      purpose: "Scratch an itch I keep coming back to.",
      successCriteria: "",
      acceptedTradeoffs: "",
      neverDo: ""
    });

    expect(db.getProjectIdsWithIntentLedger([project.id])).toEqual(
      new Set([project.id])
    );
  });

  it("separates projects with and without a ledger in one batched lookup", () => {
    const withLedger = db.addProject(path.join(tempDir, "with-ledger"));
    const withoutLedger = db.addProject(path.join(tempDir, "without-ledger"));
    db.saveIntentLedger({
      projectId: withLedger.id,
      purpose: "A reason.",
      successCriteria: "A finish line.",
      acceptedTradeoffs: "A cost.",
      neverDo: "A boundary."
    });

    expect(
      db.getProjectIdsWithIntentLedger([withLedger.id, withoutLedger.id])
    ).toEqual(new Set([withLedger.id]));
  });

  it("returns an empty set for an empty project id list", () => {
    expect(db.getProjectIdsWithIntentLedger([])).toEqual(new Set());
  });
});
