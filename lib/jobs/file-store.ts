/**
 * The job store: one JSON file per job.
 *
 * Source of truth: ADR-019, ADR-020, ADR-031, ADR-057.
 *
 * ## Why a directory of files
 *
 * ADR-031 asks for "the simplest thing that survives a process restart", and
 * ADR-020 forbids reaching for infrastructure before a constraint demands it.
 * A file per job survives a restart, needs no dependency, no schema migration
 * and no daemon, and can be read with `cat` when something is wrong.
 *
 * `node:sqlite` was the alternative and is available on this runtime. It was
 * not chosen **yet**: it buys indexed queries and transactions, and this phase
 * needs neither — every access is by primary key. Phase 19 adds history and
 * retention, which is where those start to matter, and the `JobStore` interface
 * exists so that swap costs one file.
 *
 * ## Writes are atomic
 *
 * Every write goes to a temporary file and is renamed into place. `rename` is
 * atomic on both POSIX and Windows for a same-directory move, so a reader never
 * sees a half-written record and a crash mid-write leaves the previous version
 * intact rather than a truncated one.
 *
 * ## What this store does not do
 *
 * No locking. A job is only ever written by the one runner executing it, so two
 * writers for the same id would already be a bug elsewhere. Two *different*
 * jobs never contend, because they are different files. If Phase 20's
 * concurrency work introduces shared writers, this is the assumption that
 * breaks first.
 */

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { isJobId } from "./id";
import type { AnalysisJob, JobPatch, JobStore } from "./types";

export const DEFAULT_STORE_DIR = path.join(process.cwd(), ".data", "jobs");

export class JobStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JobStoreError";
  }
}

export interface FileJobStoreOptions {
  readonly directory?: string;
}

/**
 * Resolve a job's file path, refusing anything that is not a job id.
 *
 * The check is what stops a client-supplied id escaping the store directory.
 * It is deliberately whitelist-shaped: a UUID, or nothing.
 */
function filePathFor(directory: string, id: string): string {
  if (!isJobId(id)) {
    throw new JobStoreError(`Refusing to touch the filesystem for a malformed job id.`);
  }

  return path.join(directory, `${id}.json`);
}

export function createFileJobStore(options: FileJobStoreOptions = {}): JobStore {
  const directory = options.directory ?? DEFAULT_STORE_DIR;
  let ready: Promise<void> | undefined;

  const ensureDirectory = (): Promise<void> => {
    ready ??= mkdir(directory, { recursive: true }).then(() => undefined);
    return ready;
  };

  async function readJob(id: string): Promise<AnalysisJob | null> {
    const file = filePathFor(directory, id);

    let contents: string;

    try {
      contents = await readFile(file, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new JobStoreError(`Could not read job ${id}.`, { cause });
    }

    try {
      return JSON.parse(contents) as AnalysisJob;
    } catch (cause) {
      // A corrupt record is not a missing one, and pretending otherwise would
      // turn a disk problem into a silent 404.
      throw new JobStoreError(`Job ${id} is stored but could not be parsed.`, { cause });
    }
  }

  async function writeJob(job: AnalysisJob): Promise<void> {
    await ensureDirectory();

    const file = filePathFor(directory, job.id);
    // Unique per write, so two writes cannot collide on the temporary name.
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;

    try {
      await writeFile(temporary, JSON.stringify(job), "utf8");
      await rename(temporary, file);
    } catch (cause) {
      await unlink(temporary).catch(() => undefined);
      throw new JobStoreError(`Could not write job ${job.id}.`, { cause });
    }
  }

  return {
    async create(job) {
      await writeJob(job);
    },

    get: readJob,

    async update(id, patch: JobPatch) {
      const existing = await readJob(id);
      if (existing === null) return null;

      const updated: AnalysisJob = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };

      await writeJob(updated);
      return updated;
    },
  };
}
