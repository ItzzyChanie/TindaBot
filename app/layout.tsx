import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./ui/app-shell";

export const metadata: Metadata = {
  title: "TindaBot | Seller workspace",
  description: "Manage your shop conversations, catalog, and orders in one place.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
