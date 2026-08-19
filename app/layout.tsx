import type { Metadata } from "next";
import { Almarai, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

// App-wide default sans. Almarai ships 300/400/700/800 — there is no 500, so
// `font-medium` resolves to the nearest available weight.
const almarai = Almarai({
  variable: "--font-almarai",
  weight: ["300", "400", "700", "800"],
  subsets: ["latin"],
});

// Italic only — it exists purely for the accent clause in the About section.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: "italic",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vela — an agent for your inbox and calendar",
  description:
    "Vela reads every thread, holds every commitment, and finds the meeting slot that actually works. Embeddings run locally. Nothing sends without your say-so.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${almarai.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
