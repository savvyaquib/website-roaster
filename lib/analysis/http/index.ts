/**
 * Phase 2 — Basic HTTP analyzer.
 *
 * Import from `@/lib/analysis/http`; the internal modules are implementation
 * detail.
 */

export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  fetchPage,
  type FetchPageOptions,
} from "./fetch-page";

export {
  publicHttpSecurityPolicy,
  type HttpSecurityPolicy,
} from "./policy";

export {
  BlockedAddressError,
  BLOCKED_ADDRESS_ERROR_CODE,
  createPinnedLookup,
  type AddressResolver,
} from "./pinned-lookup";

export {
  analysisStatusForHttpFailure,
  HTTP_FAILURE_CODES,
  type HttpFailure,
  type HttpFailureCode,
  type HttpFetchResult,
  type HttpHeaders,
  type HttpResponseData,
  type HttpTiming,
  type RedirectHop,
} from "./types";
