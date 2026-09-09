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
            <h1 className="display text-3xl sm:text-4xl">Page not found</h1>
            <p className="mt-3 max-w-[62ch] leading-7 text-ink-muted">
              There is nothing at this address.
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
