import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:5173";
  const protocol = host.includes("localhost") || host.startsWith("127.") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "Line / Atlas — Learn galaxy spectra by sight",
    description:
      "An interactive field guide to 160 real SDSS galaxy spectra, built for visual transfer to 4MOST.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
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
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

