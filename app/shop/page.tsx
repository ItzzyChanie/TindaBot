"use client";
/* eslint-disable @next/next/no-img-element -- Catalog photos use public Supabase Storage URLs. */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { quote, type QuotePromo } from "@/supabase/functions/_shared/quote";

type PublicSize = { size: string; availability: "in_stock" | "low_stock" | "sold_out" };
type PublicProduct = {
  id: string;
  name: string;
  description: string;
  image_url: string | null;
  price: number;
  discount_type: "percent" | "fixed" | null;
  discount_value: number | null;
  discount_starts: string | null;
  discount_ends: string | null;
  sizes: PublicSize[];
  promos: QuotePromo[];
};

const currency = (amount: number) => `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ShopPage() {
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    void (async () => {
      try {
        const { url, supabaseKey } = getSupabasePublicEnv();
        const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/public_catalog?select=*&order=name.asc`, {
          headers: { apikey: supabaseKey },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Catalog request failed");
        const data = await response.json() as PublicProduct[];
        if (!active) return;
        setProducts(data);
        setLoading(false);
      } catch {
        if (active) {
          setError(controller.signal.aborted
            ? "Matagal ang connection. Pakisubukan i-refresh ang shop po."
            : "Hindi ma-load ang shop ngayon. Pakisubukan ulit po.");
          setLoading(false);
        }
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      `${product.name} ${product.description}`.toLocaleLowerCase().includes(query)
    );
  }, [products, search]);

  return (
    <main className="shop-page">
      <header className="shop-header">
        <Link href="/shop" className="brand"><span className="brand-mark" aria-hidden="true">t</span><span>Tinda<span className="brand-accent">Bot</span></span></Link>
        <p>Mga available na item po</p>
        <label className="shop-search"><span className="sr-only">Search products</span><input suppressHydrationWarning value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Maghanap ng item…" /></label>
      </header>
      {error && <p className="shop-error" role="alert">{error}</p>}
      {loading ? <p className="shop-state">Loading catalog…</p> : filtered.length === 0 ? <p className="shop-state">{search ? "Walang matching item po." : "Wala pang available na item sa shop."}</p> : (
        <section className="shop-grid" aria-label="Shop catalog">
          {filtered.map((product) => {
            const pricing = quote(product, 1, new Date(), product.promos ?? []);
            const listPrice = quote(product, 1, new Date()).subtotal;
            const badges = (product.promos ?? []).filter((promo) =>
              quote(product, promo.min_qty, new Date(), [promo]).saved > 0
            );
            const sizes = product.sizes ?? [];
            const available = sizes.some((size) => size.availability !== "sold_out");
            return (
              <article className="shop-product" key={product.id}>
                {product.image_url ? <img className="shop-product-image" src={product.image_url} alt={product.name} /> : <div className="shop-product-image shop-image-placeholder" aria-hidden="true">◇</div>}
                <div className="shop-product-body">
                  <div className="shop-product-heading"><h2>{product.name}</h2><span className={`shop-stock ${available ? "available" : "unavailable"}`}>{available ? "Available" : "Sold out"}</span></div>
                  {product.description && <p className="shop-description">{product.description}</p>}
                  <div className="shop-price-row">
                    <strong>{currency(pricing.unit)}</strong>
                    {pricing.saved > 0 && <del>{currency(listPrice)}</del>}
                    {pricing.label && <span className="offer-badge">{pricing.label}</span>}
                  </div>
                  {badges.length > 0 && <div className="shop-offers">{badges.map((promo) => <span className="offer-badge" key={`${promo.label}-${promo.min_qty}`}>{promo.label} · {promo.min_qty}+ pcs</span>)}</div>}
                  <div className="shop-sizes" aria-label="Size availability">
                    {sizes.map((item) => <span className={`shop-size ${item.availability}`} key={item.size}><b>{item.size}</b><small>{item.availability === "sold_out" ? "Sold out" : item.availability === "low_stock" ? "Low stock" : "Available"}</small></span>)}
                  </div>
                  <div className="shop-product-actions">
                    <Link className="button button-primary" href={`/chat?product=${encodeURIComponent(product.id)}`}>Ask about this</Link>
                    <a className="shop-telegram-link" href={`https://t.me/TindaBotPH_bot?start=product_${product.id}`} target="_blank" rel="noreferrer">Ask on Telegram</a>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
      <footer className="shop-footer">Automated assistant po ito ng shop. For help, open chat and choose Talk to the seller.</footer>
    </main>
  );
}
