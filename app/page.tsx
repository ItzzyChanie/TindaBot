import Link from "next/link";

const stats = [
  { label: "Open conversations", value: "12", note: "+3 since yesterday" },
  { label: "Orders this week", value: "28", note: "₱18,450 total sales" },
  { label: "Products in stock", value: "46", note: "Across 12 styles" },
];

export default function OverviewPage() {
  return (
    <div className="page-content">
      <div className="page-heading">
        <div><p className="eyebrow">Tuesday, October 27</p><h1>Good morning, Mia <span aria-hidden="true">☀️</span></h1><p className="muted">Here&apos;s what&apos;s happening in your shop today.</p></div>
        <Link className="button button-primary" href="/inbox">Open inbox <span aria-hidden="true">→</span></Link>
      </div>
      <section className="stats-grid" aria-label="Shop summary">
        {stats.map((stat) => <article className="stat-card" key={stat.label}><p className="muted">{stat.label}</p><strong>{stat.value}</strong><span>{stat.note}</span></article>)}
      </section>
      <section className="overview-grid">
        <article className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">Your shop</p><h2>Recent activity</h2></div><button className="text-button">View all <span aria-hidden="true">→</span></button></div>
          <div className="activity-row"><span className="avatar avatar-peach">JM</span><div><strong>Jamie M.</strong><p>Asked about the Isla Linen Top</p></div><time>2 min ago</time></div>
          <div className="activity-row"><span className="avatar avatar-lilac">AC</span><div><strong>Andrea C.</strong><p>Placed an order for 2 items</p></div><time>18 min ago</time></div>
          <div className="activity-row"><span className="avatar avatar-mint">RL</span><div><strong>Rica L.</strong><p>Needs your help with a custom request</p></div><time>1 hr ago</time></div>
        </article>
        <article className="panel storefront-card"><div className="store-icon" aria-hidden="true">✳</div><p className="eyebrow">Your storefront</p><h2>Looking good, Mia!</h2><p className="muted">Your customers can browse what&apos;s available right now.</p><Link className="button button-light" href="/storefront">View storefront <span aria-hidden="true">↗</span></Link></article>
      </section>
    </div>
  );
}
