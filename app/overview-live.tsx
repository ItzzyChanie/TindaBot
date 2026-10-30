"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Activity = { id: string; conversationId: string; name: string; body: string; time: string };

function greeting(hour: number) {
  if (hour < 12) return { text: "Good morning", emoji: "☀️" };
  if (hour < 17) return { text: "Good afternoon", emoji: "☀️" };
  return { text: "Good evening", emoji: "🌙" };
}

function manilaHour(date: Date) {
  return Number(new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", hourCycle: "h23" }).format(date));
}

function ago(value: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function OverviewLive({ name, openCount, orderCount, sales, inStock, productCount, activities, children }: {
  name: string; openCount: number; orderCount: number; sales: number; inStock: number;
  productCount: number; activities: Activity[]; children: ReactNode;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    let active = true;
    let channel: { unsubscribe: () => void } | undefined;
    void import("@/lib/supabase/client").then(({ createSupabaseBrowserClient }) => {
      if (!active) return;
      const supabase = createSupabaseBrowserClient();
      channel = supabase.channel("overview-live-data")
        .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => router.refresh())
        .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => router.refresh())
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => router.refresh())
        .on("postgres_changes", { event: "*", schema: "public", table: "variants" }, () => router.refresh())
        .subscribe();
    });
    return () => { active = false; window.clearInterval(clock); channel?.unsubscribe(); };
  }, [router]);
  const salutation = greeting(manilaHour(now));
  const date = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "long", month: "long", day: "numeric" }).format(now);
  const stats = [
    { label: "Open conversations", value: String(openCount), note: "Current shop conversations" },
    { label: "Orders this week", value: String(orderCount), note: `₱${sales.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total sales` },
    { label: "Products in stock", value: String(inStock), note: `Across ${productCount} active styles` },
  ];
  return <div className="page-content">
    <div className="page-heading"><div><p className="eyebrow">{date}</p><h1>{salutation.text}, {name} <span aria-hidden="true">{salutation.emoji}</span></h1><p className="muted">Here&apos;s what&apos;s happening in your shop today.</p></div>{children}</div>
    <section className="stats-grid" aria-label="Shop summary">{stats.map((stat) => <article className="stat-card" key={stat.label}><p className="muted">{stat.label}</p><strong>{stat.value}</strong><span>{stat.note}</span></article>)}</section>
    <section className="overview-grid"><article className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">Your shop</p><h2>Recent activity</h2></div><Link className="text-button" href="/inbox">View all <span aria-hidden="true">→</span></Link></div>
      {activities.length ? activities.map((activity) => <Link className="activity-row" href={`/inbox?conversation=${encodeURIComponent(activity.conversationId)}`} key={activity.id}><span className="avatar avatar-mint" aria-hidden="true">{activity.name.slice(0, 1).toUpperCase()}</span><div><strong>{activity.name}</strong><p>{activity.body}</p></div><time dateTime={activity.time}>{ago(activity.time, now.getTime())}</time></Link>) : <p className="muted">No conversations yet.</p>}
    </article><article className="panel storefront-card"><div className="store-icon" aria-hidden="true">✳</div><p className="eyebrow">Your storefront</p><h2>Looking good, {name}!</h2><p className="muted">Your customers can browse what&apos;s available right now.</p><Link className="button button-light" href="/storefront">View storefront <span aria-hidden="true">↗</span></Link></article></section>
  </div>;
}
