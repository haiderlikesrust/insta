import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fanfare — Their community. Their coin. Their fees.",
  description: "Launch community coins with creator fees locked to existing, verified Instagram accounts.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/fanfare-logo.png",
    shortcut: "/fanfare-logo.png",
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
