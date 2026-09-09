"use client";

/**
 * The one control on the landing page.
 *
 * Submits to the API and navigates to the analysis. Client-side validation is
 * deliberately thin — it catches an empty field so the user is not made to wait
 * for a round trip to be told nothing was typed, and leaves every real judgement
 * to the server, which is the only place that can make it (ADR-057).
 */

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

interface ApiResponse {
  readonly job?: { readonly id: string };
  readonly error?: { readonly code: string; readonly message: string };
}

export function AnalyzeForm() {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();

  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (url.trim().length === 0) {
      setError("Enter the address of a page to analyze.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const body = (await response.json()) as ApiResponse;

      // A refused URL still produces a job, so the result page can explain it
      // properly rather than the form showing a truncated version of the story.
      if (body.job !== undefined) {
        router.push(`/a/${body.job.id}`);
        return;
      }

      setError(body.error?.message ?? "The analysis could not be started.");
      setSubmitting(false);
    } catch {
      setError("Could not reach the analyzer. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor={inputId} className="block text-sm text-ink-muted">
        Address of the page to analyze
      </label>

      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <input
          id={inputId}
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="example.com"
          disabled={submitting}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          className="min-w-0 flex-1 rounded-lg border border-rule-strong bg-surface px-4 py-3.5 font-mono text-base text-ink shadow-sm transition-colors placeholder:text-ink-muted/70 focus:border-ink disabled:opacity-60"
        />

        <button
          type="submit"
          disabled={submitting}
          className="shrink-0 rounded-lg bg-ink px-7 py-3.5 text-base font-medium text-paper transition-opacity hover:opacity-85 disabled:opacity-60"
        >
          {submitting ? "Starting" : "Analyze"}
        </button>
      </div>

      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm">
        {error === null ? (
          <span className="text-ink-muted">
            Public pages only. The https:// is optional.
          </span>
        ) : (
          <span id={errorId} className="text-poor">
            {error}
          </span>
        )}
      </p>
    </form>
  );
}
