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
  statusLabel,
  TEXT_TONE,
  toneForSeverity,
} from "@/lib/ui/format";

/**
 * One observation.
 *
 * `measured` and `heuristic` are marked differently because ADR-009 forbids
 * presenting an inference as a fact, and a reader deciding whether to trust a
 * line needs to know which one they are reading.
 */
function EvidenceItem({ item }: { item: Evidence }) {
  return (
    <li className="border-l-2 border-rule py-0.5 pl-3">
      <p className="text-sm">{item.summary}</p>
      <p className="mt-0.5 font-mono text-xs text-ink-muted">
        {item.kind === "measured" ? "measured" : "inferred"} from {item.source}
        {item.detail === undefined ? null : (
          <>
            {" · "}
            <span className="break-all">{item.detail}</span>
          </>
        )}
      </p>
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
    <span
      className={`font-mono text-xs whitespace-nowrap ${showSeverity ? TEXT_TONE[tone] : "text-ink-muted"}`}
    >
      {statusLabel(finding.status)}
      {showSeverity ? (
        <span className="text-ink-muted"> / {severityLabel(finding.severity)}</span>
      ) : null}
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
    <details className="group border-b border-rule py-3 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-baseline gap-3">
        {rank === undefined ? null : (
          <span className="tabular w-5 shrink-0 font-mono text-sm text-ink-muted">
            {rank}
          </span>
        )}
        <span className="flex-1 text-sm font-medium group-open:underline">{title}</span>
        <Marker finding={finding} />
      </summary>

      <div className={`mt-3 space-y-3 ${rank === undefined ? "" : "pl-8"}`}>
        <p className="max-w-[68ch] text-sm text-ink-muted">{finding.explanation}</p>

        {children}

        <div>
          <p className="mb-1.5 text-xs text-ink-muted">
            What was observed ({finding.evidence.length})
          </p>
          <ul className="space-y-1.5">
            {finding.evidence.map((item, index) => (
              <EvidenceItem key={`${finding.id}-${index}`} item={item} />
            ))}
          </ul>
        </div>

        <p className="font-mono text-xs text-ink-muted">
          {finding.id} · {categoryLabel(finding.category)}
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
        <p className="max-w-[68ch] border-l-2 border-rule-strong py-0.5 pl-4 text-sm">
          {finding.recommendation}
        </p>
      )}

      <p className="font-mono text-xs text-ink-muted">
        {impact.level} impact
        {impact.points === null
          ? " · score effect cannot be priced from a finding"
          : ` · fixing it returns ${impact.points} point${impact.points === 1 ? "" : "s"}`}
      </p>
    </FindingRow>
  );
}

/** The passing checks, so the report says what a site got right. */
export function StrengthRow({ finding }: { finding: Finding }) {
  const title = finding.evidence[0]?.summary ?? finding.explanation;

  return <FindingRow finding={finding} title={title.replace(/\.$/, "")} />;
}
