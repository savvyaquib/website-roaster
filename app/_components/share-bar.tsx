"use client";

/**
 * Copying the link to a report.
 *
 * The report is already shareable — it is a plain URL that server-renders and
 * carries its own card. This is only the convenience of not having to reach for
 * the address bar.
 *
 * The confirmation replaces the button's own label rather than appearing
 * elsewhere, so the feedback is where the attention already is, and it is
 * announced once rather than polled.
 */

import { useEffect, useState } from "react";

export function ShareBar() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      // Clipboard access can be refused, and there is nothing useful to say
      // about it: the address bar still works.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={copy}
        className="rounded-[3px] border border-rule-strong bg-surface px-4 py-2 text-sm font-medium hover:border-ink"
      >
        {copied ? "Link copied" : "Copy link"}
      </button>

      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Link copied to the clipboard" : ""}
      </span>

      <span className="text-sm text-ink-muted">
        Anyone with this link can read the report.
      </span>
    </div>
  );
}
