"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

const links = [
  { href: "/", label: "Overview", icon: "⌂" },
  { href: "/inbox", label: "Inbox", icon: "▤" },
  { href: "/catalog", label: "Catalog", icon: "◫" },
  { href: "/orders", label: "Orders", icon: "▣" },
  { href: "/insights", label: "Insights", icon: "▥" },
  { href: "/storefront", label: "Storefront", icon: "↗" },
  { href: "/settings", label: "Settings", icon: "⚙" },
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
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);
  const refreshUnread = useCallback(async () => {
    const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const { count, error } = await createSupabaseBrowserClient()
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("status", "needs_seller")
      .eq("is_hidden", false)
      .is("seller_read_at", null);
    if (!error && typeof count === "number") setUnreadCount(count);
  }, []);

  useEffect(() => {
    if (pathname === "/chat" || pathname === "/shop" || pathname === "/login") return;
    void refreshUnread();
    let active = true;
    let removeChannel: (() => void) | undefined;
    void import("@/lib/supabase/client").then(({ createSupabaseBrowserClient }) => {
      if (!active) return;
      const supabase = createSupabaseBrowserClient();
      const channel = supabase.channel("sidebar-unread-count")
        .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => void refreshUnread())
        .subscribe();
      removeChannel = () => { void supabase.removeChannel(channel); };
    });
    return () => { active = false; removeChannel?.(); };
  }, [refreshUnread, pathname]);

  async function signOut() {
    setSignOutError("");
    try {
      const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
      const { error } = await createSupabaseBrowserClient().auth.signOut();
      if (error) throw error;
      router.replace("/login");
      router.refresh();
    } catch {
      setSignOutError("Hindi nakapag-sign out. Pakisubukan ulit po.");
    }
  }

  if (pathname === "/login" || pathname === "/chat" || pathname === "/shop") return <>{children}</>;

  return (
    <div className="app-layout">
      <aside className={`sidebar${menuOpen ? " open" : ""}`}>
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            t
          </span>
          <span>
            Tinda<span className="brand-accent">Bot</span>
          </span>
        </Link>
        <nav className="main-nav" id="primary-navigation" aria-label="Main navigation">
          <span className="nav-label">WORKSPACE</span>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link${pathname === link.href ? " active" : ""}`}
              aria-current={pathname === link.href ? "page" : undefined}
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
          <button className="mobile-menu" aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? "×" : "☰"}
          </button>
        </header>
        {menuOpen && <button className="menu-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
        {children}
      </main>
    </div>
  );
}
