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

  class FakeDatabase {
    private rows: ActivityLogRow[] = [];
    private nextId = 1;

    pragma(): void {
      return undefined;
    }

    exec(): void {
      return undefined;
    }

    prepare(sql: string): {
      run: (...args: unknown[]) => { lastInsertRowid: number };
      get: (...args: unknown[]) => ActivityLogRow | undefined;
      all: (...args: unknown[]) => ActivityLogRow[];
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

          return { lastInsertRowid: 0 };
        },
        get: (...args: unknown[]) => {
          if (sql.includes("from activity_log") && sql.includes("where id = ?")) {
            const [id] = args;
            return this.rows.find((row) => row.id === Number(id));
          }

          return undefined;
        },
        all: (...args: unknown[]) => {
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
