"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const links = [
  { href: "/", label: "Overview", icon: "⌂" },
  { href: "/inbox", label: "Inbox", icon: "▤", count: "4" },
  { href: "/catalog", label: "Catalog", icon: "◫" },
  { href: "/orders", label: "Orders", icon: "▣" },
  { href: "/insights", label: "Insights", icon: "▥" },
  { href: "/storefront", label: "Storefront", icon: "↗" },

  { href: "/settings", label: "Settings", icon: "Settings" },
];

export function AppShell({
  children,
  userEmail,
}: {
  children: ReactNode;
  userEmail: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const email = userEmail ?? "Seller account";
  const [signOutError, setSignOutError] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const refreshUnread = useCallback(async () => {
    const { count, error } = await createSupabaseBrowserClient()
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("status", "needs_seller")
      .eq("is_hidden", false)
      .is("seller_read_at", null);
    if (!error && typeof count === "number") setUnreadCount(count);
  }, []);

  useEffect(() => {
    if (pathname === "/chat" || pathname === "/login") return;
    void refreshUnread();
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel("sidebar-unread-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => void refreshUnread())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refreshUnread, pathname]);

  async function signOut() {
    setSignOutError("");
    try {
      const { error } = await createSupabaseBrowserClient().auth.signOut();
      if (error) throw error;
      router.replace("/login");
      router.refresh();
    } catch {
      setSignOutError("Hindi nakapag-sign out. Pakisubukan ulit po.");
    }
  }

  if (pathname === "/login" || pathname === "/chat") return <>{children}</>;

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            t
          </span>
          <span>
            Tinda<span className="brand-accent">Bot</span>
          </span>
        </Link>
        <div className="shop-switcher">
          <span className="shop-avatar">M</span>
          <span className="shop-details">
            <strong>Mia&apos;s Closet</strong>
            <small>Free plan</small>
          </span>
          <span className="chevron">⌄</span>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          <span className="nav-label">WORKSPACE</span>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link${pathname === link.href ? " active" : ""}`}
            >
              <span className="nav-icon" aria-hidden="true">
                {link.icon}
              </span>
              <span>{link.label}</span>
              {link.href === "/inbox" && unreadCount > 0 && (
                <span className="nav-count">{unreadCount}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="channel-note">
            <span className="online-dot" />
            Telegram connected
          </div>
          {signOutError && (
            <p className="profile-error" role="alert">
              {signOutError}
            </p>
          )}
          <div className="profile-button">
            <span className="profile-avatar">
              {email.slice(0, 1).toUpperCase()}
            </span>
            <span className="profile-details">
              <strong>{email}</strong>
              <small>Shop owner</small>
            </span>
            <button
              className="sign-out-button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
            >
              ↗
            </button>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="mobile-header">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              t
            </span>
            <span>
              Tinda<span className="brand-accent">Bot</span>
            </span>
          </Link>
          <button className="mobile-menu" aria-label="Menu">
            ☰
          </button>
        </header>
        {children}
      </main>
    </div>
  );
}
