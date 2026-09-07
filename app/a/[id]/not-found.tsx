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
            <h1 className="text-2xl font-semibold tracking-tight">Analysis not found</h1>
            <p className="mt-2 max-w-[62ch] text-ink-muted">
              This link does not point at a report. It may have been mistyped, or the
              report may have been removed from the server.
            </p>

            <Link
              href="/"
              className="mt-8 inline-block rounded-[3px] bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:opacity-90"
            >
              Analyze a page
            </Link>
          </div>
        </Shell>
      </main>
    </>
  );
}
