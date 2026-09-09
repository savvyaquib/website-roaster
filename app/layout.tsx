import type { Metadata } from "next";
import { Playfair_Display, Poppins } from "next/font/google";
import "./globals.css";

/**
 * Two families, two jobs.
 *
 * Playfair Display carries **judgement**: the score, the section headings, the
 * roast. Poppins carries **measurement**: evidence, labels, identifiers, every
 * number that came from the page. The split is the design — a reader can tell
 * at a glance whether they are looking at a verdict or at a fact.
 */
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Website Roaster",
  description:
    "Analyze a public web page and get an evidence-backed report: what was measured, what it scored, and what to do about it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${poppins.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
