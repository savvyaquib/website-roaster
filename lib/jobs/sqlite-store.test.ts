/**
 * Job store tests.
 *
 * Against a real database throughout. The interesting property is that a report
 * written and read back is the report that went in, even though it is stored
 * decomposed and partly recomputed — and only a real round trip demonstrates
 * that.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { analyzeContent, extractContent } from "@/lib/analysis/content";
import { analyzeUx, collectUxSignals } from "@/lib/analysis/ux";
import { openDatabase } from "@/lib/db";
import { buildRecommendations } from "@/lib/recommendations";
import { generateRoast } from "@/lib/roast";
import { scoreAnalysis } from "@/lib/scoring";
import { AiError } from "@/lib/ai/errors";
import type { AiAvailability } from "@/lib/ai";

import { createJobId } from "./id";
import { createMemoryJobStore } from "./memory-store";
import { createSqliteJobStore } from "./sqlite-store";
import type { SqliteJobStore } from "./sqlite-store";
import { JOB_SCHEMA_VERSION, type AnalysisJob, type JobStore } from "./types";

const HTML = `<!doctype html><html lang="en"><head><title>Ship</title></head><body>
<nav><a href="/a">A</a><a href="/b">B</a></nav>
<main><h1>Ship faster</h1><p>Short.</p><h4>Skipped</h4><a href="/x">Get started</a></main>
</body></html>`;
const URL = "https://example.com/";

const noAi: AiAvailability = {
  available: false,
  reason: "AI was not used.",
  error: new AiError({ code: "not_configured", provider: "none", message: "no key" }),
};

let db: DatabaseSync;
let store: SqliteJobStore;
const opened: DatabaseSync[] = [];

function makeStore(options: { retentionDays?: number; now?: () => Date } = {}) {
  const opened_ = openDatabase({ location: ":memory:" });
  opened.push(opened_.db);
  return { db: opened_.db, store: createSqliteJobStore({ db: opened_.db, ...options }) };
}

beforeEach(() => {
  const made = makeStore();
  db = made.db;
  store = made.store;
});

afterEach(() => {
  for (const each of opened.splice(0)) each.close();
});

/** A job carrying a real report, produced by the real pipeline pieces. */
async function completedJob(overrides: Partial<AnalysisJob> = {}): Promise<AnalysisJob> {
  const findings = [
    ...analyzeUx({ signals: collectUxSignals(HTML, URL) }),
    ...analyzeContent({ inventory: extractContent(HTML, URL) }),
  ];
  const score = scoreAnalysis({ findings });
  const recommendations = buildRecommendations({ findings, score });
  const roast = await generateRoast(noAi, { url: URL, findings, recommendations });

  const now = new Date().toISOString();

  return {
    id: createJobId(),
    status: "completed",
    url: URL,
    submittedUrl: URL,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now,
    error: null,
    schemaVersion: JOB_SCHEMA_VERSION,
    report: {
      url: URL,
      finalUrl: URL,
      httpStatus: 200,
      findings,
      score,
      recommendations,
      roast,
      interpretation: null,
      interpretationUnavailableReason: "AI was not used.",
      notRun: ["accessibility", "performance", "mobile"],
      durationMs: 42,
    },
    ...overrides,
  };
}

function queuedJob(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  const now = new Date().toISOString();

  return {
    id: createJobId(),
    status: "queued",
    url: URL,
    submittedUrl: URL,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    error: null,
    report: null,
    schemaVersion: JOB_SCHEMA_VERSION,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The contract both stores share
// ---------------------------------------------------------------------------

describe.each([
  ["sqlite", () => makeStore().store as JobStore],
  ["memory", () => createMemoryJobStore() as JobStore],
])("%s store", (_name, make) => {
  let subject: JobStore;

  beforeEach(() => {
    subject = make();
  });

  it("returns null for an id it has never seen", async () => {
    expect(await subject.get(createJobId())).toBeNull();
  });

  it("returns null for a malformed id rather than reaching storage", async () => {
    expect(await subject.get("../../etc/passwd")).toBeNull();
  });

  it("round-trips a queued job", async () => {
    const job = queuedJob();
    await subject.create(job);

    expect(await subject.get(job.id)).toEqual(job);
  });

  it("updates a job and moves updatedAt forward", async () => {
    // Recent, not 2020: a stale record is swept on the first write, which is
    // the store working rather than a test fixture to fight.
    const createdAt = new Date(Date.now() - 5000).toISOString();
    const job = queuedJob({ createdAt });
    await subject.create({ ...job, updatedAt: job.createdAt });

    const updated = await subject.update(job.id, { status: "running" });

    expect(updated?.status).toBe("running");
    expect(Date.parse(updated?.updatedAt ?? "")).toBeGreaterThan(Date.parse(createdAt));
  });

  it("leaves untouched fields alone", async () => {
    const job = queuedJob();
    await subject.create(job);

    const updated = await subject.update(job.id, { status: "running" });

    expect(updated?.url).toBe(job.url);
    expect(updated?.createdAt).toBe(job.createdAt);
  });

  it("returns null when updating an unknown job", async () => {
    expect(await subject.update(createJobId(), { status: "running" })).toBeNull();
  });

  it("keeps jobs separate", async () => {
    const first = queuedJob();
    const second = queuedJob();

    await subject.create(first);
    await subject.create(second);
    await subject.update(first.id, { status: "completed" });

    expect((await subject.get(second.id))?.status).toBe("queued");
  });

  it("stores a refusal, which has no report", async () => {
    const refused = queuedJob({
      status: "invalid_url",
      url: null,
      submittedUrl: "not a url",
      error: { code: "malformed", message: "That is not a URL." },
      finishedAt: new Date().toISOString(),
    });

    await subject.create(refused);

    expect(await subject.get(refused.id)).toEqual(refused);
  });
});

// ---------------------------------------------------------------------------
// The round trip that matters
// ---------------------------------------------------------------------------

describe("a full report survives storage", () => {
  it("comes back exactly as it went in", async () => {
    // Written decomposed, read recomposed, with recommendations and the roast
    // rebuilt rather than stored (ADR-060). This is the assertion that the
    // rebuild is faithful.
    const job = await completedJob();
    await store.create(job);

    expect(await store.get(job.id)).toEqual(job);
  });

  it("keeps every finding, in order", async () => {
    const job = await completedJob();
    await store.create(job);

    const read = await store.get(job.id);

    expect(read?.report?.findings.map((finding) => finding.id)).toEqual(
      job.report?.findings.map((finding) => finding.id),
    );
  });

  it("keeps evidence, including the measured/heuristic distinction", async () => {
    const job = await completedJob();
    await store.create(job);

    const read = await store.get(job.id);
    const kinds = new Set(
      (read?.report?.findings ?? []).flatMap((finding) =>
        finding.evidence.map((item) => item.kind),
      ),
    );

    expect(kinds.has("measured")).toBe(true);
    expect(kinds.has("heuristic")).toBe(true);
  });

  it("keeps the scoring version and the category scores", async () => {
    const job = await completedJob();
    await store.create(job);

    const read = await store.get(job.id);

    expect(read?.report?.score.scoringVersion).toBe(job.report?.score.scoringVersion);
    expect(read?.report?.score.categories).toEqual(job.report?.score.categories);
  });

  it("keeps a category that was not assessed as not assessed", async () => {
    const job = await completedJob();
    await store.create(job);

    const read = await store.get(job.id);
    const performance = read?.report?.score.categories.find(
      (category) => category.category === "performance",
    );

    // Null must not come back as zero (ADR-021).
    expect(performance?.status).toBe("not_assessed");
    expect(performance?.score).toBeNull();
    expect(performance?.notAssessedReason).not.toBeNull();
  });

  it("rebuilds the roast against the findings it was about", async () => {
    const job = await completedJob();
    await store.create(job);

    const read = await store.get(job.id);
    const ids = new Set(read?.report?.findings.map((finding) => finding.id));

    expect((read?.report?.roast.lines.length ?? 0) > 0).toBe(true);
    for (const line of read?.report?.roast.lines ?? []) {
      expect(ids.has(line.finding.id)).toBe(true);
      expect(line.observation.length).toBeGreaterThan(0);
    }
  });

  it("rebuilds recommendations identically to computing them fresh", async () => {
    const job = await completedJob();
    await store.create(job);

    const read = await store.get(job.id);

    expect(read?.report?.recommendations).toEqual(
      buildRecommendations({
        findings: read!.report!.findings,
        score: read!.report!.score,
      }),
    );
  });

  it("keeps a model's words, which cannot be recomputed", async () => {
    const job = await completedJob();
    const withAi: AnalysisJob = {
      ...job,
      report: {
        ...job.report!,
        interpretationUnavailableReason: null,
        interpretation: {
          executiveSummary: "The page is brief to the point of silence.",
          strengths: [],
          problems: [
            {
              finding: job.report!.findings.find((f) => f.status === "fail")!,
              whyItMatters: "Visitors cannot tell what this offers.",
              recommendation: "Say what it does.",
              deterministicRank: 1,
            },
          ],
          meta: {
            provider: "gemini",
            model: "gemini-2.0-flash",
            task: "interpretation",
            latencyMs: 900,
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
            finishReason: "STOP",
          },
        },
      },
    };

    await store.create(withAi);
    const read = await store.get(withAi.id);

    expect(read?.report?.interpretation?.executiveSummary).toBe(
      "The page is brief to the point of silence.",
    );
    expect(read?.report?.interpretation?.problems[0]?.whyItMatters).toBe(
      "Visitors cannot tell what this offers.",
    );
    expect(read?.report?.interpretation?.meta.model).toBe("gemini-2.0-flash");
  });

  it("survives being updated from queued to completed", async () => {
    const job = await completedJob();
    const queued = queuedJob({ id: job.id, createdAt: job.createdAt });

    await store.create(queued);
    await store.update(job.id, { status: "running" });
    const updated = await store.update(job.id, {
      status: "completed",
      report: job.report,
      finishedAt: job.finishedAt,
    });

    expect(updated?.report?.findings).toHaveLength(job.report!.findings.length);
    expect((await store.get(job.id))?.report?.score.overall.score).toBe(
      job.report?.score.overall.score,
    );
  });
});

// ---------------------------------------------------------------------------
// What is not stored
// ---------------------------------------------------------------------------

describe("it stores no more than it needs", () => {
  it("keeps one copy of each finding, not three", async () => {
    // A finding appears in `findings`, inside every recommendation about it and
    // inside every roast line about it. Storing the report whole would keep all
    // three (the limitation ADR-057 recorded).
    const job = await completedJob();
    await store.create(job);

    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM findings WHERE analysis_id = ?")
      .get(job.id) as unknown as { n: number };

    expect(Number(rows.n)).toBe(job.report!.findings.length);
  });

  it("stores no recommendation rows at all", async () => {
    const job = await completedJob();
    await store.create(job);

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as unknown as { name: string }[]
    ).map((row) => row.name);

    expect(tables).not.toContain("recommendations");
    expect(tables).not.toContain("roast_lines");
  });

  it("writes far less than the report serialises to", async () => {
    const job = await completedJob();
    await store.create(job);

    const stored = db
      .prepare("SELECT * FROM analyses WHERE id = ?")
      .get(job.id) as unknown as Record<string, unknown>;
    const analysisRowSize = JSON.stringify(stored).length;
    const wholeReportSize = JSON.stringify(job.report).length;

    // The row holds the summary and the model prose; the bulk lives in the
    // findings table exactly once.
    expect(analysisRowSize).toBeLessThan(wholeReportSize / 2);
  });

  it("holds no page markup", async () => {
    const job = await completedJob();
    await store.create(job);

    const everything = JSON.stringify([
      db.prepare("SELECT * FROM analyses").all(),
      db.prepare("SELECT * FROM findings").all(),
      db.prepare("SELECT * FROM category_scores").all(),
    ]);

    // No HTML, no response body, no serialised DOM. The page as fetched is
    // never persisted.
    expect(everything).not.toContain("<!doctype html>");
    expect(everything).not.toContain("<nav>");
    expect(everything).not.toContain("<main>");
    expect(everything.length).toBeLessThan(JSON.stringify(HTML).length * 200);
  });

  it("keeps short evidence quotations, which are the point", async () => {
    // "Avoid unnecessary website content" is not "avoid all of it". A finding
    // that says a headline exists is worthless without the headline, and the
    // report shows it (ADR-008). What is excluded is bulk: markup, bodies,
    // whole-page text.
    const job = await completedJob();
    await store.create(job);

    const read = await store.get(job.id);
    const details = (read?.report?.findings ?? []).flatMap((finding) =>
      finding.evidence.flatMap((item) =>
        item.detail === undefined ? [] : [item.detail],
      ),
    );

    expect(details).toContain("Ship faster");
    for (const detail of details) {
      // Excerpts, never documents.
      expect(detail.length).toBeLessThan(500);
    }
  });
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

describe("retention", () => {
  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  it("deletes analyses past the window", async () => {
    const { store: subject } = makeStore({ retentionDays: 30 });

    // The first write sweeps, so the stale record goes in after it, and
    // pruneExpired is then called explicitly.
    const kept = queuedJob({ createdAt: daysAgo(5) });
    await subject.create(kept);
    await subject.create(queuedJob({ createdAt: daysAgo(45) }));

    expect(subject.count()).toBe(2);
    expect(subject.pruneExpired()).toBe(1);
    expect(subject.count()).toBe(1);
    expect(await subject.get(kept.id)).not.toBeNull();
  });

  it("takes findings and scores with it", async () => {
    const made = makeStore({ retentionDays: 30 });
    const job = await completedJob({ createdAt: daysAgo(60) });

    await made.store.create(job);
    made.store.pruneExpired();

    const remaining = made.db
      .prepare("SELECT COUNT(*) AS n FROM findings")
      .get() as unknown as { n: number };

    expect(Number(remaining.n)).toBe(0);
  });

  it("keeps everything when the window is zero", async () => {
    const { store: subject } = makeStore({ retentionDays: 0 });

    await subject.create(queuedJob({ createdAt: daysAgo(3650) }));

    expect(subject.pruneExpired()).toBe(0);
    expect(subject.count()).toBe(1);
  });

  it("keeps an analysis exactly at the boundary", async () => {
    const { store: subject } = makeStore({ retentionDays: 30 });

    await subject.create(queuedJob({ createdAt: daysAgo(29) }));

    expect(subject.pruneExpired()).toBe(0);
  });

  it("sweeps on write, but not on every write", async () => {
    // ADR-020 rules out a scheduler, so the sweep rides along with writes —
    // throttled, because a delete on every status transition is waste.
    let clock = new Date("2026-01-01T00:00:00.000Z").getTime();
    const { store: subject } = makeStore({
      retentionDays: 30,
      now: () => new Date(clock),
    });

    await subject.create(queuedJob({ createdAt: "2020-01-01T00:00:00.000Z" }));
    // The first write sweeps; the stale record is already gone.
    expect(subject.count()).toBe(0);

    await subject.create(queuedJob({ createdAt: "2020-01-01T00:00:00.000Z" }));
    // The second, moments later, does not sweep again.
    expect(subject.count()).toBe(1);

    clock += 2 * 60 * 60 * 1000;
    await subject.create(queuedJob());
    // An hour on, it sweeps again and the stale one goes.
    expect(subject.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe("history", () => {
  it("lists analyses most recent first", async () => {
    const older = queuedJob({ createdAt: new Date(Date.now() - 60_000).toISOString() });
    const newer = queuedJob({ createdAt: new Date().toISOString() });

    await store.create(older);
    await store.create(newer);

    expect(store.listRecent(10)).toEqual([newer.id, older.id]);
  });

  it("honours the limit", async () => {
    for (let index = 0; index < 5; index += 1) await store.create(queuedJob());

    expect(store.listRecent(2)).toHaveLength(2);
  });

  it("counts what is stored", async () => {
    expect(store.count()).toBe(0);

    await store.create(queuedJob());

    expect(store.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// On disk
// ---------------------------------------------------------------------------

describe("on disk", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "roaster-db-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("survives the process that wrote it", async () => {
    // The whole reason this store exists (ADR-031).
    const location = path.join(directory, "analyses.db");
    const job = await completedJob();

    const first = openDatabase({ location });
    await createSqliteJobStore({ db: first.db }).create(job);
    first.db.close();

    const second = openDatabase({ location });
    const read = await createSqliteJobStore({ db: second.db }).get(job.id);
    second.db.close();

    expect(read).toEqual(job);
  });

  it("creates the directory it was pointed at", async () => {
    const location = path.join(directory, "nested", "deeper", "analyses.db");
    const { db: created } = openDatabase({ location });

    expect(created).toBeDefined();
    created.close();
  });
});
