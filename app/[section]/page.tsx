import { notFound } from "next/navigation";

const pages: Record<
  string,
  { title: string; description: string; icon: string }
> = {
  inbox: {
    title: "Inbox",
    description: "All your customer conversations, together.",
    icon: "▤",
  },
  catalog: {
    title: "Catalog",
    description: "Manage your products, sizes, and availability.",
    icon: "◫",
  },
  orders: {
    title: "Orders",
    description: "Keep track of customer orders from chat to checkout.",
    icon: "▣",
  },
  insights: {
    title: "Insights",
    description: "A clear view of how your shop is doing.",
    icon: "▥",
  },
  storefront: {
    title: "Storefront",
    description: "A simple place for customers to browse your products.",
    icon: "↗",
  },
};

export function generateStaticParams() {
  return Object.keys(pages).map((section) => ({ section }));
}

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const page = pages[section];
  if (!page) notFound();
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>{page.title}</h1>
          <p className="muted">{page.description}</p>
        </div>
      </div>
      <section className="panel placeholder-panel">
        <span className="placeholder-icon" aria-hidden="true">
          {page.icon}
        </span>
        <h2>{page.title} is on its way</h2>
        <p className="muted">
          This space is ready for your shop. Check back soon!
        </p>
      </section>
    </div>
  );
}
