/**
 * GET /api/analyze/:id — retrieve an analysis.
 *
 * A thin adapter. See `app/api/analyze/route.ts`.
 */

import { handleGetAnalysis } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return handleGetAnalysis(id);
}
