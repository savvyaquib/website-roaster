/**
 * The landing page.
 *
 * One control, and the plainest possible statement of what pressing it does.
 * There is no feature grid and no marketing section: the product's argument is
 * the report, and the fastest route to that argument is the input.
 *
 * What carries the page instead is the type. The headline is set in the display
 * face at a size nothing else reaches, which is the only decoration here — and
 * it is decoration that says something, since the same face marks every verdict
 * in the report that follows.
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
            <h1 className="display max-w-[15ch] text-[2.6rem] leading-[1.04] sm:text-[4rem]">
              Find out what your page is <em>actually</em> doing.
            </h1>
            <p className="mt-6 max-w-[54ch] text-[1.05rem] leading-8 text-ink-muted">
              Website Roaster reads one public page, records what it observes, and turns
              that into a score you can trace back to the evidence. Then it makes fun of
              the page a little.
            </p>

            <div className="mt-10 max-w-2xl">
              <AnalyzeForm />
            </div>
          </div>

          <div className="border-t border-rule py-12">
            <h2 className="display text-2xl">What gets checked</h2>

            <div className="mt-7 grid gap-x-10 gap-y-7 sm:grid-cols-2">
              {CHECKS.map(([name, detail]) => (
                <div key={name} className="border-t border-rule pt-4">
                  <h3 className="display text-lg">{name}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-ink-muted">{detail}</p>
                </div>
              ))}
            </div>

            <p className="mt-9 max-w-[62ch] rounded-r-md border-l-2 border-rule-strong bg-paper-deep/60 py-3 pr-4 pl-4 text-sm leading-6 text-ink-muted">
              Performance, accessibility and mobile need a real browser. That pass is not
              wired into the API yet, so those categories are reported as not assessed
              rather than guessed at.
            </p>
          </div>
        </Shell>
      </main>

      <footer className="border-t border-rule">
        <Shell>
          <p className="max-w-[62ch] py-7 text-sm leading-6 text-ink-muted">
            Every number in a report comes from something observed on the page. Nothing is
            estimated, and a check that could not run says so.
          </p>
        </Shell>
      </footer>
    </>
  );
}
