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

  type NoteRow = {
    id: string;
    project_id: string;
    text: string;
    content: string;
    done: number;
    created_at: string;
    updated_at: string;
  };

  class FakeDatabase {
    private rows: ActivityLogRow[] = [];
    private nextId = 1;
    private briefings = new Map<string, SessionBriefingRow>();
    private notes: NoteRow[] = [];

    pragma(): void {
      return undefined;
    }

    exec(): void {
      return undefined;
    }

    prepare(sql: string): {
      run: (...args: unknown[]) => { lastInsertRowid: number };
      get: (...args: unknown[]) => ActivityLogRow | SessionBriefingRow | NoteRow | undefined;
      all: (
        ...args: unknown[]
      ) => ActivityLogRow[] | NoteRow[] | { project_id: string; count: number }[];
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

          if (sql.includes("insert into notes")) {
            const [id, projectId, text, content, createdAt, updatedAt] = args as string[];
            this.notes.push({
              id,
              project_id: projectId,
              text,
              content,
              done: 0,
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

          if (sql.includes("update notes set done")) {
            const [done, updatedAt, id] = args as [number, string, string];
            const note = this.notes.find((row) => row.id === id);
            if (note) {
              note.done = done;
              note.updated_at = updatedAt;
            }
            return { lastInsertRowid: 0 };
          }

          if (sql.includes("delete from notes")) {
            const [id] = args as string[];
            this.notes = this.notes.filter((row) => row.id !== id);
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

          return undefined;
        },
        all: (...args: unknown[]) => {
          if (sql.includes("from notes") && sql.includes("where project_id = ?")) {
            const [projectId] = args as string[];
            return this.notes
              .filter((row) => row.project_id === projectId)
              .sort((a, b) => a.created_at.localeCompare(b.created_at));
          }

          if (sql.includes("from notes") && sql.includes("group by project_id")) {
            const projectIds = args as string[];
            const counts = new Map<string, number>();
            for (const note of this.notes) {
              if (note.done !== 0) continue;
              if (!projectIds.includes(note.project_id)) continue;
              counts.set(note.project_id, (counts.get(note.project_id) ?? 0) + 1);
            }
            return Array.from(counts.entries()).map(([project_id, count]) => ({
              project_id,
              count
            }));
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

  it("adds a note with a subject and content, undone by default", () => {
    const note = db.addNote({
      projectId: "project-a",
      text: "Try caching the query",
      content: "Could shave several seconds off the dashboard load."
    });

    expect(note.done).toBe(false);
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

  it("toggles done on and off", () => {
    const note = db.addNote({ projectId: "project-a", text: "Fix the bug", content: "" });

    const done = db.setNoteDone(note.id, true);
    expect(done.done).toBe(true);

    const undone = db.setNoteDone(note.id, false);
    expect(undone.done).toBe(false);
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

  it("counts only undone notes per project", () => {
    const first = db.addNote({ projectId: "project-a", text: "First", content: "" });
    db.addNote({ projectId: "project-a", text: "Second", content: "" });
    db.setNoteDone(first.id, true);
    db.addNote({ projectId: "project-b", text: "Elsewhere", content: "" });

    const counts = db.getUndoneNoteCounts(["project-a", "project-b"]);
    expect(counts.get("project-a")).toBe(1);
    expect(counts.get("project-b")).toBe(1);
  });

  it("omits a project entirely from the map when it has zero undone notes", () => {
    const note = db.addNote({ projectId: "project-a", text: "Only one", content: "" });
    db.setNoteDone(note.id, true);

    const counts = db.getUndoneNoteCounts(["project-a"]);
    expect(counts.has("project-a")).toBe(false);
  });

  it("returns an empty map for an empty project id list", () => {
    expect(db.getUndoneNoteCounts([])).toEqual(new Map());
  });
});
