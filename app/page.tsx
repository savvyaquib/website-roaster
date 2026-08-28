/**
 * Placeholder landing page.
 *
 * The real interface is built in Phase 17. This exists so that the application
 * boots and identifies itself correctly; it deliberately does not contain a URL
 * submission form, because URL validation is Phase 1.
 */
export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 font-sans dark:bg-black">
      <main className="w-full max-w-xl">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Website Roaster
        </h1>
        <p className="mt-3 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Analyzes a single public web page and produces a structured, evidence-based
          quality report.
        </p>
        <p className="mt-8 font-mono text-sm text-zinc-500 dark:text-zinc-500">
          Phase 0 — repository foundation. The analysis pipeline is not built yet.
        </p>
      </main>
    </div>
  );
}
