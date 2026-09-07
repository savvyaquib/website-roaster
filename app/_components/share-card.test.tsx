/**
 * Share card rendering tests.
 *
 * Phase 18 asks for the card to be tested at the intended social-media
 * dimensions, so these render it for real — through the same `ImageResponse`
 * the route uses — and read the size back out of the PNG header rather than
 * trusting the width and height that were passed in.
 *
 * Set `WRITE_CARD=<path>` to also save the image, which is how it gets looked
 * at during development.
 */

import { writeFileSync } from "node:fs";
import { ImageResponse } from "next/og";
import { describe, expect, it } from "vitest";

import type { ShareCardData } from "@/lib/share/card-data";

import { CARD_HEIGHT, CARD_WIDTH, ShareCard } from "./share-card";

/** Width and height as the PNG itself declares them, from the IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  const signature = bytes.subarray(0, 8).toString("hex");

  if (signature !== "89504e470d0a1a0a") {
    throw new Error(`Not a PNG: signature was ${signature}`);
  }

  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function renderCard(data: ShareCardData): Promise<Buffer> {
  const response = new ImageResponse(<ShareCard data={data} />, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  });

  return Buffer.from(await response.arrayBuffer());
}

const complete: ShareCardData = {
  host: "example.com",
  score: 85,
  grade: "B",
  categories: [
    { label: "Search", score: 73, grade: "C" },
    { label: "Security", score: 55, grade: "F" },
    { label: "Content", score: 90, grade: "A" },
    { label: "Usability", score: 97, grade: "A" },
  ],
  hiddenCategoryCount: 0,
  roast: {
    observation: "The page was served over plain HTTP.",
    punchline: "Plain HTTP, in this decade, is period costume.",
  },
  statusNote: null,
};

describe("the card renders at social-media dimensions", () => {
  it("is a 1200x630 PNG", async () => {
    // The size every major platform crops from. Read from the file, not from
    // the arguments, so a renderer that ignored them would fail here.
    const bytes = await renderCard(complete);

    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
  });

  it("uses the 1.91:1 ratio link previews expect", () => {
    expect(CARD_WIDTH / CARD_HEIGHT).toBeCloseTo(1.905, 2);
  });

  it("produces an image with actual content in it", async () => {
    // A blank card also decodes as a valid PNG. A card with a huge numeral, a
    // rule and four coloured scores does not compress to almost nothing.
    const bytes = await renderCard(complete);

    expect(bytes.length).toBeGreaterThan(15_000);
  });

  it("saves the image when asked, for looking at", async () => {
    const target = process.env.WRITE_CARD;
    if (target === undefined) return;

    writeFileSync(target, await renderCard(complete));
  });
});

describe("it renders every state without failing", () => {
  it("renders a perfect score", async () => {
    const bytes = await renderCard({
      ...complete,
      score: 100,
      grade: "A",
      roast: null,
    });

    expect(pngSize(bytes).width).toBe(1200);
  });

  it("renders a failing score", async () => {
    const bytes = await renderCard({ ...complete, score: 12, grade: "F" });

    expect(pngSize(bytes).width).toBe(1200);
  });

  it("renders a zero, which must not be mistaken for no score", async () => {
    const bytes = await renderCard({ ...complete, score: 0, grade: "F" });

    expect(pngSize(bytes).width).toBe(1200);
  });

  it("renders an analysis that produced no score", async () => {
    const bytes = await renderCard({
      host: "example.com",
      score: null,
      grade: null,
      categories: [],
      hiddenCategoryCount: 0,
      roast: null,
      statusNote: "Address refused",
    });

    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
  });

  it("renders with no categories", async () => {
    const bytes = await renderCard({ ...complete, categories: [] });

    expect(pngSize(bytes).width).toBe(1200);
  });

  it("renders with categories it had no room for", async () => {
    const bytes = await renderCard({ ...complete, hiddenCategoryCount: 3 });

    expect(pngSize(bytes).width).toBe(1200);
  });

  it("renders a long host without breaking the layout", async () => {
    const bytes = await renderCard({
      ...complete,
      host: "an-extremely-long-subdomain.of-a-long-domain-name.example.co.uk",
    });

    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
  });

  it("renders the longest punchline the card allows", async () => {
    const bytes = await renderCard({
      ...complete,
      roast: {
        observation: "0 buttons and 0 button-styled links were found on the page at all.",
        punchline: "x".repeat(118),
      },
    });

    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
  });
});
