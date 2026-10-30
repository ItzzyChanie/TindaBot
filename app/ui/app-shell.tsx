"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";

const links = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/insights", label: "Insights", icon: "insights" },
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/catalog", label: "Catalog", icon: "catalog" },
  { href: "/orders", label: "Orders", icon: "orders" },
  { href: "/storefront", label: "Storefront", icon: "storefront" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

function NavIcon({ name }: { name: (typeof links)[number]["icon"] }) {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
    insights: <><path d="M4 19V5M4 19h17" /><path d="m7 15 4-4 3 2 6-7" /></>,
    inbox: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 13h5l2 3h4l2-3h5" /></>,
    catalog: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    orders: <><path d="M6 3h12l2 4v14H4V7l2-4Z" /><path d="M4 7h16M9 11h6" /></>,
    storefront: <><path d="M3 10v10h18V10M2 4h20l-2 6H4L2 4Z" /><path d="M9 4v6m6-6v6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.8Z" transform="translate(-2 -1) scale(.95)" /></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function AppShell({ children, userEmail }: { children: ReactNode; userEmail: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const email = userEmail ?? "Seller account";
  const [signOutError, setSignOutError] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const isStandalonePage = pathname === "/chat" || pathname === "/shop" || pathname === "/login";
  const displayedPath = pendingHref ?? pathname;
  const currentPage = links.find((link) => link.href === displayedPath)?.label ?? "Workspace";
  useEffect(() => { setMenuOpen(false); setPendingHref(null); }, [pathname]);
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem("tindabot-theme", next);
    } catch {
      // Keep the selected theme for this page view if storage is unavailable.
    }
  }

  function showNavigationFeedback(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || href === pathname) return;
    setPendingHref(href);
  }

  function ThemeButton({ compact = false }: { compact?: boolean }) {
    return <button className={`theme-button${compact ? " compact" : ""}`} type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
      {!compact && <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
    </button>;
  }

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
    if (isStandalonePage) return;
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
  }, [refreshUnread, isStandalonePage]);

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

  if (isStandalonePage) return <>{children}</>;

  return (
    <div className="app-layout">
      <aside className={`sidebar${menuOpen ? " open" : ""}`}>
        <div className="sidebar-brand-block">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">t</span>
            <span>Tinda<span className="brand-accent">Bot</span></span>
          </Link>
          <div className="sidebar-store">
            <span className="shop-avatar" aria-hidden="true">T</span>
            <span className="shop-details"><strong>Your shop</strong><small>Seller workspace</small></span>
            <svg className="store-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
          </div>
        </div>
        <nav className="main-nav" id="primary-navigation" aria-label="Main navigation">
          <span className="nav-label">WORKSPACE</span>
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={(event) => showNavigationFeedback(event, link.href)} className={`nav-link${displayedPath === link.href ? " active" : ""}`} aria-current={displayedPath === link.href ? "page" : undefined}>
              <NavIcon name={link.icon} />
              <span>{link.label}</span>
              {link.href === "/inbox" && unreadCount > 0 && <span className="nav-count">{unreadCount}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="channel-note"><span className="online-dot" />Telegram connected</div>
          {signOutError && <p className="profile-error" role="alert">{signOutError}</p>}
          <div className="profile-button">
            <span className="profile-avatar">{email.slice(0, 1).toUpperCase()}</span>
            <span className="profile-details"><strong>{email}</strong><small>Shop owner</small></span>
            <button className="sign-out-button" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5M15 12H3m9-8h8a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-8" /></svg>
            </button>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb"><span>Workspace</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg><strong>{currentPage}</strong></div>
          <div className="workspace-topbar-actions"><span className="connection-pill"><span className="online-dot" />Telegram connected</span><ThemeButton /></div>
        </header>
        <header className="mobile-header">
          <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">t</span><span>Tinda<span className="brand-accent">Bot</span></span></Link>
          <ThemeButton compact />
          <button className="mobile-menu" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen((open) => !open)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">{menuOpen ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
          </button>
        </header>
        {menuOpen && <button className="menu-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
        {pendingHref ? (
          <div className="page-content route-loading" role="status" aria-label={`Loading ${currentPage}`}>
            <span className="sr-only">Loading {currentPage}…</span>
            <div className="loading-hero" />
            <div className="loading-metrics"><i /><i /><i /><i /></div>
            <div className="loading-panels"><i /><i /></div>
          </div>
        ) : children}
      </main>
    </div>
  );
}
