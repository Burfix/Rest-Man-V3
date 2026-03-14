import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Si Cantina Sociale — Concierge",
  description: "Staff dashboard and AI booking concierge for Si Cantina Sociale, V&A Waterfront",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
