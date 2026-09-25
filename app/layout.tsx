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

// Metadata is a Next.js feature that lets you define HTML meta tags
// for SEO, like <title> and <meta name="description">.
// These are applied to all pages that use this layout.
export const metadata: Metadata = {
  title: "Website Roaster",
  description:
    "Analyze a public web page and get an evidence-backed report: what was measured, what it scored, and what to do about it.",
};

// RootLayout is the outermost layout component in the Next.js App Router.
// It wraps around every single page in your application.
// The `children` prop represents the specific page component being rendered.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The <html> and <body> tags are required in the RootLayout.
    <html
      lang="en"
      // Inject the CSS variables from our Google Fonts setup above
      className={`${playfair.variable} ${poppins.variable} h-full antialiased`}
    >
      <body className="font-sans flex min-h-full flex-col">
        {/* Render the current page content here */}
        {children}
      </body>
    </html>
  );
}
