"use client";

/**
 * Waiting, honestly.
 *
 * ## Why there is no five-step progress bar
 *
 * The API reports `queued` and `running`. It does not report which analyzer is
 * currently working, so a stepper showing "Fetching → Parsing → Scoring" would
 * be animating a story nobody measured. This product refuses to invent
 * measurements; inventing one in the UI would be the same failure with nicer
 * rounded corners.
 *
 * What is shown instead is what is known: the state, how long it has been
 * running, and what the analyzer is doing in general terms. The single sweeping
 * bar is honest — it marks that work is happening without claiming to know how
 * much is left.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { AnalysisStatus } from "@/lib/types/analysis";
import { formatDuration, statusCopy } from "@/lib/ui/format";

/** How often to ask. Often enough to feel live, rare enough to be polite. */
const POLL_INTERVAL_MS = 1500;

export function ProgressView({
  jobId,
  status,
  startedAt,
}: {
  jobId: string;
  status: AnalysisStatus;
  startedAt: string | null;
}) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const copy = statusCopy(status);

  // Poll until the status changes, then let the server component re-render with
  // the real report. The page owns the data; this only asks it to look again.
  useEffect(() => {
    let cancelled = false;

    const timer = setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/analyze/${jobId}`, { cache: "no-store" });
          if (!response.ok || cancelled) return;

          const body = (await response.json()) as { job?: { status: string } };

          if (body.job !== undefined && body.job.status !== status) router.refresh();
        } catch {
          // A failed poll is not worth telling anyone about; the next one is
          // 1.5 seconds away.
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobId, status, router]);

  useEffect(() => {
    if (startedAt === null) return;

    const began = Date.parse(startedAt);
    const timer = setInterval(() => setElapsed(Date.now() - began), 200);

    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <div className="py-16">
      <div
        role="status"
        aria-live="polite"
        // The elapsed counter is deliberately outside the live region: a screen
        // reader announcing a new number five times a second is unusable.
        className="max-w-[62ch]"
      >
        <h1 className="text-2xl font-semibold tracking-tight">{copy.heading}</h1>
        <p className="mt-2 text-ink-muted">{copy.detail}</p>
      </div>

      <div className="mt-8 h-1 w-full max-w-md overflow-hidden rounded-[2px] bg-rule">
        <div className="sweep h-full w-1/4 rounded-[2px] bg-ink" />
      </div>

      {startedAt === null ? null : (
        <p className="tabular mt-3 font-mono text-xs text-ink-muted" aria-hidden="true">
          {formatDuration(elapsed)} elapsed
        </p>
      )}
    </div>
  );
}
