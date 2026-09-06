/**
 * POST /api/analyze — start an analysis.
 *
 * A thin adapter. Every decision lives in `lib/api`, which knows nothing about
 * Next.js and can be driven directly by a test with a plain `Request`.
 */

import { handleCreateAnalysis } from "@/lib/api";

/**
 * A browser is required and job state is written to disk, so this route cannot
 * be statically rendered or cached (ADR-032).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleCreateAnalysis(request);
}
