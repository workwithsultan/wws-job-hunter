import Database from "better-sqlite3";
import {
  defaultPreferences,
  preferencesSchema,
  applicationStatuses,
  type Job,
  type JobList,
  type JobStatus,
  type Preferences,
  type SearchRun,
  type Workspace,
} from "../shared/model.js";

type InsertJob = Pick<
  Job,
  "title" | "url" | "source" | "snippet" | "description" | "score" | "reason" | "status"
>;
export class Store {
  private readonly db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    if (Number(this.db.pragma("user_version", { simple: true })) > 1)
      throw new Error("This database requires a newer version of Job Hunter.");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE, source TEXT NOT NULL,
        snippet TEXT NOT NULL, description TEXT NOT NULL, score INTEGER CHECK(score BETWEEN 0 AND 100),
        reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('new','ready','review','not_a_fit','applied','interviewing','offer','accepted','rejected','withdrawn')),
        notes TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY, startedAt TEXT NOT NULL, finishedAt TEXT,
        status TEXT NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
        found INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL DEFAULT 0, ready INTEGER NOT NULL DEFAULT 0,
        review INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', trigger TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
  }
  recoverInterrupted(): void {
    this.db
      .prepare(
        "UPDATE runs SET status='interrupted',message='The server stopped before this search finished. Review saved jobs before running again.' WHERE status='running'",
      )
      .run();
  }
  preferences(): Preferences {
    const row = this.db.prepare("SELECT value FROM preferences WHERE id=1").get() as
      { value: string } | undefined;
    if (!row) return structuredClone(defaultPreferences);
    const saved: unknown = JSON.parse(row.value);
    if (typeof saved !== "object" || saved === null || Array.isArray(saved))
      throw new Error("Saved preferences are invalid.");
    const value = { ...saved };
    if ("limit" in value) delete value.limit;
    return preferencesSchema.parse({
      resume: null,
      country: defaultPreferences.country,
      workType: defaultPreferences.workType,
      ...value,
    });
  }
  savePreferences(value: Preferences): void {
    this.db
      .prepare(
        "INSERT INTO preferences(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(preferencesSchema.parse(value)));
  }
  totals(): Workspace["totals"] {
    const rows = this.db
      .prepare("SELECT status, count(*) AS count FROM jobs GROUP BY status")
      .all() as { status: JobStatus; count: number }[];
    const count = (statuses: readonly JobStatus[]) =>
      rows.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + r.count, 0);
    return {
      jobs: rows.reduce((n, r) => n + r.count, 0),
      ready: count(["ready"]),
      review: count(["review"]),
      applications: count(applicationStatuses),
      interviewing: count(["interviewing"]),
      offers: count(["offer", "accepted"]),
    };
  }
  list(query: { q: string; status: string; applications: boolean; page: number }): JobList {
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (query.applications)
      clauses.push(
        "status IN ('applied','interviewing','offer','accepted','rejected','withdrawn')",
      );
    if (query.status) {
      clauses.push("status = ?");
      values.push(query.status);
    }
    if (query.q) {
      clauses.push(
        "(instr(lower(title),lower(?))>0 OR instr(lower(snippet),lower(?))>0 OR instr(lower(notes),lower(?))>0)",
      );
      values.push(query.q, query.q, query.q);
    }
    const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
    const total = (
      this.db.prepare("SELECT count(*) AS count FROM jobs" + where).get(...values) as {
        count: number;
      }
    ).count;
    const pages = Math.max(1, Math.ceil(total / 30));
    const page = Math.min(query.page, pages);
    const jobs = this.db
      .prepare("SELECT * FROM jobs" + where + " ORDER BY createdAt DESC,id DESC LIMIT 30 OFFSET ?")
      .all(...values, (page - 1) * 30) as Job[];
    return { jobs, total, page, pages };
  }
  job(id: number): Job | undefined {
    return this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Job | undefined;
  }
  has(url: string): boolean {
    return Boolean(this.db.prepare("SELECT id FROM jobs WHERE url=?").get(url));
  }
  insert(job: InsertJob): boolean {
    const now = new Date().toISOString();
    return (
      this.db
        .prepare(
          "INSERT OR IGNORE INTO jobs(title,url,source,snippet,description,score,reason,status,createdAt,updatedAt) VALUES(@title,@url,@source,@snippet,@description,@score,@reason,@status,@now,@now)",
        )
        .run({ ...job, now }).changes === 1
    );
  }
  pending(): Job[] {
    return this.db.prepare("SELECT * FROM jobs WHERE status='new' ORDER BY id").all() as Job[];
  }
  score(id: number, value: Pick<Job, "description" | "score" | "reason" | "status">): boolean {
    return (
      this.db
        .prepare(
          "UPDATE jobs SET description=@description,score=@score,reason=@reason,status=@status,updatedAt=@now WHERE id=@id AND status='new'",
        )
        .run({ ...value, id, now: new Date().toISOString() }).changes === 1
    );
  }
  update(id: number, status: JobStatus, notes: string): boolean {
    return (
      this.db
        .prepare("UPDATE jobs SET status=?,notes=?,updatedAt=? WHERE id=?")
        .run(status, notes, new Date().toISOString(), id).changes === 1
    );
  }
  delete(id: number): boolean {
    return this.db.prepare("DELETE FROM jobs WHERE id=?").run(id).changes === 1;
  }
  allJobs(): Job[] {
    return this.db.prepare("SELECT * FROM jobs ORDER BY id").all() as Job[];
  }
  runs(): SearchRun[] {
    return this.db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 50").all() as SearchRun[];
  }
  startRun(trigger: SearchRun["trigger"]): number {
    return Number(
      this.db
        .prepare(
          "INSERT INTO runs(startedAt,status,trigger,message) VALUES(?,'running',?,'Discovering jobs…')",
        )
        .run(new Date().toISOString(), trigger).lastInsertRowid,
    );
  }
  progress(
    id: number,
    counts: { found: number; added: number; ready: number; review: number },
    message: string,
  ): void {
    this.db
      .prepare(
        "UPDATE runs SET found=@found,added=@added,ready=@ready,review=@review,message=@message WHERE id=@id",
      )
      .run({ ...counts, id, message });
  }
  finishRun(id: number, status: "completed" | "failed" | "interrupted", message: string): void {
    this.db
      .prepare("UPDATE runs SET status=?,message=?,finishedAt=? WHERE id=?")
      .run(status, message, new Date().toISOString(), id);
  }
  close(): void {
    this.db.close();
  }
}
