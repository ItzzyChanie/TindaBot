import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MissedRequestsTable, type MissedRequest } from "./missed-requests-table";

const intentLabels: Record<string, string> = {
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

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ followupPage?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const params = await searchParams;
  const requestedPage = Number.parseInt(params.followupPage ?? "0", 10);
  const followupPage = Number.isFinite(requestedPage) ? Math.min(10000, Math.max(0, requestedPage)) : 0;
  const { data, error: insightsError } = await supabase.rpc("get_shop_insights", {
    p_since: since,
    p_missed_limit: 15,
    p_missed_offset: followupPage * 15,
  });
  const metrics = (data ?? {}) as {
    customer_message_count?: number;
    bot_answered_count?: number;
    needs_seller?: number;
    paid_order_count?: number;
    paid_revenue?: number;
    missed_count?: number;
    intent_counts?: { intent: string; count: number }[];
    missed_requests?: MissedRequest[];
  };
  const customerMessageCount = Number(metrics.customer_message_count ?? 0);
  const botAnswered = Number(metrics.bot_answered_count ?? 0);
  const needsSeller = Number(metrics.needs_seller ?? 0);
  const orderCount = Number(metrics.paid_order_count ?? 0);
  const revenue = Number(metrics.paid_revenue ?? 0);
  const missedCount = Number(metrics.missed_count ?? 0);
  const missed = metrics.missed_requests ?? [];
  const mostAsked = (metrics.intent_counts ?? []).slice(0, 6);
  const loadError = insightsError?.message;
  const answeredShare = customerMessageCount
    ? Math.round((botAnswered / customerMessageCount) * 100)
    : 0;
  const maxIntentCount = Math.max(1, ...mostAsked.map(({ count }) => count));

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
            {botAnswered} of {customerMessageCount} customer messages
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
          <strong>{orderCount}</strong>
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
              {mostAsked.map(({ intent, count }) => (
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
        <article className="panel insights-missed-panel" id="seller-follow-up">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SELLER FOLLOW-UP</p>
              <h2>Requests needing your input</h2>
            </div>
            <span className="missed-total">{missedCount}</span>
          </div>
          <p className="muted">
            Questions the assistant couldn’t answer from catalog or shop
            settings.
          </p>
          {missed.length ? (
            <MissedRequestsTable requests={missed} page={followupPage} total={missedCount} />
          ) : (
            <p className="muted">No missed requests to review.</p>
          )}
        </article>
      </section>
    </div>
  );
}
