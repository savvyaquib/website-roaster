"use client";

/**
 * The last resort.
 *
 * Says what happened, offers the action that usually works, and shows the digest
 * so a report can be matched to a server log. It does not show the message: an
 * unexpected error's text is by definition something nobody decided was safe to
 * publish.
 */

import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">This page did not load</h1>
        <p className="mt-2 max-w-[62ch] text-ink-muted">
          Something failed while rendering. Trying again often works; if it does not, the
          reference below will be in the server log.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={reset}
            className="rounded-[3px] bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:opacity-90"
          >
            Try again
          </button>
          <Link href="/" className="text-sm underline">
            Start a new analysis
          </Link>
        </div>

        {error.digest === undefined ? null : (
          <p className="mt-6 font-mono text-xs text-ink-muted">
            Reference {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
