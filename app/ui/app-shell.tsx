"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const links = [
  { href: "/", label: "Overview", icon: "⌂" },
  { href: "/inbox", label: "Inbox", icon: "▤", count: "4" },
  { href: "/catalog", label: "Catalog", icon: "◫" },
  { href: "/orders", label: "Orders", icon: "▣" },
  { href: "/insights", label: "Insights", icon: "▥" },
  { href: "/storefront", label: "Storefront", icon: "↗" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className="app-layout">
    <aside className="sidebar">
      <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">t</span><span>Tinda<span className="brand-accent">Bot</span></span></Link>
      <div className="shop-switcher"><span className="shop-avatar">M</span><span className="shop-details"><strong>Mia&apos;s Closet</strong><small>Free plan</small></span><span className="chevron">⌄</span></div>
      <nav className="main-nav" aria-label="Main navigation"><span className="nav-label">WORKSPACE</span>{links.map((link) => <Link key={link.href} href={link.href} className={`nav-link${pathname === link.href ? " active" : ""}`}><span className="nav-icon" aria-hidden="true">{link.icon}</span><span>{link.label}</span>{link.count && <span className="nav-count">{link.count}</span>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="channel-note"><span className="online-dot" />Telegram connected</div><button className="profile-button"><span className="profile-avatar">MS</span><span className="profile-details"><strong>Mia Santos</strong><small>Shop owner</small></span><span className="chevron">···</span></button></div>
    </aside>
    <main className="main-area"><header className="mobile-header"><Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">t</span><span>Tinda<span className="brand-accent">Bot</span></span></Link><button className="mobile-menu" aria-label="Menu">☰</button></header>{children}</main>
  </div>;
}
