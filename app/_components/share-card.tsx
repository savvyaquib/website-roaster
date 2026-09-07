/**
 * The share card.
 *
 * Source of truth: docs/IMPLEMENTATION.md Phase 18, ADR-059.
 *
 * Drawn by Satori through `next/og`, which is not a browser: no CSS variables,
 * no Tailwind, no grid, and every element holding more than one child needs an
 * explicit `display: flex`. Colours are therefore literal hex — the same values
 * `app/globals.css` defines for light mode — and the layout is flexbox only.
 *
 * ## Reading order
 *
 * Site, then score, then joke. Somebody scrolling past a link preview asks
 * "which site?" before "how did it do?", so the host leads even though the
 * numeral is the larger thing on the page.
 *
 * ## One typeface
 *
 * The interface pairs Plex Sans with Plex Mono. Satori needs font *data*, not a
 * CSS family, and the only fonts on disk here are hashed woff2 build artifacts
 * that change every build. Rather than fetch a font over the network while
 * rendering a share image — a request that can fail and would make the card
 * non-deterministic — the card uses the renderer's built-in face and builds
 * hierarchy from size, weight and colour instead.
 *
 * ## What it leaves out
 *
 * Phase 18 says not to make the card information-dense, so it carries five
 * things and nothing else: the site, the score, four category scores, one roast
 * line, and the product's name. No findings, no recommendations, no evidence.
 * The card is an invitation to the report, not a summary of it.
 */

import type { ShareCardData } from "@/lib/share/card-data";
import { toneForScore } from "@/lib/ui/format";
import type { Tone } from "@/lib/ui/format";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** The light-mode tokens from `app/globals.css`, as literals Satori can read. */
const COLOR = {
  paper: "#EDF0F2",
  ink: "#0F1720",
  inkMuted: "#55616E",
  rule: "#CFD7DE",
  good: "#1B6B47",
  fair: "#7D5A10",
  poor: "#9E2F26",
  unknown: "#64707D",
} as const;

const TONE_COLOR: Readonly<Record<Tone, string>> = {
  good: COLOR.good,
  fair: COLOR.fair,
  poor: COLOR.poor,
  unknown: COLOR.unknown,
};

/**
 * The score scale, in miniature.
 *
 * The report's signature element: the bar with the grade boundaries marked on
 * it. Keeping it here means a shared card is recognisably from the same product
 * as the page it links to.
 */
function Scale({ score, color }: { score: number; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: 300,
        height: 14,
        backgroundColor: COLOR.rule,
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          width: `${Math.max(score, 1)}%`,
          height: "100%",
          backgroundColor: color,
        }}
      />
      {[60, 70, 80, 90].map((mark) => (
        <div
          key={mark}
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${mark}%`,
            width: 2,
            backgroundColor: COLOR.paper,
          }}
        />
      ))}
    </div>
  );
}

export function ShareCard({ data }: { data: ShareCardData }) {
  const scoreColor = TONE_COLOR[toneForScore(data.score)];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: COLOR.paper,
        color: COLOR.ink,
        padding: 60,
      }}
    >
      {/* Which site, and whose product this is. */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          borderBottom: `2px solid ${COLOR.rule}`,
          paddingBottom: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 44,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {data.host}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            fontWeight: 600,
            color: COLOR.inkMuted,
            whiteSpace: "nowrap",
            flexShrink: 0,
            marginLeft: 32,
          }}
        >
          Website Roaster
        </div>
      </div>

      {/* How it did, and the line worth quoting. */}
      <div style={{ display: "flex", flexDirection: "row", flex: 1, paddingTop: 44 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 360,
            paddingRight: 48,
          }}
        >
          {data.score === null ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 64,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  color: COLOR.unknown,
                }}
              >
                {data.statusNote ?? "No score"}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 26,
                  color: COLOR.inkMuted,
                  marginTop: 16,
                }}
              >
                Nothing was measured
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: 180,
                    lineHeight: 0.8,
                    fontWeight: 700,
                    letterSpacing: "-0.05em",
                    color: scoreColor,
                  }}
                >
                  {data.score}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 60,
                    fontWeight: 700,
                    color: scoreColor,
                    marginLeft: 18,
                    marginBottom: 6,
                  }}
                >
                  {data.grade}
                </div>
              </div>

              <div style={{ display: "flex", marginTop: 28 }}>
                <Scale score={data.score} color={scoreColor} />
              </div>

              <div
                style={{
                  display: "flex",
                  fontSize: 24,
                  color: COLOR.inkMuted,
                  marginTop: 14,
                }}
              >
                out of 100
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            paddingLeft: 48,
            borderLeft: `2px solid ${COLOR.rule}`,
          }}
        >
          {data.roast === null ? (
            <div
              style={{
                display: "flex",
                fontSize: 38,
                lineHeight: 1.35,
                color: COLOR.inkMuted,
              }}
            >
              Nothing here to roast.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 23,
                  lineHeight: 1.4,
                  color: COLOR.inkMuted,
                  marginBottom: 18,
                }}
              >
                {data.roast.observation}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 44,
                  lineHeight: 1.3,
                  fontWeight: 600,
                }}
              >
                {data.roast.punchline}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Enough of the breakdown to be interesting, not enough to be a report. */}
      {data.categories.length === 0 ? null : (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            borderTop: `2px solid ${COLOR.rule}`,
            paddingTop: 26,
            marginTop: 12,
          }}
        >
          {data.categories.map((category) => (
            <div
              key={category.label}
              style={{
                display: "flex",
                flexDirection: "row",
                marginRight: 36,
                fontSize: 27,
              }}
            >
              <div style={{ display: "flex", color: COLOR.inkMuted }}>
                {category.label}
              </div>
              <div
                style={{
                  display: "flex",
                  marginLeft: 10,
                  fontWeight: 600,
                  color: TONE_COLOR[toneForScore(category.score)],
                }}
              >
                {category.score}
              </div>
            </div>
          ))}
          {data.hiddenCategoryCount === 0 ? null : (
            <div style={{ display: "flex", fontSize: 27, color: COLOR.inkMuted }}>
              +{data.hiddenCategoryCount} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
