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

/**
 * The wordmark is the type system.
 *
 * "Website" is set in the face used for everything measured, "Roaster" in the
 * face used for everything judged. The product's whole argument — facts, then a
 * verdict — is stated in two words before a reader has read anything else, and
 * it needs no logo to do it.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="font-medium tracking-tight">Website</span>
      <span className="display italic">Roaster</span>
    </span>
  );
}

export function Masthead({ subtle = false }: { subtle?: boolean }) {
  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-paper/92 backdrop-blur-md">
      <Shell>
        <div className="flex items-baseline justify-between gap-4 py-4">
          <Link
            href="/"
            className="text-[1.05rem] decoration-rule-strong underline-offset-4 hover:underline"
          >
            <Wordmark />
          </Link>
          {subtle ? null : (
            <span className="hidden text-xs text-ink-muted sm:inline">
              Evidence, then a verdict
            </span>
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
    <section className="border-t border-rule py-12 first:border-t-0">
      <div className="flex items-baseline gap-3">
        <h2 className="display text-2xl sm:text-[1.7rem]">{title}</h2>
        {count === undefined ? null : (
          <span className="tabular text-sm text-ink-muted">{count}</span>
        )}
      </div>
      {description === undefined ? null : (
        <p className="mt-2 max-w-[62ch] text-sm leading-6 text-ink-muted">
          {description}
        </p>
      )}
      <div className="mt-7">{children}</div>
    </section>
  );
}

/**
 * What a section shows when it has nothing to show.
 *
 * Never a shrug. Each one says what is absent and why, because in this product
 * an absence is usually a result (ADR-021). Set as a margin note rather than as
 * an error, since most of these are ordinary outcomes.
 */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[62ch] rounded-r-md border-l-2 border-rule-strong bg-paper-deep/60 py-3 pr-4 pl-4 text-sm leading-6 text-ink-muted">
      {children}
    </p>
  );
}

/** A small key/value pair for header data. */
export function Datum({
  label,
  value,
  plain = false,
}: {
  label: string;
  value: ReactNode;
  /** For values that are words rather than measurements. */
  plain?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd
        className={
          plain
            ? "tabular text-sm leading-6 font-medium"
            : "tabular display text-xl leading-tight"
        }
      >
        {value}
      </dd>
    </div>
  );
}
