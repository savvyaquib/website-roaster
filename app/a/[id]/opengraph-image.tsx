/**
 * The share card for one analysis.
 *
 * Next's file convention: exporting this from a route segment makes it the
 * `og:image` and `twitter:image` for that page automatically, so there is no
 * metadata to keep in sync by hand.
 *
 * Rendered on request rather than at build time — a report does not exist until
 * somebody runs it, and the card is drawn from the stored record.
 */

import { ImageResponse } from "next/og";

import { getJobStore, isJobId } from "@/lib/jobs";
import type { AnalysisJob } from "@/lib/jobs";
import { shareCardData } from "@/lib/share/card-data";

import { CARD_HEIGHT, CARD_WIDTH, ShareCard } from "../../_components/share-card";

export const runtime = "nodejs";

/** The dimensions every major social platform crops from. */
export const size = { width: CARD_WIDTH, height: CARD_HEIGHT };
export const contentType = "image/png";
export const alt = "Website Roaster analysis result";

async function loadJob(id: string): Promise<AnalysisJob | null> {
  if (!isJobId(id)) return null;

  try {
    return await getJobStore().get(id);
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await loadJob(id);

  // A card is still drawn for a link that leads nowhere. A social platform that
  // fetches this will not retry, so returning nothing would leave a broken
  // preview attached to the link permanently.
  const data =
    job === null
      ? {
          host: "Website Roaster",
          score: null,
          grade: null,
          categories: [],
          hiddenCategoryCount: 0,
          roast: null,
          statusNote: "Not found",
        }
      : shareCardData(job);

  return new ImageResponse(<ShareCard data={data} />, size);
}
