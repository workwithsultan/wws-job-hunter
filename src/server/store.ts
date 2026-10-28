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
  type RunList,
  type Workspace,
} from "../shared/model.js";

type InsertJob = Pick<
  Job,
  "title" | "url" | "source" | "snippet" | "description" | "assessment" | "reason" | "status"
>;
const previousDefaultAssessmentPrompt = defaultPreferences.assessmentPrompt.replace(
  "Distinguish required qualifications from preferred ones.",
  "Distinguish required qualifications from preferred ones. Title keywords need not match an exact phrase.",
);
const opportunityWindowMs = 24 * 60 * 60 * 1000;
const visibleAssessment = "assessment IN ('match','review')";
const queueStatus = "status IN ('ready','review')";
const applicationStatus =
  "status IN ('applied','interviewing','offer','accepted','rejected','withdrawn')";
const activeOpportunity = `${visibleAssessment} AND ${queueStatus} AND julianday(opportunityAt)>julianday(?)`;

export class Store {
  private readonly db: Database.Database;
  constructor(
    path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    if (Number(this.db.pragma("user_version", { simple: true })) > 5)
      throw new Error("This database requires a newer version of Job Hunter.");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resume_document (id INTEGER PRIMARY KEY CHECK(id=1), pdf BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE, source TEXT NOT NULL,
        snippet TEXT NOT NULL, description TEXT NOT NULL, assessment TEXT CHECK(assessment IN ('match','not_a_match','review')),
        reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('new','ready','review','not_a_fit','applied','interviewing','offer','accepted','rejected','withdrawn')),
        notes TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY, startedAt TEXT NOT NULL, finishedAt TEXT,
        status TEXT NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
        found INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL DEFAULT 0, matches INTEGER NOT NULL DEFAULT 0,
        review INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', trigger TEXT NOT NULL
      );
    `);
    this.db.transaction(() => {
      const jobs = this.db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[];
      if (!jobs.some((column) => column.name === "assessment")) {
        this.db.exec(
          "ALTER TABLE jobs ADD COLUMN assessment TEXT CHECK(assessment IN ('match','not_a_match','review'))",
        );
        this.db.exec(
          "UPDATE jobs SET assessment=CASE status WHEN 'ready' THEN 'match' WHEN 'not_a_fit' THEN 'not_a_match' WHEN 'review' THEN 'review' ELSE CASE WHEN status IN ('applied','interviewing','offer','accepted','rejected','withdrawn') THEN 'review' ELSE NULL END END",
        );
      }
      if (!jobs.some((column) => column.name === "score"))
        this.db.exec("ALTER TABLE jobs ADD COLUMN score INTEGER CHECK(score BETWEEN 0 AND 100)");
      if (!jobs.some((column) => column.name === "opportunityAt")) {
        this.db.exec("ALTER TABLE jobs ADD COLUMN opportunityAt TEXT");
        this.db.exec(
          "UPDATE jobs SET opportunityAt=createdAt WHERE assessment IN ('match','review')",
        );
      }
      const runs = this.db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
      if (runs.some((column) => column.name === "ready"))
        this.db.exec("ALTER TABLE runs RENAME COLUMN ready TO matches");
      const preferences = this.db.prepare("SELECT value FROM preferences WHERE id=1").get();
      if (preferences)
        this.db
          .prepare("UPDATE preferences SET value=? WHERE id=1")
          .run(JSON.stringify(this.preferences()));
      this.db.pragma("user_version = 5");
    })();
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
    const value: Record<string, unknown> = { ...saved };
    if (value.assessmentPrompt === previousDefaultAssessmentPrompt)
      value.assessmentPrompt = defaultPreferences.assessmentPrompt;
    if ("limit" in value) delete value.limit;
    if ("threshold" in value) delete value.threshold;
    if ("sources" in value) delete value.sources;
    for (const key of ["scheduleEnabled", "scheduleTime", "scheduleDays", "timezone"])
      delete value[key];
    return preferencesSchema.parse({
      resume: null,
      country: defaultPreferences.country,
      workType: defaultPreferences.workType,
      ...value,
    });
  }
  savePreferences(value: Preferences): void {
    const candidate = preferencesSchema.parse(value);
    const previous = this.preferences();
    this.db.transaction(() => {
      if (
        candidate.profile !== previous.profile ||
        JSON.stringify(candidate.resume) !== JSON.stringify(previous.resume)
      )
        this.db.prepare("DELETE FROM resume_document WHERE id=1").run();
      this.db
        .prepare(
          "INSERT INTO preferences(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(candidate));
    })();
  }
  hasResumeDocument(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM resume_document WHERE id=1").get());
  }
  resumeDocument(): Buffer | null {
    const row = this.db.prepare("SELECT pdf FROM resume_document WHERE id=1").get() as
      { pdf: Buffer } | undefined;
    return row?.pdf ?? null;
  }
  replaceResume(preferences: Preferences, pdf: Buffer): void {
    this.db.transaction(() => {
      this.savePreferences(preferences);
      this.db
        .prepare(
          "INSERT INTO resume_document(id,pdf) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET pdf=excluded.pdf",
        )
        .run(pdf);
    })();
  }
  private opportunityCutoff(): string {
    return new Date(this.now().getTime() - opportunityWindowMs).toISOString();
  }
  nextOpportunityExpiry(): string | null {
    const row = this.db
      .prepare(
        `SELECT opportunityAt FROM jobs WHERE ${activeOpportunity} ORDER BY julianday(opportunityAt) LIMIT 1`,
      )
      .get(this.opportunityCutoff()) as { opportunityAt: string } | undefined;
    return row
      ? new Date(new Date(row.opportunityAt).getTime() + opportunityWindowMs).toISOString()
      : null;
  }
  totals(): Workspace["totals"] {
    const rows = this.db
      .prepare(
        `SELECT status,assessment,count(*) AS count FROM jobs WHERE ${visibleAssessment} AND (${applicationStatus} OR (${queueStatus} AND julianday(opportunityAt)>julianday(?))) GROUP BY status,assessment`,
      )
      .all(this.opportunityCutoff()) as {
      status: JobStatus;
      assessment: Job["assessment"];
      count: number;
    }[];
    const count = (statuses: readonly JobStatus[]) =>
      rows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.count, 0);
    const queue = rows.filter((row) => row.status === "ready" || row.status === "review");
    return {
      jobs: count(["ready", "review"]),
      matches: queue
        .filter((row) => row.assessment === "match")
        .reduce((sum, row) => sum + row.count, 0),
      review: queue
        .filter((row) => row.assessment === "review")
        .reduce((sum, row) => sum + row.count, 0),
      applications: count(applicationStatuses),
      interviewing: count(["interviewing"]),
      offers: count(["offer", "accepted"]),
    };
  }
  list(query: { q: string; status: string; applications: boolean; page: number }): JobList {
    const clauses: string[] = ["assessment IN ('match','review')"];
    const values: (string | number)[] = [];
    if (query.applications) clauses.push(applicationStatus);
    else {
      clauses.push(queueStatus, "julianday(opportunityAt)>julianday(?)");
      values.push(this.opportunityCutoff());
    }
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
      .prepare(
        "SELECT * FROM jobs" +
          where +
          (query.applications
            ? " ORDER BY createdAt DESC,id DESC"
            : " ORDER BY opportunityAt DESC,id DESC") +
          " LIMIT 30 OFFSET ?",
      )
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
    const now = this.now().toISOString();
    return (
      this.db
        .prepare(
          "INSERT OR IGNORE INTO jobs(title,url,source,snippet,description,assessment,reason,status,opportunityAt,createdAt,updatedAt) VALUES(@title,@url,@source,@snippet,@description,@assessment,@reason,@status,@opportunityAt,@now,@now)",
        )
        .run({
          ...job,
          now,
          opportunityAt: job.assessment === "match" || job.assessment === "review" ? now : null,
        }).changes === 1
    );
  }
  pending(): Job[] {
    return this.db.prepare("SELECT * FROM jobs WHERE status='new' ORDER BY id").all() as Job[];
  }
  assess(
    id: number,
    value: Pick<Job, "description" | "assessment" | "score" | "reason" | "status">,
  ): boolean {
    return (
      this.db
        .prepare(
          "UPDATE jobs SET description=@description,assessment=@assessment,score=@score,reason=@reason,status=@status,opportunityAt=CASE WHEN @assessment IN ('match','review') THEN @now ELSE NULL END,updatedAt=@now WHERE id=@id AND status='new'",
        )
        .run({ ...value, id, now: this.now().toISOString() }).changes === 1
    );
  }
  update(id: number, status: JobStatus, notes: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE jobs SET opportunityAt=CASE WHEN @status IN ('ready','review') AND status NOT IN ('ready','review') THEN @now ELSE opportunityAt END,status=@status,notes=@notes,updatedAt=@now WHERE id=@id`,
        )
        .run({ id, status, notes, now: this.now().toISOString() }).changes === 1
    );
  }
  delete(id: number): boolean {
    return this.db.prepare("DELETE FROM jobs WHERE id=?").run(id).changes === 1;
  }
  allJobs(applications?: boolean): Job[] {
    if (applications === undefined)
      return this.db
        .prepare(`SELECT * FROM jobs WHERE ${visibleAssessment} ORDER BY id`)
        .all() as Job[];
    return applications
      ? (this.db
          .prepare(
            `SELECT * FROM jobs WHERE ${visibleAssessment} AND ${applicationStatus} ORDER BY id`,
          )
          .all() as Job[])
      : (this.db
          .prepare(`SELECT * FROM jobs WHERE ${activeOpportunity} ORDER BY id`)
          .all(this.opportunityCutoff()) as Job[]);
  }
  runs(): SearchRun[] {
    return this.db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 50").all() as SearchRun[];
  }
  listRuns(query: { page: number; status?: SearchRun["status"] | undefined }): RunList {
    const where = query.status ? " WHERE status=?" : "";
    const values = query.status ? [query.status] : [];
    const total = (
      this.db.prepare("SELECT count(*) AS count FROM runs" + where).get(...values) as {
        count: number;
      }
    ).count;
    const pages = Math.max(1, Math.ceil(total / 25));
    const page = Math.min(query.page, pages);
    const runs = this.db
      .prepare("SELECT * FROM runs" + where + " ORDER BY id DESC LIMIT 25 OFFSET ?")
      .all(...values, (page - 1) * 25) as SearchRun[];
    return { runs, total, page, pages };
  }
  startRun(): number {
    return Number(
      this.db
        .prepare(
          "INSERT INTO runs(startedAt,status,trigger,message) VALUES(?,'running','manual','Discovering jobs…')",
        )
        .run(this.now().toISOString()).lastInsertRowid,
    );
  }
  progress(
    id: number,
    counts: { found: number; added: number; matches: number; review: number },
    message: string,
  ): void {
    this.db
      .prepare(
        "UPDATE runs SET found=@found,added=@added,matches=@matches,review=@review,message=@message WHERE id=@id",
      )
      .run({ ...counts, id, message });
  }
  finishRun(id: number, status: "completed" | "failed" | "interrupted", message: string): void {
    this.db
      .prepare("UPDATE runs SET status=?,message=?,finishedAt=? WHERE id=?")
      .run(status, message, this.now().toISOString(), id);
  }
  close(): void {
    this.db.close();
  }
}
