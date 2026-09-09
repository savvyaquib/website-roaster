/**
 * The parts a model wrote, and the parts it did not.
 *
 * Both sections are typographically distinct from the data around them, because
 * a reader should never be unsure which words came from a measurement and which
 * from an interpretation. Where AI is absent — no key, a refused answer — the
 * section says so plainly instead of disappearing, since a missing section that
 * silently vanishes is indistinguishable from one that had nothing to report.
 */

import type { AiInterpretation } from "@/lib/ai/interpretation";
import type { Roast } from "@/lib/roast";

import { Empty } from "./primitives";

export function Interpretation({
  interpretation,
  unavailableReason,
}: {
  interpretation: AiInterpretation | null;
  unavailableReason: string | null;
}) {
  if (interpretation === null) {
    return (
      <Empty>
        {unavailableReason ?? "No interpretation was produced for this analysis."}{" "}
        Everything above was measured, so the report is complete without it.
      </Empty>
    );
  }

  return (
    <div className="space-y-9">
      {/* An essay, so it is set like one: reading size, generous leading. */}
      <p className="max-w-[60ch] text-[1.05rem] leading-8">
        {interpretation.executiveSummary}
      </p>

      {interpretation.problems.length === 0 ? null : (
        <div>
          <h3 className="display text-lg">What to deal with first</h3>
          <ol className="mt-4 space-y-5">
            {interpretation.problems.map((problem) => (
              <li key={problem.finding.id} className="max-w-[68ch]">
                <p className="text-sm leading-6">{problem.whyItMatters}</p>
                <p className="mt-2 rounded-r-md border-l-2 border-ink/30 bg-paper-deep/60 py-2.5 pr-4 pl-4 text-sm leading-6">
                  {problem.recommendation}
                </p>
                <p className="mt-1.5 font-mono text-xs text-ink-muted opacity-80">
                  {problem.finding.id}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {interpretation.strengths.length === 0 ? null : (
        <div>
          <h3 className="display text-lg">What is working</h3>
          <ul className="mt-4 space-y-4">
            {interpretation.strengths.map((strength) => (
              <li key={strength.finding.id} className="max-w-[68ch]">
                <p className="text-sm leading-6">{strength.whyItHelps}</p>
                <p className="mt-1.5 font-mono text-xs text-ink-muted opacity-80">
                  {strength.finding.id}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="max-w-[62ch] border-t border-rule pt-4 text-xs leading-5 text-ink-muted">
        Written by {interpretation.meta.provider}/{interpretation.meta.model} from the
        findings above. Every claim was checked against them before it was shown.
      </p>
    </div>
  );
}

/**
 * The roast.
 *
 * Phase 15 stores each line as an observation and a punchline with different
 * authors, and the typography says so — but the joke goes first now. It is set
 * in the display face at the largest reading size in the product, with the
 * observation underneath as the receipt, so the line lands and then proves
 * itself. That order is the whole product in miniature: a verdict you can check.
 */
export function RoastPanel({ roast }: { roast: Roast }) {
  if (roast.lines.length === 0) {
    return <Empty>{roast.note ?? "There was nothing here to roast."}</Empty>;
  }

  return (
    <div>
      <ol className="space-y-9">
        {roast.lines.map((line) => (
          <li
            key={line.finding.id}
            className="max-w-[54ch] border-l-2 border-rule-strong pl-5 sm:pl-7"
          >
            <p className="display text-[1.3rem] leading-[1.45] sm:text-[1.55rem]">
              {line.punchline}
            </p>
            <p className="mt-3 text-xs leading-5 text-ink-muted">{line.observation}</p>
          </li>
        ))}
      </ol>

      <p className="mt-9 max-w-[62ch] border-t border-rule pt-4 text-xs leading-5 text-ink-muted">
        {roast.source === "ai"
          ? "Written from the findings above."
          : `Written from the findings above, without AI. ${roast.fallbackReason ?? ""}`}
      </p>
    </div>
  );
}

/**
 * Screenshots.
 *
 * The pipeline does not capture them yet — the browser analyzers are not wired
 * into the API (ADR-057) — so this is an empty state that names the reason
 * rather than a section that quietly does not exist.
 */
export function Screenshots({ notRun }: { notRun: readonly string[] }) {
  const browserAnalyzers = notRun.length > 0;

  return (
    <Empty>
      No screenshots were captured for this analysis.{" "}
      {browserAnalyzers
        ? `Screenshots come from the browser pass, which also covers ${notRun.join(", ")}. It did not run.`
        : "The browser pass did not produce any."}
    </Empty>
  );
}
