import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  understandFromRules,
  type UnderstandingIntent,
} from "@/supabase/functions/_shared/rules";

type ConversationRow = {
  id: string;
  status: string;
  customers: { channel: string } | { channel: string }[] | null;
};
type MessageRow = {
  id: string;
  conversation_id: string;
  sender: string;
  body: string;
  created_at: string;
};
type MissedRow = {
  id: string;
  request_text: string;
  created_at: string;
  conversation_id: string;
};

const simulatedChannels = new Set([
  "messenger_simulated",
  "instagram_simulated",
]);
const intentLabels: Record<UnderstandingIntent, string> = {
  greeting: "Greeting",
  question: "Product question",
  price: "Price",
  availability: "Availability",
  order_confirm: "Order confirmation",
  status: "Order status",
  payment: "Payment",
  order_help: "How to order",
  bulk: "Bulk orders",
  shop_info: "Store location",
  business_hours: "Business hours",
  after_sales: "After-sales policy",
  discount: "Discount question",
  seller_handoff: "Seller follow-up",
  catalog: "Catalog",
  size_chart: "Size chart",
  seller_availability: "Seller availability",
  shipping: "Shipping",
  complaint: "Complaint",
  other: "Other request",
  unknown: "Unrecognized",
};

export default async function InsightsPage() {
  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const [
    { data: conversationData, error: conversationError },
    { data: products },
    { data: orders, error: orderError },
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id,status,customers!inner(channel)")
      .eq("is_hidden", false)
      .gte("created_at", since)
      .range(0, 9999),
    supabase
      .from("products")
      .select("name,aliases,variants(size)")
      .eq("active", true),
    supabase
      .from("orders")
      .select("id,total,status")
      .in("status", ["paid", "shipped"])
      .gte("created_at", since)
      .range(0, 9999),
  ]);

  const realConversations = (
    (conversationData ?? []) as unknown as ConversationRow[]
  ).filter((row) => {
    const customer = Array.isArray(row.customers)
      ? row.customers[0]
      : row.customers;
    return !customer || !simulatedChannels.has(customer.channel);
  });
  const ids = realConversations.map((row) => row.id);
  const messages: MessageRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const { data } = await supabase
      .from("messages")
      .select("id,conversation_id,sender,body,created_at")
      .in("conversation_id", ids.slice(offset, offset + 500))
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(0, 9999);
    messages.push(...((data ?? []) as MessageRow[]));
  }

  const customerMessages = messages.filter(
    (message) => message.sender === "customer",
  );
  const byConversation = new Map<string, MessageRow[]>();
  for (const message of messages) {
    const thread = byConversation.get(message.conversation_id) ?? [];
    thread.push(message);
    byConversation.set(message.conversation_id, thread);
  }
  let botAnswered = 0;
  for (const thread of byConversation.values()) {
    for (let index = 0; index < thread.length; index += 1) {
      if (thread[index].sender !== "customer") continue;
      for (let next = index + 1; next < thread.length; next += 1) {
        if (thread[next].sender === "customer") break;
        if (thread[next].sender === "ai" || thread[next].sender === "seller") {
          if (thread[next].sender === "ai") botAnswered += 1;
          break;
        }
      }
    }
  }

  const intentCounts = new Map<UnderstandingIntent, number>();
  const catalog = (products ?? []).map((product) => ({
    name: product.name,
    aliases: product.aliases,
    sizes: product.variants.map((variant) => variant.size),
  }));
  for (const message of customerMessages) {
    const { intent } = understandFromRules(message.body, catalog);
    intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
  }
  const mostAsked = [...intentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const needsSeller = realConversations.filter(
    (row) => row.status === "needs_seller",
  ).length;
  const revenue = (orders ?? []).reduce(
    (sum, order) => sum + Number(order.total),
    0,
  );
  const { data: missedData, error: missedError } = ids.length
    ? await supabase
        .from("missed_requests")
        .select("id,request_text,created_at,conversation_id")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [], error: null };
  const missed = ((missedData ?? []) as MissedRow[]).filter((row) =>
    ids.includes(row.conversation_id),
  );
  const loadError =
    conversationError?.message ?? orderError?.message ?? missedError?.message;
  const answeredShare = customerMessages.length
    ? Math.round((botAnswered / customerMessages.length) * 100)
    : 0;
  const maxIntentCount = Math.max(1, ...mostAsked.map(([, count]) => count));

  return (
    <div className="page-content insights-page">
      <section className="insights-hero">
        <div>
          <p className="eyebrow">SELLER ANALYTICS · LAST 90 DAYS</p>
          <h1>Understand what customers need</h1>
          <p>
            Real conversation and paid order activity. Simulated channels are
            excluded.
          </p>
        </div>
        <Link className="insights-hero-link" href="/inbox">
          Review conversations <span aria-hidden="true">→</span>
        </Link>
      </section>
      {loadError && (
        <p className="form-error" role="alert">
          Some insight data could not be loaded: {loadError}
        </p>
      )}
      <section className="insight-stats" aria-label="Shop performance">
        <article className="stat-card">
          <p className="muted">Bot answer share</p>
          <strong>{answeredShare}%</strong>
          <span>
            {botAnswered} of {customerMessages.length} customer messages
            answered without seller involvement
          </span>
        </article>
        <article className="stat-card">
          <p className="muted">Open escalations</p>
          <strong>{needsSeller}</strong>
          <span>Conversations waiting for you</span>
        </article>
        <article className="stat-card">
          <p className="muted">Paid and shipped orders</p>
          <strong>{orders?.length ?? 0}</strong>
          <span>
            ₱
            {revenue.toLocaleString("en-PH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            revenue
          </span>
        </article>
        <article className="stat-card">
          <p className="muted">Assistant answers</p>
          <strong>{botAnswered}</strong>
          <span>Customer messages answered by TindaBot</span>
        </article>
      </section>
      <section className="insight-grid">
        <article className="panel insights-intent-panel">
          <p className="eyebrow">CUSTOMER QUESTIONS</p>
          <h2>What people ask about</h2>
          <p className="muted">
            Share of recognized questions in your conversations.
          </p>
          {mostAsked.length ? (
            <ol className="insight-intents">
              {mostAsked.map(([intent, count]) => (
                <li key={intent}>
                  <div>
                    <span>{intentLabels[intent]}</span>
                    <span
                      className="intent-track"
                      role="progressbar"
                      aria-label={`${intentLabels[intent]} questions`}
                      aria-valuemin={0}
                      aria-valuemax={maxIntentCount}
                      aria-valuenow={count}
                    >
                      <span
                        style={{ width: `${(count / maxIntentCount) * 100}%` }}
                      />
                    </span>
                  </div>
                  <strong>{count}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No customer questions yet.</p>
          )}
        </article>
        <article className="panel insights-missed-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SELLER FOLLOW-UP</p>
              <h2>Requests needing your input</h2>
            </div>
            <span className="missed-total">{missed.length}</span>
          </div>
          <p className="muted">
            Questions the assistant couldn’t answer from catalog or shop
            settings.
          </p>
          {missed.length ? (
            <div className="missed-table-wrap">
              <table className="missed-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Received</th>
                    <th>
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {missed.map((request) => (
                    <tr key={request.id}>
                      <td>{request.request_text}</td>
                      <td>
                        <time dateTime={request.created_at}>
                          {new Intl.DateTimeFormat("en-PH", {
                            dateStyle: "medium",
                          }).format(new Date(request.created_at))}
                        </time>
                      </td>
                      <td>
                        <Link
                          className="text-button"
                          href={
                            "/catalog?newProduct=" +
                            encodeURIComponent(
                              request.request_text.slice(0, 120),
                            )
                          }
                        >
                          Add to catalog
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No missed requests to review.</p>
          )}
        </article>
      </section>
    </div>
  );
}
