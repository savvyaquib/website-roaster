/**
 * An address with nothing behind it.
 */

import Link from "next/link";

import { Masthead, Shell } from "./_components/primitives";

export default function NotFound() {
  return (
    <>
      <Masthead subtle />

      <main className="flex-1">
        <Shell>
          <div className="py-16">
            <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
            <p className="mt-2 max-w-[62ch] text-ink-muted">
              There is nothing at this address.
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
