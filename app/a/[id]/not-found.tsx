/**
 * A job id that leads nowhere.
 *
 * The API cannot distinguish "never existed" from "wrong shape" without helping
 * someone guessing at ids (ADR-057), so neither can this page. It says what it
 * knows and offers the one useful action.
 */

import Link from "next/link";

import { Masthead, Shell } from "../../_components/primitives";

export default function AnalysisNotFound() {
  return (
    <>
      <Masthead subtle />

      <main className="flex-1">
        <Shell>
          <div className="py-16">
            <h1 className="display text-3xl sm:text-4xl">Analysis not found</h1>
            <p className="mt-3 max-w-[62ch] leading-7 text-ink-muted">
              This link does not point at a report. It may have been mistyped, or the
              report may have been removed from the server.
            </p>

            <Link
              href="/"
              className="mt-8 inline-block rounded-lg bg-ink px-6 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-85"
            >
              Analyze a page
            </Link>
          </div>
        </Shell>
      </main>
    </>
  );
}
