"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type OrderItem = {
  qty: number;
  unit_price: number;
  offer_label: string | null;
  color: string | null;
  variants: { size: string; products: { name: string } | null } | null;
};
type Order = {
  id: number;
  customer_id: string;
  total: number;
  shipping: number;
  status: "awaiting_payment" | "paid" | "shipped" | "expired";
  created_at: string;
  expires_at: string;
  hidden_at: string | null;
  payment_proof: unknown[];
  customer_full_name: string | null;
  customer_address: string | null;
  customer_mobile: string | null;
  customer_email: string | null;
  customer_notes: string | null;
  customers: { name: string | null; channel: string; external_id: string } | null;
  order_items: OrderItem[];
};
type Filter = "all" | Order["status"];
type DateFilter = "all" | "7" | "30";
const PAGE_SIZE = 20;
type OrderView = "active" | "hidden";
function dateSince(days: DateFilter) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  const day = new Date(Date.UTC(part("year"), part("month") - 1, part("day") - (Number(days) - 1)));
  return `${day.toISOString().slice(0, 10)}T00:00:00+08:00`;
}

const statusLabels: Record<Order["status"], string> = {
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  shipped: "Shipped",
  expired: "Expired",
};

function money(value: number) {
  return "₱" + Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ORDER_SELECT = "id, customer_id, total, shipping, status, created_at, expires_at, hidden_at, payment_proof, customer_full_name, customer_address, customer_mobile, customer_email, customer_notes, customers(name, channel, external_id), order_items(qty, unit_price, offer_label, color, variants(size, products(name)))";

export function OrdersManager() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<OrderView>("active");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const refreshTimer = useRef<number | undefined>(undefined);

  const loadOrders = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    const supabase = createSupabaseBrowserClient();
    let customerIds: string[] | null = null;
    const term = search.trim().replace(/[%,()]/g, "");
    if (term && !/^\d+$/.test(term)) {
      const { data: customers, error: customerError } = await supabase.from("customers").select("id").or(`name.ilike.%${term}%,external_id.ilike.%${term}%`).limit(500);
      if (customerError) { setError(customerError.message); if (showLoading) setLoading(false); return; }
      customerIds = (customers ?? []).map((customer: { id: string }) => customer.id);
    }
    let query = supabase.from("orders").select(ORDER_SELECT, { count: "exact" }).order("created_at", { ascending: false });
    query = view === "hidden" ? query.not("hidden_at", "is", null) : query.is("hidden_at", null);
    if (filter !== "all") query = query.eq("status", filter);
    if (dateFilter !== "all") {
      query = query.gte("created_at", dateSince(dateFilter));
    }
    if (term) query = /^\d+$/.test(term) ? query.eq("id", Number(term)) : customerIds?.length ? query.in("customer_id", customerIds) : query.eq("id", -1);
    const { data, error: loadError, count } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    setTotalCount(count ?? 0);
    if (loadError) setError(loadError.message);
    else {
      setOrders((data ?? []) as unknown as Order[]);
      setError("");
    }
    if (showLoading) setLoading(false);
  }, [filter, view, dateFilter, search, page]);

  useEffect(() => {
    void loadOrders(true);
    const supabase = createSupabaseBrowserClient();
    const scheduleRefresh = () => {
      if (refreshTimer.current !== undefined) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => void loadOrders(), 300);
    };
    const channel = supabase.channel("seller-orders-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, scheduleRefresh)
      .subscribe();
    return () => {
      if (refreshTimer.current !== undefined) window.clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [loadOrders]);

  async function setStatus(order: Order, status: Order["status"]) {
    setSavingId(order.id);
    setError("");
    const { data: statusUpdated, error: updateError } = await createSupabaseBrowserClient()
      .rpc("set_order_status", { p_order_id: order.id, p_status: status });
    if (updateError) setError(updateError.message);
    else if (statusUpdated !== true) setError("Could not update this order status.");
    else setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status } : item));
    setSavingId(null);
  }

  async function setHidden(order: Order, hidden: boolean) {
    setSavingId(order.id);
    setError("");
    const { data, error: actionError } = await createSupabaseBrowserClient()
      .rpc("set_order_hidden", { p_order_id: order.id, p_hidden: hidden });
    if (actionError) setError(actionError.message);
    else if (data !== true) setError("Could not update this order.");
    else await loadOrders();
    setSavingId(null);
  }

  async function deleteOrder(order: Order) {
    if (!window.confirm(`Permanently delete order #${order.id}? This cannot be undone.`)) return;
    setSavingId(order.id);
    setError("");
    const { data, error: actionError } = await createSupabaseBrowserClient()
      .rpc("delete_order", { p_order_id: order.id });
    if (actionError) setError(actionError.message);
    else if (data !== true) setError("Could not delete this order.");
    else await loadOrders();
    setSavingId(null);
  }

  const visible = orders;

  async function exportCsv() {
    setExporting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const term = search.trim().replace(/[%,()]/g, "");
      let customerIds: string[] | null = null;
      if (term && !/^\d+$/.test(term)) {
        const { data } = await supabase.from("customers").select("id").or(`name.ilike.%${term}%,external_id.ilike.%${term}%`).limit(500);
        customerIds = (data ?? []).map((customer: { id: string }) => customer.id);
      }
      const fetchPage = async (offset: number) => {
        let query = supabase.from("orders").select(ORDER_SELECT).order("created_at", { ascending: false });
        query = view === "hidden" ? query.not("hidden_at", "is", null) : query.is("hidden_at", null);
        if (filter !== "all") query = query.eq("status", filter);
        if (dateFilter !== "all") query = query.gte("created_at", dateSince(dateFilter));
        if (term) query = /^\d+$/.test(term) ? query.eq("id", Number(term)) : customerIds?.length ? query.in("customer_id", customerIds) : query.eq("id", -1);
        return query.range(offset, offset + PAGE_SIZE - 1);
      };
      const result: Order[] = [];
      for (let offset = 0; offset < totalCount; offset += PAGE_SIZE) {
        const { data, error: exportError } = await fetchPage(offset);
        if (exportError) throw exportError;
        result.push(...((data ?? []) as unknown as Order[]));
      }
      const fields = ["Order #", "Created at", "Status", "Customer", "Channel", "Items", "Shipping", "Total", "Facebook name", "Permanent address", "Mobile", "Email"];
      const quote = (value: unknown) => {
        const raw = String(value ?? "");
        const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
        return `"${safe.replaceAll('"', '""')}"`;
      };
      const rows = result.map((order) => [order.id, new Date(order.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }), order.status, order.customers?.name ?? order.customers?.external_id ?? order.customer_id, order.customers?.channel, order.order_items.map((item) => `${item.qty}x ${item.variants?.products?.name ?? "Product"} (${item.variants?.size ?? "Size"})`).join("; "), order.shipping, order.total, order.customer_full_name, order.customer_address, order.customer_mobile, order.customer_email].map(quote).join(","));
      const blob = new Blob([[fields.map(quote).join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = "tindabot-orders.csv"; link.click(); URL.revokeObjectURL(url);
    } catch (exportError) { setError(exportError instanceof Error ? exportError.message : "Could not export orders."); }
    setExporting(false);
  }

  return (
    <div className="page-content orders-page">
      <section className="orders-hero">
        <div>
          <p className="eyebrow">SHOP OPERATIONS</p>
          <h1>Orders</h1>
          <p>Keep payments and delivery status moving in one place.</p>
        </div>
        <div className="order-status-filters" role="group" aria-label="Filter orders by status">
          {(["all", "awaiting_payment", "paid", "shipped", "expired"] as Filter[]).map((status) => (
            <button
              className={filter === status ? "active" : ""}
              type="button"
              key={status}
              aria-pressed={filter === status}
              onClick={() => { setFilter(status); setPage(0); }}
            >
              {status === "all" ? "All orders" : statusLabels[status]}
            </button>
          ))}
        </div>
      </section>
      {error && <p className="inbox-alert error-state" role="alert">{error}</p>}
      <nav className="orders-view-tabs" aria-label="Order views">
        <button type="button" className={view === "active" ? "active" : ""} aria-current={view === "active" ? "page" : undefined} onClick={() => { setView("active"); setPage(0); }}>Orders</button>
        <button type="button" className={view === "hidden" ? "active" : ""} aria-current={view === "hidden" ? "page" : undefined} onClick={() => { setView("hidden"); setPage(0); }}>Hidden orders</button>
      </nav>
      <section className="orders-tools" aria-label="Filter and export order history">
        <label className="order-search"><span className="sr-only">Search by order number or customer</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search order # or customer" /></label>
        <label className="order-filter"><span className="sr-only">Filter date</span><select value={dateFilter} onChange={(event) => { setDateFilter(event.target.value as DateFilter); setPage(0); }}><option value="all">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
        <button className="button button-secondary" type="button" onClick={() => void exportCsv()} disabled={exporting || totalCount === 0}>{exporting ? "Preparing CSV…" : `Export CSV (${totalCount})`}</button>
        <span className="muted">{totalCount} matching orders</span>
      </section>
      {loading ? (
        <p className="muted">Loading orders…</p>
      ) : visible.length === 0 ? (
        <div className="panel empty-orders">No orders in this view yet.</div>
      ) : (
        <><div className="orders-list">
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
              {order.status === "awaiting_payment" && <p className="muted">Reservation expires {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(order.expires_at))}</p>}
              {(order.customer_full_name || order.customer_address || order.customer_mobile || order.customer_email || order.customer_notes) && (
                <dl className="order-customer-details">
                  {order.customer_full_name && <><dt>Full name</dt><dd>{order.customer_full_name}</dd></>}
                  {order.customer_address && <><dt>Delivery address</dt><dd>{order.customer_address}</dd></>}
                  {order.customer_mobile && <><dt>Mobile</dt><dd>{order.customer_mobile}</dd></>}
                  {order.customer_email && <><dt>Email</dt><dd>{order.customer_email}</dd></>}
                  {order.customer_notes && <><dt>Notes</dt><dd>{order.customer_notes}</dd></>}
                </dl>
              )}
              <ul className="order-items">
                {order.order_items.map((item, index) => (
                  <li key={order.id + "-" + index}>
                    <span>{item.qty} × {item.variants?.products?.name ?? "Product"} ({item.variants?.size ?? "Size"})</span>
                    {item.color && <small>Color: {item.color}</small>}
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
                <button className="message-icon-button" type="button" disabled={savingId === order.id} onClick={() => void setHidden(order, view !== "hidden")} aria-label={view === "hidden" ? `Unhide order ${order.id}` : `Hide order ${order.id}`} title={view === "hidden" ? "Unhide order" : "Hide order"}>
                  {view === "hidden" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-3.1 3.6M6.2 6.7C3.4 8.4 2 12 2 12s3.5 6 10 6c1.2 0 2.3-.2 3.3-.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>}
                </button>
                <button className="message-icon-button order-delete-button" type="button" disabled={savingId === order.id} onClick={() => void deleteOrder(order)} aria-label={`Delete order ${order.id}`} title="Delete order">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>
                </button>
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
        </div><nav className="orders-pagination" aria-label="Order history pages"><button className="button button-secondary" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}</span><button className="button button-secondary" disabled={(page + 1) * PAGE_SIZE >= totalCount} onClick={() => setPage((value) => value + 1)}>Next</button></nav></>
      )}
    </div>
  );
}
