/**
 * POST /api/analyze — start an analysis.
 *
 * A thin adapter. Every decision lives in `lib/api`, which knows nothing about
 * Next.js and can be driven directly by a test with a plain `Request`.
 */

import { handleCreateAnalysis } from "@/lib/api";
import { getServerEnv } from "@/lib/config/env";

/**
 * A browser is required and job state is written to disk, so this route cannot
 * be statically rendered or cached (ADR-032).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  // Whether the client address can be believed is a deployment fact, so it is
  // read here rather than guessed at in the service (ADR-061).
  return handleCreateAnalysis(request, { trustProxy: getServerEnv().trustProxy });
}
