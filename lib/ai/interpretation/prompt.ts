/**
 * The instruction sent to the model.
 *
 * Source of truth: CLAUDE.md § AI RULES, docs/DECISIONS.md ADR-003, ADR-014,
 * ADR-046, ADR-055; docs/IMPLEMENTATION.md Phase 14 "AI constraints".
 *
 * ## A prompt is a request, not a control
 *
 * Everything prohibited here is also *enforced* somewhere else — by the answer
 * shape, which gives the model nowhere to put an invented severity or metric,
 * and by `verify.ts`, which refuses an answer that breaks the rules anyway.
 *
 * The prohibitions are still written out, for two reasons: Phase 14's brief
 * requires the prompt to state them, and a model told plainly what not to do
 * breaks the rules less often — which means fewer answers thrown away. But
 * nothing downstream assumes the model obeyed.
 */

/** Each prohibition, separately, so a test can assert every one is present. */
export const PROHIBITIONS: readonly string[] = [
  "Do not invent metrics. Every number you write must appear in the evidence above. If you want to say a page is slow, cite the measurement that is there; if no measurement is there, do not characterise the speed at all.",
  "Do not invent technical findings. You may only discuss findings that appear in the evidence, referenced by their exact `id`. There is no other way to raise a problem, and an id that was not supplied will be rejected.",
  "Do not make unsupported security claims. Never state or imply that this website is secure, safe, protected or free of vulnerabilities — the analysis observes configuration only and cannot establish that. Never name a vulnerability class (SQL injection, XSS, CSRF, remote code execution, data breach) unless a supplied finding names it.",
  "Do not make unsupported SEO claims. Never promise or predict a ranking, a position, traffic growth, or a result on any search engine. You may say what a change addresses; you may not say what it will achieve.",
  "Do not contradict the supplied evidence. Do not call a failing check a strength, or a passing check a problem. Do not restate a severity, category, score or measurement differently from how it is given. If your reading disagrees with the evidence, the evidence is right.",
];

/** The remaining constraints docs/IMPLEMENTATION.md Phase 14 lists. */
export const CONSTRAINTS: readonly string[] = [
  "Distinguish what was measured from what is a judgement. Each evidence item is marked `measured` or `heuristic`; treat a heuristic as a signal worth discussing, not as a fact established about the site.",
  "Prioritise. Lead with what would most change this page's usefulness to its visitors, not with whatever is easiest to describe.",
  "Keep recommendations actionable: a specific change someone could make this week, not a topic to look into.",
  "A check that could not be determined has established nothing. It is neither a problem nor a strength, and must not be presented as either.",
  "Write for the person who owns this website, not for an auditor. Plain language, no jargon where a normal word exists, no filler.",
];

/**
 * The task, and the shape of the answer.
 *
 * The response schema carries the structure, so this says what the fields are
 * *for* rather than repeating their types.
 */
const TASK = `You are reviewing one web page. A deterministic analyzer has already measured it, scored it, and produced findings; your job is to interpret that evidence for the site's owner.

You are not measuring anything. Every fact you need has been supplied. Your contribution is judgement about what matters and clear words about why.

Produce:

- **executiveSummary** — a short paragraph, at most about 80 words, saying where this page stands and what most deserves attention. No preamble, no restating the score verbatim.
- **strengths** — things this page genuinely does well. Each references a passing finding's \`id\` and says, in one or two sentences, why it helps this site. If the evidence supports none, return an empty list rather than inventing praise.
- **problems** — the highest-priority problems, most important first. Each references a failing or warning finding's \`id\`, says why it matters to this site's visitors or owner, and gives one specific recommended action.

Reference between three and eight problems where the evidence supports that many. Choose the ones that matter, not one per category.`;

export interface PromptOptions {
  /** The site's URL, so the model can write about a specific page. */
  readonly url: string;
}

/**
 * Build the system instruction.
 *
 * Deterministic: the same options always produce the same text, so a change in
 * output between two runs is the model's, not the prompt's.
 */
export function buildInterpretationPrompt(options: PromptOptions): string {
  return [
    TASK,
    `The page under review is ${options.url}.`,
    "## Rules you must not break",
    PROHIBITIONS.map((rule) => `- ${rule}`).join("\n"),
    "## How to write it",
    CONSTRAINTS.map((rule) => `- ${rule}`).join("\n"),
    "Answers that break any rule above are discarded in full, and the report is published without them. Referencing a real finding and saying something true about it is always better than reaching for something you cannot support.",
  ].join("\n\n");
}
