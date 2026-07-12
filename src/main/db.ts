import { app, dialog, ipcMain } from "electron";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  IntentLedger,
  IntentLedgerInput,
  Project,
  ProjectId,
  ShelfLaunchRequest,
  ShelfLaunchResponse
} from "../shared/ipc";

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

type HeadlessCacheRow = {
  result: string;
};

export class StarshipDb {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      create table if not exists projects (
        id text primary key,
        name text not null,
        path text not null unique,
        created_at text not null
      );

      create table if not exists intent_ledger (
        project_id text primary key references projects(id) on delete cascade,
        purpose text not null,
        success_criteria text not null,
        accepted_tradeoffs text not null,
        never_do text not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists headless_cache (
        cache_key text primary key,
        result text not null,
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

  getIntentLedger(projectId: ProjectId): IntentLedger | null {
    const row = this.db
      .prepare(
        `select project_id, purpose, success_criteria, accepted_tradeoffs, never_do, created_at, updated_at
         from intent_ledger
         where project_id = ?`
      )
      .get(projectId) as IntentLedgerRow | undefined;

    return row ? rowToIntentLedger(row) : null;
  }

  saveIntentLedger(input: IntentLedgerInput): IntentLedger {
    const project = this.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const now = new Date().toISOString();
    const existing = this.getIntentLedger(input.projectId);
    const createdAt = existing?.createdAt ?? now;

    this.db
      .prepare(
        `insert into intent_ledger (
          project_id,
          purpose,
          success_criteria,
          accepted_tradeoffs,
          never_do,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict(project_id) do update set
          purpose = excluded.purpose,
          success_criteria = excluded.success_criteria,
          accepted_tradeoffs = excluded.accepted_tradeoffs,
          never_do = excluded.never_do,
          updated_at = excluded.updated_at`
      )
      .run(
        input.projectId,
        input.purpose,
        input.successCriteria,
        input.acceptedTradeoffs,
        input.neverDo,
        createdAt,
        now
      );

    return {
      projectId: input.projectId,
      purpose: input.purpose,
      successCriteria: input.successCriteria,
      acceptedTradeoffs: input.acceptedTradeoffs,
      neverDo: input.neverDo,
      createdAt,
      updatedAt: now
    };
  }

  getHeadlessCache(cacheKey: string): string | null {
    const row = this.db
      .prepare("select result from headless_cache where cache_key = ?")
      .get(cacheKey) as HeadlessCacheRow | undefined;

    return row?.result ?? null;
  }

  saveHeadlessCache(cacheKey: string, result: string): void {
    this.db
      .prepare(
        `insert into headless_cache (cache_key, result, created_at)
         values (?, ?, ?)
         on conflict(cache_key) do update set result = excluded.result`
      )
      .run(cacheKey, result, new Date().toISOString());
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

  ipcMain.handle(
    "shelf:launch",
    (_event, request: ShelfLaunchRequest): ShelfLaunchResponse => {
    const project = db.getProject(request.projectId);
    if (!project) {
      throw new Error(`Project not found: ${request.projectId}`);
    }

    return { project };
    }
  );

  ipcMain.handle("intent:getLedger", (_event, request: { projectId: string }) =>
    db.getIntentLedger(request.projectId)
  );

  ipcMain.handle(
    "intent:saveLedger",
    (_event, request: IntentLedgerInput): IntentLedger =>
      db.saveIntentLedger(request)
  );
};

const rowToProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  path: row.path,
  createdAt: row.created_at
});

const rowToIntentLedger = (row: IntentLedgerRow): IntentLedger => ({
  projectId: row.project_id,
  purpose: row.purpose,
  successCriteria: row.success_criteria,
  acceptedTradeoffs: row.accepted_tradeoffs,
  neverDo: row.never_do,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});
