import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OverviewLive } from "./overview-live";

export default async function OverviewPage() {
  const supabase = await createSupabaseServerClient();
  const todayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const part = (type: "year" | "month" | "day") =>
    Number(todayParts.find((item) => item.type === type)?.value);
  const sevenDayStart = new Date(
    Date.UTC(part("year"), part("month") - 1, part("day") - 6) -
      8 * 60 * 60 * 1000,
  ).toISOString();
  const manilaToday = `${part("year")}-${String(part("month")).padStart(2, "0")}-${String(part("day")).padStart(2, "0")}`;
  const weekStart = new Date(Date.UTC(part("year"), part("month") - 1, part("day") - 6)).toISOString().slice(0, 10);
  const [
    { data: { user } },
    { data: metricsData, error: metricsError },
    { data: salesData, error: salesError },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("get_overview_metrics", { p_since: sevenDayStart }),
    supabase.rpc("get_sales_performance", { p_start: weekStart, p_end: manilaToday }),
  ]);
  if (metricsError) throw metricsError;
  if (salesError) throw salesError;
  const metrics = metricsData as {
    open_count: number;
    needs_seller: number;
    order_count: number;
    sales: number;
    product_count: number;
    in_stock: number;
    sales_trend: { label: string; dateKey: string; total: number }[];
    activities: { id: string; conversationId: string; name: string; body: string; time: string }[];
  };
  const accountName = user?.email?.split("@")[0] ?? "Seller";
  const name = String(
    user?.user_metadata?.full_name ??
      user?.user_metadata?.name ??
      accountName.charAt(0).toUpperCase() + accountName.slice(1),
  );
  const salesPerformance = salesData as { sales: number; order_count: number; average_order: number; previous_sales: number; previous_order_count: number; trend: { label: string; dateKey: string; total: number }[]; top_products: { name: string; quantity: number; revenue: number }[] };
  return (
    <OverviewLive
      name={name}
      openCount={Number(metrics.open_count)}
      needsSeller={Number(metrics.needs_seller)}
      salesTrend={salesPerformance.trend}
      initialPerformance={salesPerformance}
      inStock={Number(metrics.in_stock)}
      productCount={Number(metrics.product_count)}
      activities={metrics.activities}
    >
      <div className="overview-hero-actions">
        <Link className="button button-hero-primary" href="/inbox">
          Open inbox <span aria-hidden="true">→</span>
        </Link>
        <Link className="button button-hero-secondary" href="/catalog">
          Manage catalog
        </Link>
      </div>
    </OverviewLive>
  );
}
