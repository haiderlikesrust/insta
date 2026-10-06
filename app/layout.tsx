import type { Metadata } from "next";
import "./globals.css";
import "./premium.css";

export const metadata: Metadata = {
  metadataBase: new URL('https://instara.xyz'),
  title: "Instara — Their community. Their coin. Their fees.",
  description: "Launch community coins for existing Instagram accounts. Creator fees stay locked until their owner verifies and claims.",
  alternates: { canonical: '/' },
  icons: {
    icon: "/brand-logo.png",
    shortcut: "/brand-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
