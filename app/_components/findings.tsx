/**
 * Findings, recommendations and strengths.
 *
 * The evidence is the point of this product, so it is never more than one
 * keystroke away: each item is a native `<details>`, which gives keyboard
 * operation, screen-reader semantics and open-by-default-on-print for free, and
 * needs no state, no library and no ARIA of its own.
 */

import type { Recommendation } from "@/lib/recommendations";
import type { Evidence, Finding } from "@/lib/types/finding";
import {
  categoryLabel,
  severityLabel,
  SOFT_TONE,
  statusLabel,
  TEXT_TONE,
  toneForSeverity,
} from "@/lib/ui/format";

/** The disclosure marker, drawn rather than fetched. */
function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 8 10"
      className="disclosure mt-[0.3rem] h-2.5 w-2 shrink-0 fill-current text-rule-strong"
    >
      <path d="M0 0l8 5-8 5z" />
    </svg>
  );
}

/**
 * One observation.
 *
 * `measured` and `heuristic` are marked differently because ADR-009 forbids
 * presenting an inference as a fact, and a reader deciding whether to trust a
 * line needs to know which one they are reading. An inference is set in italic:
 * the same distinction a newspaper makes between a report and a comment.
 */
function EvidenceItem({ item }: { item: Evidence }) {
  const inferred = item.kind !== "measured";

  return (
    <li className="border-l border-rule py-0.5 pl-4">
      <p className="text-sm leading-6">{item.summary}</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        <span className={inferred ? "italic" : ""}>
          {inferred ? "inferred" : "measured"}
        </span>{" "}
        from {item.source}
      </p>
      {item.detail === undefined ? null : (
        <p className="mt-1 font-mono text-xs break-all text-ink-muted opacity-80">
          {item.detail}
        </p>
      )}
    </li>
  );
}

function Marker({ finding }: { finding: Finding }) {
  const tone = toneForSeverity(finding.severity);

  // Severity is only meaningful for something that went wrong. Printing
  // "Passed / Info" beside seventeen passing checks is noise that makes the
  // handful of real problems harder to pick out.
  const showSeverity = finding.status === "fail" || finding.status === "warn";

  return (
    <span className="flex shrink-0 items-baseline gap-2.5">
      {showSeverity ? (
        <span className="hidden text-xs text-ink-muted sm:inline">
          {severityLabel(finding.severity)}
        </span>
      ) : null}
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap ${
          showSeverity
            ? `${SOFT_TONE[tone]} ${TEXT_TONE[tone]}`
            : "bg-paper-deep text-ink-muted"
        }`}
      >
        {statusLabel(finding.status)}
      </span>
    </span>
  );
}

/** A finding with its evidence folded away. */
export function FindingRow({
  finding,
  title,
  rank,
  children,
}: {
  finding: Finding;
  title: string;
  rank?: number;
  children?: React.ReactNode;
}) {
  return (
    <details className="group border-b border-rule last:border-b-0">
      <summary className="-mx-3 flex cursor-pointer list-none items-baseline gap-3 rounded-md px-3 py-3.5 hover:bg-paper-deep/50">
        <Chevron />
        {rank === undefined ? null : (
          <span className="tabular display w-5 shrink-0 text-base text-ink-muted">
            {rank}
          </span>
        )}
        <span className="flex-1 text-sm leading-6 font-medium">{title}</span>
        <Marker finding={finding} />
      </summary>

      <div className={`space-y-4 pb-5 ${rank === undefined ? "pl-5" : "pl-5 sm:pl-11"}`}>
        <p className="max-w-[68ch] text-sm leading-6 text-ink-muted">
          {finding.explanation}
        </p>

        {children}

        <div>
          <p className="mb-2 text-xs text-ink-muted">
            What was observed ({finding.evidence.length})
          </p>
          <ul className="space-y-2.5">
            {finding.evidence.map((item, index) => (
              <EvidenceItem key={`${finding.id}-${index}`} item={item} />
            ))}
          </ul>
        </div>

        <p className="font-mono text-xs text-ink-muted opacity-80">
          {finding.id} — {categoryLabel(finding.category)}
        </p>
      </div>
    </details>
  );
}

/** A ranked problem, with what it costs and what to do. */
export function RecommendationRow({
  recommendation,
}: {
  recommendation: Recommendation;
}) {
  const { finding, impact } = recommendation;

  return (
    <FindingRow finding={finding} title={recommendation.title} rank={recommendation.rank}>
      {finding.recommendation === undefined ? null : (
        <p className="max-w-[68ch] rounded-r-md border-l-2 border-ink/30 bg-paper-deep/60 py-2.5 pr-4 pl-4 text-sm leading-6">
          {finding.recommendation}
        </p>
      )}

      <p className="text-xs text-ink-muted">
        {impact.level} impact
        {impact.points === null
          ? " — score effect cannot be priced from a finding"
          : ` — fixing it returns ${impact.points} point${impact.points === 1 ? "" : "s"}`}
      </p>
    </FindingRow>
  );
}

/** The passing checks, so the report says what a site got right. */
export function StrengthRow({ finding }: { finding: Finding }) {
  const title = finding.evidence[0]?.summary ?? finding.explanation;

  return <FindingRow finding={finding} title={title.replace(/\.$/, "")} />;
}
