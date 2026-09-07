/**
 * Shared layout pieces.
 *
 * Structure here comes from rules and space rather than from boxes: the report
 * is a document, and a document does not need every paragraph in a card.
 */

import Link from "next/link";
import type { ReactNode } from "react";

export function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">{children}</div>;
}

export function Masthead({ subtle = false }: { subtle?: boolean }) {
  return (
    <header className="border-b border-rule">
      <Shell>
        <div className="flex items-baseline gap-3 py-4">
          <Link
            href="/"
            className="font-mono text-sm font-medium tracking-tight text-ink hover:underline"
          >
            Website Roaster
          </Link>
          {subtle ? null : (
            <span className="text-sm text-ink-muted">Evidence, then a verdict</span>
          )}
        </div>
      </Shell>
    </header>
  );
}

/**
 * A titled region of the report.
 *
 * The count sits beside the heading rather than above it as a label, because a
 * count is part of the heading's meaning: "Top issues 8" reads as one thing.
 */
export function Section({
  title,
  count,
  description,
  children,
}: {
  title: string;
  count?: number;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-rule py-10 first:border-t-0">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {count === undefined ? null : (
          <span className="tabular font-mono text-sm text-ink-muted">{count}</span>
        )}
      </div>
      {description === undefined ? null : (
        <p className="mt-1 max-w-[62ch] text-sm text-ink-muted">{description}</p>
      )}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/**
 * What a section shows when it has nothing to show.
 *
 * Never a shrug. Each one says what is absent and why, because in this product
 * an absence is usually a result (ADR-021).
 */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[62ch] border-l-2 border-rule-strong py-1 pl-4 text-sm text-ink-muted">
      {children}
    </p>
  );
}

/** A small key/value pair for header data. */
export function Datum({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="tabular font-mono text-sm">{value}</dd>
    </div>
  );
}
