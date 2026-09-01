/**
 * Parsing for the header formats the security checks read.
 *
 * Minimal by intent: enough to answer the questions the checks ask, and no
 * more. A fuller CSP evaluator would need to model source expressions, hashes,
 * nonces and fallback chains, and a half-built one would invite callers to
 * trust conclusions it cannot support.
 */

/** A Content-Security-Policy, as directive name to its source list. */
export type CspDirectives = Readonly<Record<string, readonly string[]>>;

/**
 * Parse a CSP header into directives.
 *
 * Directive names are lowercased; source values keep their case, because a
 * nonce or hash is case-sensitive.
 */
export function parseCsp(header: string): CspDirectives {
  const directives: Record<string, string[]> = {};

  for (const part of header.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens[0]?.toLowerCase();
    if (name === undefined) continue;

    // A repeated directive is ignored by browsers after the first.
    if (directives[name] === undefined) directives[name] = tokens.slice(1);
  }

  return directives;
}

/**
 * The effective source list for a directive, following `default-src` fallback.
 *
 * Returns `null` when neither the directive nor a usable fallback is present.
 */
export function effectiveSources(
  directives: CspDirectives,
  directive: string,
): readonly string[] | null {
  const own = directives[directive];
  if (own !== undefined) return own;

  // frame-ancestors does not fall back to default-src; it is one of the
  // directives browsers treat as standalone.
  if (directive === "frame-ancestors") return null;

  return directives["default-src"] ?? null;
}

export interface HstsDirectives {
  /** `max-age` in seconds. `null` when absent or unparseable. */
  readonly maxAge: number | null;
  readonly includeSubDomains: boolean;
  readonly preload: boolean;
}

export function parseHsts(header: string): HstsDirectives {
  let maxAge: number | null = null;
  let includeSubDomains = false;
  let preload = false;

  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const equals = trimmed.indexOf("=");
    const key = (equals === -1 ? trimmed : trimmed.slice(0, equals)).toLowerCase();
    const value = equals === -1 ? "" : trimmed.slice(equals + 1).trim();

    if (key === "max-age") {
      const parsed = Number(value.replace(/^"|"$/g, ""));
      if (Number.isFinite(parsed) && parsed >= 0) maxAge = parsed;
    } else if (key === "includesubdomains") {
      includeSubDomains = true;
    } else if (key === "preload") {
      preload = true;
    }
  }

  return { maxAge, includeSubDomains, preload };
}
