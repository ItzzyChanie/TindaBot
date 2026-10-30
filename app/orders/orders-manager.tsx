"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type OrderItem = {
  qty: number;
  unit_price: number;
  offer_label: string | null;
  variants: { size: string; products: { name: string } | null } | null;
};
type Order = {
  id: number;
  customer_id: string;
  total: number;
  shipping: number;
  status: "awaiting_payment" | "paid" | "shipped";
  created_at: string;
  payment_proof: unknown[];
  customers: { name: string | null; channel: string; external_id: string } | null;
  order_items: OrderItem[];
};
type Filter = "all" | Order["status"];

const statusLabels: Record<Order["status"], string> = {
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  shipped: "Shipped",
};

function money(value: number) {
  return "₱" + Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function orderQuery() {
  return createSupabaseBrowserClient()
    .from("orders")
    .select("id, customer_id, total, shipping, status, created_at, payment_proof, customers(name, channel, external_id), order_items(qty, unit_price, offer_label, variants(size, products(name)))")
    .order("created_at", { ascending: false });
}

export function OrdersManager() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const loadOrders = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    const { data, error: loadError } = await orderQuery();
    if (loadError) setError(loadError.message);
    else {
      setOrders((data ?? []) as unknown as Order[]);
      setError("");
    }
    if (showLoading) setLoading(false);
  }, []);

  useEffect(() => {
    void loadOrders(true);
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel("seller-orders-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => void loadOrders())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => void loadOrders())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadOrders]);

  async function setStatus(order: Order, status: Order["status"]) {
    setSavingId(order.id);
    setError("");
    const { error: updateError } = await createSupabaseBrowserClient()
      .from("orders").update({ status }).eq("id", order.id);
    if (updateError) setError(updateError.message);
    else setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status } : item));
    setSavingId(null);
  }

  const visible = filter === "all" ? orders : orders.filter((order) => order.status === filter);

  return (
    <div className="page-content orders-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">SALES</p>
          <h1>Orders</h1>
          <p className="muted">Review orders and update payment or delivery status.</p>
        </div>
        <label className="order-filter">
          <span className="sr-only">Filter orders by status</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
            <option value="all">All orders</option>
            <option value="awaiting_payment">Awaiting payment</option>
            <option value="paid">Paid</option>
            <option value="shipped">Shipped</option>
          </select>
        </label>
      </div>
      {error && <p className="inbox-alert error-state" role="alert">{error}</p>}
      {loading ? (
        <p className="muted">Loading orders…</p>
      ) : visible.length === 0 ? (
        <div className="panel empty-orders">No orders in this view yet.</div>
      ) : (
        <div className="orders-list">
          {visible.map((order) => (
            <article className="panel order-card" key={order.id}>
              <header className="order-card-header">
                <div>
                  <p className="eyebrow">ORDER</p>
                  <h2>#{order.id}</h2>
                </div>
                <span className={"order-status " + order.status}>{statusLabels[order.status]}</span>
              </header>
              <div className="order-customer">
                <strong>{order.customers?.name || order.customers?.external_id || order.customer_id}</strong>
                <span className="channel-badge">{order.customers?.channel ?? "unknown"}</span>
                <time>{new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at))}</time>
              </div>
              <ul className="order-items">
                {order.order_items.map((item, index) => (
                  <li key={order.id + "-" + index}>
                    <span>{item.qty} × {item.variants?.products?.name ?? "Product"} ({item.variants?.size ?? "Size"})</span>
                    <span>{money(Number(item.unit_price) * item.qty)}</span>
                    {item.offer_label && <small>{item.offer_label}</small>}
                  </li>
                ))}
              </ul>
              <div className="order-total-row">
                <span>Shipping {money(Number(order.shipping))}</span>
                <strong>Total {money(Number(order.total))}</strong>
              </div>
              {Array.isArray(order.payment_proof) && order.payment_proof.length > 0 && (
                <p className="proof-received">Payment proof received · {order.payment_proof.length}</p>
              )}
              <div className="order-actions">
                {order.status === "awaiting_payment" && (
                  <button className="button button-primary" disabled={savingId === order.id} onClick={() => void setStatus(order, "paid")}>
                    {savingId === order.id ? "Saving…" : "Mark paid"}
                  </button>
                )}
                {order.status === "paid" && (
                  <button className="button button-primary" disabled={savingId === order.id} onClick={() => void setStatus(order, "shipped")}>
                    {savingId === order.id ? "Saving…" : "Mark shipped"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
