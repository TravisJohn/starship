import { app, ipcMain } from "electron";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ActivityLogEntry,
  IntentLedger,
  IntentLedgerInput,
  Note,
  NoteStatus,
  NoteStatusCounts,
  Project,
  ProjectId,
  SessionBriefing,
  SessionBriefingHistoryEntry
} from "../shared/ipc";
import { NOTE_STATUS_ORDER } from "../shared/ipc";

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

type RootSettingsRow = {
  root_path: string;
};

type IgnoredProjectPathRow = {
  path: string;
  ignored: number;
};

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
  status: NoteStatus;
  created_at: string;
  updated_at: string;
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

      create table if not exists root_settings (
        id integer primary key check (id = 1),
        root_path text not null,
        updated_at text not null
      );

      create table if not exists ignored_project_paths (
        path text primary key,
        ignored integer not null check (ignored in (0, 1)),
        updated_at text not null
      );

      create table if not exists activity_log (
        id integer primary key autoincrement,
        ts text not null,
        event_type text not null,
        project_id text,
        detail text
      );

      create table if not exists session_briefings (
        project_id text primary key references projects(id) on delete cascade,
        summary text not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists briefing_history (
        id integer primary key autoincrement,
        project_id text not null references projects(id) on delete cascade,
        summary text not null,
        created_at text not null
      );

      create table if not exists notes (
        id text primary key,
        project_id text not null references projects(id) on delete cascade,
        text text not null,
        done integer not null default 0 check (done in (0, 1)),
        created_at text not null,
        updated_at text not null
      );
    `);

    this.migrateNotesContentColumn();
    this.migrateNotesStatusColumn();
  }

  /**
   * `notes` originally shipped with just a single `text` field (a flat
   * checklist item). Notes gained a separate subject/content split shortly
   * after, and `create table if not exists` is a no-op for anyone who
   * already has the old table (including real notes already saved) - this
   * adds the missing column in place rather than losing that data.
   */
  private migrateNotesContentColumn(): void {
    const columns = this.db.prepare("pragma table_info(notes)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "content")) {
      this.db.exec("alter table notes add column content text not null default ''");
    }
  }

  /**
   * Notes originally tracked only a done/undone boolean. That's replaced by
   * a four-stage lifecycle (fresh -> implemented -> tested -> verified) so
   * the dashboard can show real build health instead of a flat checkbox.
   * Existing done=1 rows become "verified" (the closest equivalent -
   * resolved and no longer a pending action item); everything else starts
   * "fresh". The old `done` column is left in place rather than dropped -
   * harmless, and avoids relying on DROP COLUMN support across SQLite
   * versions.
   */
  private migrateNotesStatusColumn(): void {
    const columns = this.db.prepare("pragma table_info(notes)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "status")) {
      this.db.exec("alter table notes add column status text not null default 'fresh'");
      this.db.exec("update notes set status = 'verified' where done = 1");
    }
  }

  getRootPath(): string | null {
    const row = this.db
      .prepare("select root_path from root_settings where id = 1")
      .get() as RootSettingsRow | undefined;

    return row?.root_path ?? null;
  }

  setRootPath(rootPath: string): string {
    const resolvedPath = path.resolve(rootPath);
    this.db
      .prepare(
        `insert into root_settings (id, root_path, updated_at)
         values (1, ?, ?)
         on conflict(id) do update set
           root_path = excluded.root_path,
           updated_at = excluded.updated_at`
      )
      .run(resolvedPath, new Date().toISOString());

    return resolvedPath;
  }

  listProjects(): Project[] {
    const rows = this.db
      .prepare("select id, name, path, created_at from projects order by lower(name), path")
      .all() as ProjectRow[];

    return rows.map(rowToProject);
  }

  syncDiscoveredProjects(projectPaths: string[]): Project[] {
    const resolvedPaths = Array.from(
      new Set(projectPaths.map((projectPath) => path.resolve(projectPath)))
    ).sort((a, b) => a.localeCompare(b));

    const sync = this.db.transaction((pathsToKeep: string[]) => {
      if (pathsToKeep.length === 0) {
        this.db.prepare("delete from projects").run();
      } else {
        const placeholders = pathsToKeep.map(() => "?").join(", ");
        this.db
          .prepare(`delete from projects where path not in (${placeholders})`)
          .run(...pathsToKeep);
      }

      for (const projectPath of pathsToKeep) {
        this.addProject(projectPath);
      }
    });

    sync(resolvedPaths);
    return this.listProjects();
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

  setProjectIgnored(projectPath: string, ignored: boolean): void {
    const resolvedPath = path.resolve(projectPath);
    this.db
      .prepare(
        `insert into ignored_project_paths (path, ignored, updated_at)
         values (?, ?, ?)
         on conflict(path) do update set
           ignored = excluded.ignored,
           updated_at = excluded.updated_at`
      )
      .run(resolvedPath, ignored ? 1 : 0, new Date().toISOString());
  }

  getIgnoredProjectPaths(projectPaths: string[]): Map<string, boolean> {
    const resolvedPaths = Array.from(
      new Set(projectPaths.map((projectPath) => path.resolve(projectPath)))
    );
    if (resolvedPaths.length === 0) {
      return new Map();
    }

    const placeholders = resolvedPaths.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `select path, ignored from ignored_project_paths where path in (${placeholders})`
      )
      .all(...resolvedPaths) as IgnoredProjectPathRow[];

    return new Map(rows.map((row) => [row.path, row.ignored === 1]));
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

  logActivity(entry: {
    eventType: string;
    projectId?: string | null;
    detail?: unknown;
  }): ActivityLogEntry {
    const ts = new Date().toISOString();
    const detail = entry.detail === undefined ? null : JSON.stringify(entry.detail);
    const result = this.db
      .prepare(
        `insert into activity_log (ts, event_type, project_id, detail)
         values (?, ?, ?, ?)`
      )
      .run(ts, entry.eventType, entry.projectId ?? null, detail);

    const row = this.db
      .prepare(
        `select id, ts, event_type, project_id, detail
         from activity_log
         where id = ?`
      )
      .get(result.lastInsertRowid) as ActivityLogRow | undefined;

    if (!row) {
      throw new Error("Activity log insert failed");
    }

    return rowToActivityLogEntry(row);
  }

  listActivity(options: { projectId?: string; limit?: number } = {}): ActivityLogEntry[] {
    const limit = normalizeActivityLimit(options.limit);
    const rows =
      options.projectId === undefined
        ? (this.db
            .prepare(
              `select id, ts, event_type, project_id, detail
               from activity_log
               order by id asc
               limit ?`
            )
            .all(limit) as ActivityLogRow[])
        : (this.db
            .prepare(
              `select id, ts, event_type, project_id, detail
               from activity_log
               where project_id = ? or project_id is null
               order by id asc
               limit ?`
            )
            .all(options.projectId, limit) as ActivityLogRow[]);

    return rows.map(rowToActivityLogEntry);
  }

  getSessionBriefing(projectId: ProjectId): SessionBriefing | null {
    const row = this.db
      .prepare(
        `select project_id, summary, created_at, updated_at
         from session_briefings
         where project_id = ?`
      )
      .get(projectId) as SessionBriefingRow | undefined;

    return row ? rowToSessionBriefing(row) : null;
  }

  /**
   * Updates the single "latest briefing" row (used for the Terminal page's
   * "since last time" banner) and, in the same transaction, appends an
   * immutable row to briefing_history - the Timeline's raw material. The
   * history only ever grows on a real "Exit & Summarize"; nothing backfills
   * it retroactively.
   */
  saveSessionBriefing(projectId: ProjectId, summary: string): SessionBriefing {
    const now = new Date().toISOString();
    const existing = this.getSessionBriefing(projectId);
    const createdAt = existing?.createdAt ?? now;

    const save = this.db.transaction(() => {
      this.db
        .prepare(
          `insert into session_briefings (project_id, summary, created_at, updated_at)
           values (?, ?, ?, ?)
           on conflict(project_id) do update set
             summary = excluded.summary,
             updated_at = excluded.updated_at`
        )
        .run(projectId, summary, createdAt, now);

      this.db
        .prepare(
          `insert into briefing_history (project_id, summary, created_at)
           values (?, ?, ?)`
        )
        .run(projectId, summary, now);
    });
    save();

    return { projectId, summary, createdAt, updatedAt: now };
  }

  /**
   * Every past briefing for a project, oldest first - the Timeline pane's
   * idea-to-reality narrative (PRD §7). Never trimmed or backfilled.
   */
  listBriefingHistory(projectId: ProjectId): SessionBriefingHistoryEntry[] {
    const rows = this.db
      .prepare(
        `select id, project_id, summary, created_at
         from briefing_history
         where project_id = ?
         order by id asc`
      )
      .all(projectId) as BriefingHistoryRow[];

    return rows.map(rowToBriefingHistoryEntry);
  }

  listNotes(projectId: ProjectId): Note[] {
    const rows = this.db
      .prepare(
        `select id, project_id, text, content, status, created_at, updated_at
         from notes
         where project_id = ?
         order by created_at asc`
      )
      .all(projectId) as NoteRow[];

    return rows.map(rowToNote);
  }

  /**
   * Per-status note counts per project - the dashboard's "how healthy is
   * this project" signal. Every requested project id is present in the
   * returned map with all four counts (zero-filled), so callers never need
   * a fallback. Batched (same shape as getIgnoredProjectPaths) rather than
   * one query per project.
   */
  getNoteStatusCounts(projectIds: ProjectId[]): Map<string, NoteStatusCounts> {
    const uniqueIds = Array.from(new Set(projectIds));
    const result = new Map<string, NoteStatusCounts>(
      uniqueIds.map((id) => [id, emptyNoteStatusCounts()])
    );

    if (uniqueIds.length === 0) {
      return result;
    }

    const placeholders = uniqueIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `select project_id, status, count(*) as count
         from notes
         where project_id in (${placeholders})
         group by project_id, status`
      )
      .all(...uniqueIds) as { project_id: string; status: NoteStatus; count: number }[];

    for (const row of rows) {
      const counts = result.get(row.project_id);
      if (counts) {
        counts[row.status] = row.count;
      }
    }

    return result;
  }

  addNote(input: { projectId: ProjectId; text: string; content: string }): Note {
    const id = randomUUID();
    const now = new Date().toISOString();
    const status: NoteStatus = "fresh";

    this.db
      .prepare(
        `insert into notes (id, project_id, text, content, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.projectId, input.text, input.content, status, now, now);

    return {
      id,
      projectId: input.projectId,
      text: input.text,
      content: input.content,
      status,
      createdAt: now,
      updatedAt: now
    };
  }

  updateNote(noteId: string, input: { text: string; content: string }): Note {
    const now = new Date().toISOString();
    this.db
      .prepare(`update notes set text = ?, content = ?, updated_at = ? where id = ?`)
      .run(input.text, input.content, now, noteId);

    return this.getNote(noteId);
  }

  setNoteStatus(noteId: string, status: NoteStatus): Note {
    const now = new Date().toISOString();
    this.db
      .prepare(`update notes set status = ?, updated_at = ? where id = ?`)
      .run(status, now, noteId);

    return this.getNote(noteId);
  }

  deleteNote(noteId: string): void {
    this.db.prepare(`delete from notes where id = ?`).run(noteId);
  }

  private getNote(noteId: string): Note {
    const row = this.db
      .prepare(
        `select id, project_id, text, content, status, created_at, updated_at
         from notes
         where id = ?`
      )
      .get(noteId) as NoteRow | undefined;

    if (!row) {
      throw new Error(`Note not found: ${noteId}`);
    }

    return rowToNote(row);
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

export const registerIntentHandlers = (db: StarshipDb): void => {
  ipcMain.handle("intent:getLedger", (_event, request: { projectId: string }) =>
    db.getIntentLedger(request.projectId)
  );

  ipcMain.handle(
    "intent:saveLedger",
    (_event, request: IntentLedgerInput): IntentLedger =>
      db.saveIntentLedger(request)
  );
};

export const registerNotesHandlers = (db: StarshipDb): void => {
  ipcMain.handle("notes:list", (_event, request: { projectId: string }): Note[] =>
    db.listNotes(request.projectId)
  );

  ipcMain.handle(
    "notes:add",
    (_event, request: { projectId: string; text: string; content: string }): Note =>
      db.addNote(request)
  );

  ipcMain.handle(
    "notes:update",
    (_event, request: { noteId: string; text: string; content: string }): Note =>
      db.updateNote(request.noteId, { text: request.text, content: request.content })
  );

  ipcMain.handle(
    "notes:setStatus",
    (_event, request: { noteId: string; status: NoteStatus }): Note =>
      db.setNoteStatus(request.noteId, request.status)
  );

  ipcMain.handle("notes:delete", (_event, request: { noteId: string }): void =>
    db.deleteNote(request.noteId)
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

const rowToActivityLogEntry = (row: ActivityLogRow): ActivityLogEntry => ({
  id: row.id,
  ts: row.ts,
  eventType: row.event_type,
  projectId: row.project_id,
  detail: row.detail === null ? null : JSON.parse(row.detail)
});

const rowToSessionBriefing = (row: SessionBriefingRow): SessionBriefing => ({
  projectId: row.project_id,
  summary: row.summary,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const rowToBriefingHistoryEntry = (row: BriefingHistoryRow): SessionBriefingHistoryEntry => ({
  id: row.id,
  projectId: row.project_id,
  summary: row.summary,
  createdAt: row.created_at
});

const rowToNote = (row: NoteRow): Note => ({
  id: row.id,
  projectId: row.project_id,
  text: row.text,
  content: row.content,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const emptyNoteStatusCounts = (): NoteStatusCounts => ({
  fresh: 0,
  implemented: 0,
  tested: 0,
  verified: 0
});

const normalizeActivityLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) {
    return 500;
  }

  return Math.max(1, Math.min(5000, Math.trunc(limit)));
};
