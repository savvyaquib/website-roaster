/**
 * `Set-Cookie` parsing.
 *
 * Source of truth: docs/DECISIONS.md ADR-046.
 *
 * ## The cookie value is never retained
 *
 * This parser reads a cookie's **name and attributes** and deliberately throws
 * the value away.
 *
 * A `Set-Cookie` on a real site frequently carries a live session token. This
 * analyzer's output flows into logs, an API response, a stored report and
 * eventually an AI prompt (ADR-014) — so a value captured here would end up in
 * all of them. Nothing in the security checks needs the value: whether a cookie
 * is `Secure` is a property of its attributes.
 *
 * Keeping the value out of the data structure entirely is stronger than
 * remembering to redact it later.
 */

export type SameSite = "strict" | "lax" | "none";

export interface ParsedCookie {
  /** The cookie name. The value is deliberately not captured. */
  readonly name: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  /** `null` when the attribute is absent or unrecognised. */
  readonly sameSite: SameSite | null;
  readonly path: string | null;
  readonly domain: string | null;
  /** True when `Expires` or `Max-Age` is present, i.e. not a session cookie. */
  readonly persistent: boolean;
}

const SAME_SITE_VALUES: readonly SameSite[] = ["strict", "lax", "none"];

/**
 * Parse one `Set-Cookie` header value.
 *
 * @returns the cookie, or `null` if the header has no usable name.
 */
export function parseSetCookie(header: string): ParsedCookie | null {
  const parts = header.split(";");
  const nameValue = parts[0] ?? "";

  const separator = nameValue.indexOf("=");
  if (separator === -1) return null;

  const name = nameValue.slice(0, separator).trim();
  if (name.length === 0) return null;

  let secure = false;
  let httpOnly = false;
  let sameSite: SameSite | null = null;
  let path: string | null = null;
  let domain: string | null = null;
  let persistent = false;

  for (const attribute of parts.slice(1)) {
    const trimmed = attribute.trim();
    const equals = trimmed.indexOf("=");
    // The key is trimmed separately: RFC 6265 permits whitespace around the
    // `=`, so `SameSite = Lax` is a cookie browsers honour. Matching on an
    // untrimmed key would silently miss it and report the attribute as absent.
    const key = (equals === -1 ? trimmed : trimmed.slice(0, equals)).trim().toLowerCase();
    const value = equals === -1 ? "" : trimmed.slice(equals + 1).trim();

    switch (key) {
      case "secure":
        secure = true;
        break;
      case "httponly":
        httpOnly = true;
        break;
      case "samesite": {
        const lowered = value.toLowerCase();
        sameSite = SAME_SITE_VALUES.includes(lowered as SameSite)
          ? (lowered as SameSite)
          : null;
        break;
      }
      case "path":
        path = value || null;
        break;
      case "domain":
        domain = value || null;
        break;
      case "expires":
      case "max-age":
        persistent = true;
        break;
      default:
        break;
    }
  }

  return { name, secure, httpOnly, sameSite, path, domain, persistent };
}

/** Parse every `Set-Cookie` header, dropping any that cannot be read. */
export function parseSetCookies(headers: readonly string[]): ParsedCookie[] {
  const cookies: ParsedCookie[] = [];

  for (const header of headers) {
    const parsed = parseSetCookie(header);
    if (parsed !== null) cookies.push(parsed);
  }

  return cookies;
}
