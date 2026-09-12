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
  TRACK_TONE,
} from "@/lib/ui/format";

/**
 * The disclosure marker: a plus that becomes a minus.
 *
 * Typographic rather than iconographic, because the rows are set like an
 * index and a chevron reads like a widget. Both glyphs are always in the
 * markup; CSS shows one.
 */
function Toggle() {
  return (
    <span
      aria-hidden="true"
      className="w-4 shrink-0 self-start pt-0.5 text-right text-lg leading-none text-rule-strong select-none group-hover:text-ink-muted"
    >
      <span className="group-open:hidden">+</span>
      <span className="hidden group-open:inline">−</span>
    </span>
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

/** Whether a finding's severity is worth printing: only when something went wrong. */
function severityShown(finding: Finding): boolean {
  // Severity is only meaningful for something that went wrong. Printing
  // "Passed / Info" beside seventeen passing checks is noise that makes the
  // handful of real problems harder to pick out.
  return finding.status === "fail" || finding.status === "warn";
}

/**
 * The outcome, in words, at the end of the row.
 *
 * Two short lines rather than a pill: the status, and under it the severity
 * when there is one. Colour repeats what the words say and never replaces it.
 */
function Outcome({ finding }: { finding: Finding }) {
  const tone = toneForSeverity(finding.severity);
  const showSeverity = severityShown(finding);

  return (
    <span className="shrink-0 self-start text-right text-xs leading-5">
      <span className={`block ${showSeverity ? TEXT_TONE[tone] : "text-ink-muted"}`}>
        {statusLabel(finding.status)}
      </span>
      {showSeverity ? (
        <span className="block text-ink-muted">{severityLabel(finding.severity)}</span>
      ) : null}
    </span>
  );
}

/**
 * The rule down a row's left edge carries its severity.
 *
 * The one place colour leads: a reader scanning the list sees where the red is
 * before reading a word. Rows that passed get the rule in the paper's own
 * colour so they recede.
 */
function edgeClass(finding: Finding): string {
  return severityShown(finding)
    ? TRACK_TONE[toneForSeverity(finding.severity)]
    : "bg-rule";
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
  const ranked = rank !== undefined;

  return (
    <details className="group border-b border-rule last:border-b-0">
      <summary className="flex cursor-pointer list-none items-baseline gap-4 py-4">
        <span
          aria-hidden="true"
          className={`w-[3px] shrink-0 self-stretch rounded-full ${edgeClass(finding)}`}
        />
        {ranked ? (
          <span className="tabular display w-6 shrink-0 text-2xl leading-none text-ink-muted">
            {rank}
          </span>
        ) : null}
        <span className="flex-1 text-[0.95rem] leading-6 font-medium group-hover:underline group-hover:decoration-rule-strong group-hover:underline-offset-4">
          {title}
        </span>
        <Outcome finding={finding} />
        <Toggle />
      </summary>

      {/* Aligned with the title: past the rule, the gap and, if there is one, the rank. */}
      <div
        className={`space-y-4 pb-6 ${ranked ? "pl-[19px] sm:pl-[59px]" : "pl-[19px]"}`}
      >
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
