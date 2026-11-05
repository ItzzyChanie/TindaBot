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
type Performance = { sales: number; order_count: number; average_order: number; previous_sales: number; previous_order_count: number; trend: SalesDay[]; top_products: { name: string; quantity: number; revenue: number }[] };

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
  salesTrend,
  initialPerformance,
  inStock,
  productCount,
  activities,
  children,
}: {
  name: string;
  openCount: number;
  needsSeller: number;
  inStock: number;
  salesTrend: SalesDay[];
  initialPerformance: Performance;
  productCount: number;
  activities: Activity[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [range, setRange] = useState<"week" | "month" | "all">("week");
  const [performance, setPerformance] = useState(initialPerformance);
  const [performanceLoading, setPerformanceLoading] = useState(false);
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
  useEffect(() => {
    if (range === "week") { setPerformance(initialPerformance); return; }
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    const end = [part("year"), String(part("month")).padStart(2, "0"), String(part("day")).padStart(2, "0")].join("-");
    const start = range === "month" ? new Date(Date.UTC(part("year"), part("month") - 1, part("day") - 29)).toISOString().slice(0, 10) : "2000-01-01";
    let active = true;
    setPerformanceLoading(true);
    void import("@/lib/supabase/client").then(({ createSupabaseBrowserClient }) => createSupabaseBrowserClient().rpc("get_sales_performance", { p_start: start, p_end: end })).then(({ data, error }) => {
      if (!active) return;
      if (!error && data) setPerformance(data as Performance);
      setPerformanceLoading(false);
    });
    return () => { active = false; };
  }, [range, initialPerformance]);
  const salutation = greeting(manilaHour(now));
  const date = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
  const activeTrend = performance.trend ?? salesTrend;
  const maxSales = Math.max(0, ...activeTrend.map((day) => day.total));
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
      label: `Paid orders · ${range === "week" ? "7 days" : range === "month" ? "30 days" : "all time"}`,
      value: String(performance.order_count),
      note: `${money(performance.sales)} collected`,
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
          aria-label="Paid sales performance"
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SALES PERFORMANCE</p>
              <h2>Sales performance</h2>
              <p className="muted">{money(performance.sales)} collected · {performance.order_count} orders · average {money(performance.average_order)}</p>
            </div>
            <span className="sales-total">
              <small>Total collected</small>
              <strong>{money(performance.sales)}</strong>
            </span>
          </div>
          <label className="sales-range-select">Period
            <select value={range} onChange={(event) => setRange(event.target.value as typeof range)}>
              <option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="all">All time</option>
            </select>
          </label>
          <p className="sales-comparison">{money(Math.abs(performance.sales - performance.previous_sales))} {performance.sales >= performance.previous_sales ? "more" : "less"} than previous period ({money(performance.previous_sales)} · {performance.previous_order_count} orders){performanceLoading ? " · Updating…" : ""}</p>
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
            {activeTrend.map((day) => (
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
          <div className="top-products"><strong>Top products</strong>{performance.top_products?.length ? performance.top_products.map((product) => <span key={product.name}>{product.name} · {product.quantity} sold · {money(product.revenue)}</span>) : <span className="muted">No collected sales in this period.</span>}</div>
        </article>
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
          <Link className="shortcut-card" href="/shop" target="_blank" rel="noopener noreferrer">
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
