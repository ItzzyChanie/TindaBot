"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Activity = {
  id: string;
  conversationId: string;
  name: string;
  body: string;
  time: string;
};
type SalesDay = { label: string; dateKey: string; total: number };

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function manilaHour(date: Date) {
  return Number(
    new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      hourCycle: "h23",
    }).format(date),
  );
}

function ago(value: string, now: number) {
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(value).getTime()) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function money(value: number) {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function OverviewLive({
  name,
  openCount,
  needsSeller,
  orderCount,
  sales,
  salesTrend,
  inStock,
  productCount,
  activities,
  children,
}: {
  name: string;
  openCount: number;
  needsSeller: number;
  orderCount: number;
  sales: number;
  inStock: number;
  salesTrend: SalesDay[];
  productCount: number;
  activities: Activity[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const refreshTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    let active = true;
    let channel: { unsubscribe: () => void } | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer.current !== undefined)
        window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => router.refresh(), 450);
    };
    void import("@/lib/supabase/client").then(
      ({ createSupabaseBrowserClient }) => {
        if (!active) return;
        const supabase = createSupabaseBrowserClient();
        channel = supabase
          .channel("overview-live-data")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "conversations" },
            scheduleRefresh,
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "messages" },
            scheduleRefresh,
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "orders" },
            scheduleRefresh,
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "variants" },
            scheduleRefresh,
          )
          .subscribe();
      },
    );
    return () => {
      active = false;
      window.clearInterval(clock);
      if (refreshTimer.current !== undefined)
        window.clearTimeout(refreshTimer.current);
      channel?.unsubscribe();
    };
  }, [router]);
  const salutation = greeting(manilaHour(now));
  const date = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
  const maxSales = Math.max(0, ...salesTrend.map((day) => day.total));
  const stats = [
    {
      label: "Open conversations",
      value: String(openCount),
      note: "Current shop conversations",
      href: "/inbox",
    },
    {
      label: "Needs your reply",
      value: String(needsSeller),
      note: "Waiting for seller follow-up",
      href: "/inbox",
    },
    {
      label: "Paid orders · 7 days",
      value: String(orderCount),
      note: `${money(sales)} collected`,
      href: "/orders",
    },
    {
      label: "Active products",
      value: String(productCount),
      note: `${inStock} units across available sizes`,
      href: "/catalog",
    },
  ];
  return (
    <div className="page-content dashboard-content">
      <section className="overview-hero">
        <div className="overview-hero-copy">
          <p className="overview-kicker">
            {date} <span>·</span> SHOP OVERVIEW
          </p>
          <h1>
            {salutation}, {name}
          </h1>
          <p>
            Here’s your shop at a glance. Pick up where your customers need you.
          </p>
        </div>
        {children}
      </section>
      <section className="stats-grid dashboard-stats" aria-label="Shop summary">
        {stats.map((stat, index) => (
          <Link
            className={`stat-card overview-stat metric-${index + 1}`}
            href={stat.href}
            key={stat.label}
          >
            <span className="metric-label">{stat.label}</span>
            <strong>{stat.value}</strong>
            <span className="metric-note">{stat.note}</span>
          </Link>
        ))}
      </section>
      <section className="overview-grid dashboard-content-grid">
        <article
          className="panel sales-trend-panel"
          aria-label="Paid sales over the last seven days"
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LAST 7 DAYS</p>
              <h2>Sales performance</h2>
            </div>
            <span className="sales-total">
              <small>Total collected</small>
              <strong>{money(sales)}</strong>
            </span>
          </div>
          {maxSales === 0 && (
            <p className="muted sales-empty-note">
              Paid sales will appear here after an order is marked paid or
              shipped.
            </p>
          )}
          <div
            className="sales-bars"
            role="group"
            aria-label="Daily paid sales in Philippine pesos"
          >
            {salesTrend.map((day) => (
              <div
                className="sales-day"
                key={day.dateKey}
                role="img"
                aria-label={`${day.dateKey}: ${money(day.total)} paid sales`}
              >
                <span className="sales-day-amount">
                  {day.total > 0 ? money(day.total) : "—"}
                </span>
                <span className="sales-day-track">
                  <span
                    className="sales-day-bar"
                    style={{
                      height: `${maxSales ? Math.max(3, (day.total / maxSales) * 100) : 0}%`,
                    }}
                  />
                </span>
                <span className="sales-day-label">{day.label}</span>
              </div>
            ))}
          </div>
        </article>
        <article className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">INBOX</p>
              <h2>Recent customer messages</h2>
            </div>
            <Link className="text-button" href="/inbox">
              View inbox <span aria-hidden="true">→</span>
            </Link>
          </div>
          {activities.length ? (
            activities.map((activity) => (
              <Link
                className="activity-row"
                href={`/inbox?conversation=${encodeURIComponent(activity.conversationId)}`}
                key={activity.id}
              >
                <span className="avatar avatar-mint" aria-hidden="true">
                  {activity.name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{activity.name}</strong>
                  <p>{activity.body}</p>
                </div>
                <time dateTime={activity.time}>
                  {ago(activity.time, now.getTime())}
                </time>
              </Link>
            ))
          ) : (
            <p className="muted dashboard-empty">
              New customer messages will appear here.
            </p>
          )}
        </article>
      </section>
      <section className="dashboard-shortcuts" aria-label="Shop shortcuts">
        <Link className="shortcut-card" href="/catalog">
          <span className="shortcut-icon catalog-shortcut" aria-hidden="true">
            <NavShortcutIcon kind="catalog" />
          </span>
          <span>
            <strong>Manage catalog</strong>
            <small>Products, sizes, and stock</small>
          </span>
          <span className="shortcut-arrow" aria-hidden="true">
            ↗
          </span>
        </Link>
        <Link className="shortcut-card" href="/orders">
          <span className="shortcut-icon orders-shortcut" aria-hidden="true">
            <NavShortcutIcon kind="orders" />
          </span>
          <span>
            <strong>Review orders</strong>
            <small>Payment and delivery status</small>
          </span>
          <span className="shortcut-arrow" aria-hidden="true">
            ↗
          </span>
        </Link>
        <Link className="shortcut-card" href="/storefront">
          <span className="shortcut-icon store-shortcut" aria-hidden="true">
            <NavShortcutIcon kind="store" />
          </span>
          <span>
            <strong>Open storefront</strong>
            <small>Preview the live customer shop</small>
          </span>
          <span className="shortcut-arrow" aria-hidden="true">
            ↗
          </span>
        </Link>
      </section>
    </div>
  );
}

function NavShortcutIcon({ kind }: { kind: "catalog" | "orders" | "store" }) {
  const content = {
    catalog: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5" />
      </>
    ),
    orders: (
      <>
        <path d="M6 3h12l2 4v14H4V7l2-4Z" />
        <path d="M4 7h16M9 11h6" />
      </>
    ),
    store: (
      <>
        <path d="M3 10v10h18V10M2 4h20l-2 6H4L2 4Z" />
        <path d="M9 20v-6h6v6" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {content[kind]}
    </svg>
  );
}
