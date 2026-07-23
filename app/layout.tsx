import type { Metadata } from "next";
import "./globals.css";

const origin = "https://ajdev-astro.github.io/galaxy-line-atlas";

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: "Line / Atlas — Learn galaxy spectra by sight",
  description:
    "An interactive field guide to 160 real SDSS galaxy spectra, built for visual transfer to 4MOST.",
  icons: {
    icon: `${origin}/favicon.svg`,
    shortcut: `${origin}/favicon.svg`,
  },
  openGraph: {
    title: "Line / Atlas",
    description: "Learn galaxy spectra by sight.",
    images: [{ url: `${origin}/og.png`, width: 1731, height: 909 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Line / Atlas",
    description: "Learn galaxy spectra by sight.",
    images: [`${origin}/og.png`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
