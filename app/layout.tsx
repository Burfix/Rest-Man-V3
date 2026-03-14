import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ops Engine",
  description: "Unified operations dashboard — bookings, maintenance, sales, and compliance.",
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
