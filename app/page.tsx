import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OverviewLive } from "./overview-live";

const SHOP_ID = "00000000-0000-4000-8000-000000000001";

export default async function OverviewPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: { user } }, conversations, openConversations, orders, products, stock] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("messages").select("id,body,created_at,conversations!inner(id,customers(name))").order("created_at", { ascending: false }).limit(5),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("is_hidden", false).neq("status", "resolved"),
    supabase.from("orders").select("id,total,created_at").gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("shop_id", SHOP_ID).eq("active", true),
    supabase.from("variants").select("stock,products!inner(shop_id,active)").eq("products.shop_id", SHOP_ID).eq("products.active", true),
  ]);
  const accountName = user?.email?.split("@")[0] ?? "Seller";
  const name = String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? accountName.charAt(0).toUpperCase() + accountName.slice(1));
  const openCount = openConversations.count ?? 0;
  const orderCount = orders.data?.length ?? 0;
  const sales = orders.data?.reduce((total, order) => total + Number(order.total), 0) ?? 0;
  const inStock = stock.data?.reduce((total, row) => total + Number(row.stock), 0) ?? 0;
  const activities = (conversations.data ?? []).map((message) => {
    const conversation = Array.isArray(message.conversations) ? message.conversations[0] : message.conversations;
    const customer = Array.isArray(conversation?.customers) ? conversation.customers[0] : conversation?.customers;
    return { id: message.id, conversationId: conversation?.id ?? message.id, name: customer?.name || "Customer", body: message.body, time: message.created_at };
  });

  return <OverviewLive name={name} openCount={openCount} orderCount={orderCount} sales={sales}
    inStock={inStock} productCount={products.count ?? 0} activities={activities}>
    <Link className="button button-primary" href="/inbox">Open inbox <span aria-hidden="true">→</span></Link>
  </OverviewLive>;
}
