/**
 * Job store tests.
 *
 * These use a real temporary directory rather than a mocked filesystem: the
 * property under test is that a record survives, and a mock cannot demonstrate
 * that.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileJobStore, JobStoreError } from "./file-store";
import { createJobId, isJobId } from "./id";
import { createMemoryJobStore } from "./memory-store";
import { JOB_SCHEMA_VERSION, type AnalysisJob, type JobStore } from "./types";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "roaster-jobs-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function job(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  const now = new Date().toISOString();

  return {
    id: createJobId(),
    status: "queued",
    url: "https://example.com/",
    submittedUrl: "https://example.com",
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
// Behaviour shared by both stores
// ---------------------------------------------------------------------------

describe.each([
  ["file", () => createFileJobStore({ directory })],
  ["memory", () => createMemoryJobStore()],
])("%s store", (_name, make) => {
  let store: JobStore;

  beforeEach(() => {
    store = make();
  });

  it("returns null for an id it has never seen", async () => {
    expect(await store.get(createJobId())).toBeNull();
  });

  it("round-trips a job", async () => {
    const created = job();
    await store.create(created);

    expect(await store.get(created.id)).toEqual(created);
  });

  it("updates a job and stamps updatedAt", async () => {
    const created = job({ createdAt: "2020-01-01T00:00:00.000Z" });
    await store.create({ ...created, updatedAt: created.createdAt });

    const updated = await store.update(created.id, { status: "running" });

    expect(updated?.status).toBe("running");
    // Not "differs from the previous value": an in-memory update can land
    // inside the same millisecond, and a test that depends on the clock ticking
    // fails at random. What matters is that the stamp moved forward.
    expect(Date.parse(updated?.updatedAt ?? "")).toBeGreaterThan(
      Date.parse(created.createdAt),
    );
  });

  it("leaves untouched fields alone", async () => {
    const created = job();
    await store.create(created);

    const updated = await store.update(created.id, { status: "running" });

    expect(updated?.url).toBe(created.url);
    expect(updated?.createdAt).toBe(created.createdAt);
  });

  it("returns null when updating an unknown job", async () => {
    expect(await store.update(createJobId(), { status: "running" })).toBeNull();
  });

  it("keeps jobs separate", async () => {
    const first = job({ url: "https://first.example/" });
    const second = job({ url: "https://second.example/" });

    await store.create(first);
    await store.create(second);
    await store.update(first.id, { status: "completed" });

    expect((await store.get(second.id))?.status).toBe("queued");
  });

  it("stores a full report without losing anything", async () => {
    const created = job({
      status: "completed",
      report: {
        url: "https://example.com/",
        finalUrl: "https://example.com/",
        httpStatus: 200,
        findings: [
          {
            id: "seo.title.missing",
            category: "seo",
            severity: "serious",
            status: "fail",
            evidence: [{ kind: "measured", source: "dom", summary: "No title." }],
            explanation: "Why.",
            recommendation: "Add one.",
          },
        ],
        score: {
          scoringVersion: 1,
          overall: {
            score: 64,
            grade: "D",
            weighting: [],
            assessedCategories: ["seo"],
            notAssessedCategories: [],
            explanation: "x",
          },
          categories: [],
        },
        recommendations: {
          recommendations: [],
          weightBasis: "declared",
          summary: {
            total: 0,
            fixes: 0,
            needsReview: 0,
            byLevel: { high: 0, medium: 0, low: 0, none: 0 },
            byTier: { 1: 0, 2: 0, 3: 0, 4: 0 },
            byCategory: {},
            recoverablePoints: 0,
            unquantified: 0,
            passingFindings: 0,
          },
        },
        roast: {
          lines: [],
          source: "deterministic",
          fallbackReason: null,
          note: null,
          meta: null,
        },
        interpretation: null,
        interpretationUnavailableReason: null,
        notRun: [],
        durationMs: 1,
      },
    });

    await store.create(created);

    expect(await store.get(created.id)).toEqual(created);
  });
});

// ---------------------------------------------------------------------------
// The file store specifically
// ---------------------------------------------------------------------------

describe("the file store survives a restart", () => {
  it("reads a job written by a different store instance", async () => {
    // The whole reason this phase has a store at all (ADR-031).
    const created = job();
    await createFileJobStore({ directory }).create(created);

    const reopened = createFileJobStore({ directory });

    expect(await reopened.get(created.id)).toEqual(created);
  });

  it("sees updates made by another instance", async () => {
    const created = job();
    await createFileJobStore({ directory }).create(created);
    await createFileJobStore({ directory }).update(created.id, { status: "completed" });

    expect((await createFileJobStore({ directory }).get(created.id))?.status).toBe(
      "completed",
    );
  });

  it("creates the directory on first write", async () => {
    const nested = path.join(directory, "deeper", "still");
    const created = job();

    await createFileJobStore({ directory: nested }).create(created);

    expect(await readdir(nested)).toEqual([`${created.id}.json`]);
  });

  it("names the file after the job id", async () => {
    const created = job();
    await createFileJobStore({ directory }).create(created);

    const contents = await readFile(path.join(directory, `${created.id}.json`), "utf8");

    expect(JSON.parse(contents)).toEqual(created);
  });

  it("leaves no temporary files behind", async () => {
    const created = job();
    const store = createFileJobStore({ directory });

    await store.create(created);
    await store.update(created.id, { status: "running" });

    expect((await readdir(directory)).filter((file) => file.endsWith(".tmp"))).toEqual(
      [],
    );
  });
});

describe("the file store refuses to be used as a path", () => {
  it.each([
    "../../../etc/passwd",
    "..",
    ".",
    "a/b",
    "a\\b",
    "job.json",
    "",
    "00000000-0000-4000-8000-000000000000/../../x",
  ])("refuses the id %s", async (id) => {
    const store = createFileJobStore({ directory });

    // The route validates too. This check is the one that holds if a future
    // caller forgets to.
    await expect(store.get(id)).rejects.toBeInstanceOf(JobStoreError);
  });

  it("writes nothing when the id is refused", async () => {
    const store = createFileJobStore({ directory });

    await expect(store.create(job({ id: "../escape" }))).rejects.toBeInstanceOf(
      JobStoreError,
    );
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("accepts only what createJobId produces", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(isJobId(createJobId())).toBe(true);
    }
  });
});

describe("the file store on damaged data", () => {
  it("reports a corrupt record rather than calling it missing", async () => {
    // A disk problem must not look like a 404.
    const id = createJobId();
    await createFileJobStore({ directory }).create(job({ id }));
    await writeFile(path.join(directory, `${id}.json`), "{not json", "utf8");

    await expect(createFileJobStore({ directory }).get(id)).rejects.toBeInstanceOf(
      JobStoreError,
    );
  });

  it("still reports a genuinely missing record as null", async () => {
    expect(await createFileJobStore({ directory }).get(createJobId())).toBeNull();
  });
});

describe("the memory store is a test double", () => {
  it("does not hand out the object it stores", async () => {
    const store = createMemoryJobStore();
    const created = job();

    await store.create(created);
    const fetched = await store.get(created.id);
    (fetched as { status: string }).status = "completed";

    expect((await store.get(created.id))?.status).toBe("queued");
  });

  it("refuses a malformed id by returning null", async () => {
    expect(await createMemoryJobStore().get("../escape")).toBeNull();
  });

  it("clears", async () => {
    const store = createMemoryJobStore();
    await store.create(job());

    store.clear();

    expect(store.all()).toEqual([]);
  });
});
