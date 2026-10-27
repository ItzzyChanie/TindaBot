import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./ui/app-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabasePublicConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "TindaBot | Seller workspace",
  description:
    "Manage your shop conversations, catalog, and orders in one place.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let email: string | null = null;
  if (isSupabasePublicConfigured()) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    email = user?.email ?? null;
  }

  return (
    <html lang="en">
      <body>
        <AppShell userEmail={email}>{children}</AppShell>
      </body>
    </html>
  );
}
