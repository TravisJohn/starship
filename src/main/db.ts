import { app, dialog, ipcMain } from "electron";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Project, ProjectId, ShelfLaunchResponse } from "../shared/ipc";

type ProjectRow = {
  id: string;
  name: string;
  path: string;
  created_at: string;
};

export class StarshipDb {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      create table if not exists projects (
        id text primary key,
        name text not null,
        path text not null unique,
        created_at text not null
      );
    `);
  }

  listProjects(): Project[] {
    const rows = this.db
      .prepare("select id, name, path, created_at from projects order by created_at desc")
      .all() as ProjectRow[];

    return rows.map(rowToProject);
  }

  addProject(projectPath: string): Project {
    const resolvedPath = path.resolve(projectPath);
    const existing = this.db
      .prepare("select id, name, path, created_at from projects where path = ?")
      .get(resolvedPath) as ProjectRow | undefined;

    if (existing) {
      return rowToProject(existing);
    }

    const now = new Date().toISOString();
    const row: ProjectRow = {
      id: randomUUID(),
      name: path.basename(resolvedPath) || resolvedPath,
      path: resolvedPath,
      created_at: now
    };

    this.db
      .prepare(
        "insert into projects (id, name, path, created_at) values (?, ?, ?, ?)"
      )
      .run(row.id, row.name, row.path, row.created_at);

    return rowToProject(row);
  }

  getProject(projectId: ProjectId): Project | null {
    const row = this.db
      .prepare("select id, name, path, created_at from projects where id = ?")
      .get(projectId) as ProjectRow | undefined;

    return row ? rowToProject(row) : null;
  }

  close(): void {
    this.db.close();
  }
}

export const createStarshipDb = (): StarshipDb => {
  const dbPath =
    process.env.STARSHIP_DB_PATH ??
    path.join(app.getPath("userData"), "starship.sqlite");

  return new StarshipDb(dbPath);
};

export const registerShelfHandlers = (db: StarshipDb): void => {
  ipcMain.handle("shelf:listProjects", () => db.listProjects());

  ipcMain.handle("shelf:addProject", async () => {
    const result = await dialog.showOpenDialog({
      title: "Add Project",
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return db.addProject(result.filePaths[0]);
  });

  ipcMain.handle("shelf:launch", (_event, request): ShelfLaunchResponse => {
    const project = db.getProject(request.projectId);
    if (!project) {
      throw new Error(`Project not found: ${request.projectId}`);
    }

    return { project };
  });
};

const rowToProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  path: row.path,
  createdAt: row.created_at
});
