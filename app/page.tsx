import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OverviewLive } from "./overview-live";

const SHOP_ID = "00000000-0000-4000-8000-000000000001";

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
  const [
    {
      data: { user },
    },
    conversations,
    openConversations,
    sellerConversations,
    orders,
    products,
    stock,
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("messages")
      .select("id,body,created_at,conversations!inner(id,customers(name))")
      .eq("sender", "customer")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("is_hidden", false)
      .neq("status", "resolved"),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("is_hidden", false)
      .eq("status", "needs_seller"),
    supabase
      .from("orders")
      .select("id,total,created_at")
      .in("status", ["paid", "shipped"])
      .gte("created_at", sevenDayStart),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", SHOP_ID)
      .eq("active", true),
    supabase
      .from("variants")
      .select("stock,products!inner(shop_id,active)")
      .eq("products.shop_id", SHOP_ID)
      .eq("products.active", true),
  ]);
  const accountName = user?.email?.split("@")[0] ?? "Seller";
  const name = String(
    user?.user_metadata?.full_name ??
      user?.user_metadata?.name ??
      accountName.charAt(0).toUpperCase() + accountName.slice(1),
  );
  const openCount = openConversations.count ?? 0;
  const needsSeller = sellerConversations.count ?? 0;
  const orderCount = orders.data?.length ?? 0;
  const sales =
    orders.data?.reduce((total, order) => total + Number(order.total), 0) ?? 0;
  const manilaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const weekday = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
  });
  const salesByDate = new Map<string, number>();
  for (const order of orders.data ?? []) {
    const date = manilaDate.format(new Date(order.created_at));
    salesByDate.set(date, (salesByDate.get(date) ?? 0) + Number(order.total));
  }
  const salesTrend = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(Date.now() - (6 - index) * 86400000);
    const dateKey = manilaDate.format(day);
    return {
      label: weekday.format(day),
      dateKey,
      total: salesByDate.get(dateKey) ?? 0,
    };
  });
  const inStock =
    stock.data?.reduce((total, row) => total + Number(row.stock), 0) ?? 0;
  const activities = (conversations.data ?? []).map((message) => {
    const conversation = Array.isArray(message.conversations)
      ? message.conversations[0]
      : message.conversations;
    const customer = Array.isArray(conversation?.customers)
      ? conversation.customers[0]
      : conversation?.customers;
    return {
      id: message.id,
      conversationId: conversation?.id ?? message.id,
      name: customer?.name || "Customer",
      body: message.body,
      time: message.created_at,
    };
  });

  return (
    <OverviewLive
      name={name}
      openCount={openCount}
      needsSeller={needsSeller}
      orderCount={orderCount}
      sales={sales}
      salesTrend={salesTrend}
      inStock={inStock}
      productCount={products.count ?? 0}
      activities={activities}
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
