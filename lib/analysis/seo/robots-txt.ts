/**
 * Minimal robots.txt parsing.
 *
 * Only what the SEO checks actually need: the sitemap declarations, and
 * whether the whole site is disallowed for every crawler.
 *
 * This is deliberately **not** a full robots.txt implementation. Path matching,
 * wildcards, `Allow` precedence and crawl-delay are not modelled, because
 * nothing in V1 crawls (ADR-005) and a half-correct matcher would invite
 * callers to trust it for decisions it cannot make.
 */

/** A `User-agent` group and the directives beneath it. */
interface RobotsGroup {
  readonly agents: string[];
  readonly disallows: string[];
  readonly allows: string[];
}

export interface RobotsTxt {
  /** Sitemap URLs declared anywhere in the file, in order, deduplicated. */
  readonly sitemaps: readonly string[];
  /** True when a `User-agent: *` group disallows the entire site. */
  readonly disallowsEverything: boolean;
  /** Number of directive groups parsed. */
  readonly groupCount: number;
}

/**
 * Parse robots.txt.
 *
 * Comments, blank lines and unknown directives are ignored, matching how
 * crawlers treat a file they do not fully understand.
 */
export function parseRobotsTxt(source: string): RobotsTxt {
  const sitemaps: string[] = [];
  const seenSitemaps = new Set<string>();
  const groups: RobotsGroup[] = [];

  let current: RobotsGroup | null = null;
  // Consecutive User-agent lines share one group, so a new agent after a
  // directive starts a new group rather than joining the previous one.
  let expectingAgents = false;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line.length === 0) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    switch (field) {
      case "sitemap": {
        if (value.length > 0 && !seenSitemaps.has(value)) {
          seenSitemaps.add(value);
          sitemaps.push(value);
        }
        break;
      }

      case "user-agent": {
        if (current === null || !expectingAgents) {
          current = { agents: [], disallows: [], allows: [] };
          groups.push(current);
          expectingAgents = true;
        }
        current.agents.push(value.toLowerCase());
        break;
      }

      case "disallow": {
        if (current === null) break;
        expectingAgents = false;
        current.disallows.push(value);
        break;
      }

      case "allow": {
        if (current === null) break;
        expectingAgents = false;
        current.allows.push(value);
        break;
      }

      default:
        break;
    }
  }

  return {
    sitemaps,
    disallowsEverything: groups.some(blocksEverything),
    groupCount: groups.length,
  };
}

/**
 * Does this group shut out every crawler?
 *
 * Only the wildcard group counts: a site may legitimately block one badly
 * behaved bot without blocking search engines.
 *
 * `Disallow: /` blocks everything. An `Allow` in the same group means the block
 * is partial, so it is not reported as a total block.
 */
function blocksEverything(group: RobotsGroup): boolean {
  if (!group.agents.includes("*")) return false;
  if (group.allows.length > 0) return false;

  return group.disallows.includes("/");
}

function stripComment(line: string): string {
  const hash = line.indexOf("#");
  return hash === -1 ? line : line.slice(0, hash);
}
