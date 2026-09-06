/**
 * The roast instruction.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 15, ADR-015, ADR-056.
 *
 * The model is handed a short list of real problems, each with the observation
 * already written, and asked for one punchline per problem. It chooses nothing
 * and states nothing — which is what stops a roast reaching for a funnier
 * problem than the ones actually found.
 */

/** The tone rules, separately, so a test can assert each is present. */
export const ROAST_RULES: readonly string[] = [
  "Write one punchline per finding, in the order given. Do not add findings, drop findings, or reorder them.",
  "The observation is already written and will be shown above your line. Do not repeat it, rephrase it, or state any fact of your own — your line is the joke about a fact the reader has just read.",
  "Do not invent problems. You have the complete list; there is nothing else wrong with this page that you know about.",
  "Do not state any number, measurement, size, duration or percentage. If a number matters, it is already in the observation.",
  "Never claim the site is secure, safe or vulnerable, and never promise a search ranking. Neither is something anybody here can know.",
  "Roast the website, never the person who made it. No insults aimed at anyone, no assumptions about who they are, nothing cruel. Aim at the decision, not the decider.",
  "Keep each line short — one or two sentences, under about thirty words. A roast that needs a paragraph is not a roast.",
  "Be specific enough that the line could only be about this problem. A joke that would fit any website is not worth printing.",
  "Be funny, but stay useful: after reading it, the owner should understand what is wrong and want to fix it.",
];

const TASK = `You are writing a short, sharp roast of one web page.

A deterministic analyzer has already found the problems and written the factual observation for each one. Your only job is the punchline: the line that follows the observation and makes the point land.

Format, for each finding:

\`\`\`text
<observation — already written, shown to the reader>

<your punchline>
\`\`\`

Aim for dry, specific and quotable. The best line here is one the owner would screenshot and send to a colleague, then go and fix.`;

export interface RoastPromptOptions {
  readonly url: string;
}

/** Build the system instruction. Deterministic. */
export function buildRoastPrompt(options: RoastPromptOptions): string {
  return [
    TASK,
    `The page under review is ${options.url}.`,
    "## Rules",
    ROAST_RULES.map((rule) => `- ${rule}`).join("\n"),
    "A roast that breaks any of these is discarded in full and replaced with a pre-written one, so there is nothing to gain from stretching.",
  ].join("\n\n");
}
