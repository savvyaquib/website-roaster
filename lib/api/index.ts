/**
 * Phase 16 — the analysis API.
 *
 * Import from `@/lib/api`. The route files under `app/api` are thin adapters
 * over these functions and contain no decisions of their own.
 */

export {
  handleCreateAnalysis,
  handleGetAnalysis,
  MAX_BODY_BYTES,
  type AnalysisApiDeps,
} from "./analysis-service";

export { toAnalysisJobDto, type AnalysisJobDto } from "./analysis-dto";

export {
  API_ERROR_CODES,
  apiError,
  INTERNAL_ERROR_MESSAGE,
  STATUS_FOR_CODE,
  type ApiErrorBody,
  type ApiErrorCode,
} from "./errors";
