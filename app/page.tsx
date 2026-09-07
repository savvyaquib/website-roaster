/**
 * The landing page.
 *
 * One control, and the plainest possible statement of what pressing it does.
 * There is no feature grid and no marketing section: the product's argument is
 * the report, and the fastest route to that argument is the input.
 */

import { AnalyzeForm } from "./_components/analyze-form";
import { Masthead, Shell } from "./_components/primitives";

const CHECKS = [
  ["Search", "titles, descriptions, headings, canonicals, robots, sitemaps"],
  ["Security", "transport, headers, cookie attributes, what the server reveals"],
  ["Content", "the headline, the pitch, calls to action, contact routes"],
  ["Usability", "navigation weight, competing actions, heading structure"],
] as const;

export default function Home() {
  return (
    <>
      <Masthead />

      <main className="flex-1">
        <Shell>
          <div className="py-16 sm:py-24">
            <h1 className="max-w-[20ch] text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
              Find out what your page is actually doing.
            </h1>
            <p className="mt-5 max-w-[58ch] text-lg leading-8 text-ink-muted">
              Website Roaster reads one public page, records what it observes, and turns
              that into a score you can trace back to the evidence. Then it makes fun of
              the page a little.
            </p>

            <div className="mt-10 max-w-2xl">
              <AnalyzeForm />
            </div>
          </div>

          <div className="border-t border-rule py-10">
            <h2 className="text-sm font-semibold">What gets checked</h2>
            <dl className="mt-4 space-y-3">
              {CHECKS.map(([name, detail]) => (
                <div key={name} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                  <dt className="w-28 shrink-0 text-sm font-medium">{name}</dt>
                  <dd className="max-w-[62ch] text-sm text-ink-muted">{detail}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 max-w-[62ch] text-sm text-ink-muted">
              Performance, accessibility and mobile need a real browser. That pass is not
              wired into the API yet, so those categories are reported as not assessed
              rather than guessed at.
            </p>
          </div>
        </Shell>
      </main>

      <footer className="border-t border-rule">
        <Shell>
          <p className="py-6 text-sm text-ink-muted">
            Every number in a report comes from something observed on the page. Nothing is
            estimated, and a check that could not run says so.
          </p>
        </Shell>
      </footer>
    </>
  );
}
