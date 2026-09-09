/**
 * The gap between a navigation and a server render.
 *
 * Deliberately quiet: it is on screen for a few hundred milliseconds, and a
 * skeleton that guesses at the shape of the report would flash a layout that is
 * about to be replaced.
 */

export default function Loading() {
  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8">
        <p role="status" aria-live="polite" className="text-sm text-ink-muted">
          Loading
        </p>
        <div className="mt-4 h-1 w-full max-w-md overflow-hidden rounded-full bg-paper-deep">
          <div className="sweep h-full w-1/4 rounded-full bg-ink" />
        </div>
      </div>
    </main>
  );
}
