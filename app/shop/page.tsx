"use client";
/* eslint-disable @next/next/no-img-element -- Catalog photos use public Supabase Storage URLs. */

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { formatOfferDateTime, offerTiming, quote, type QuotePromo } from "@/supabase/functions/_shared/quote";
import { ChatWidget } from "@/app/chat/chat-widget";
import tindabotLogo from "@/app/logo/TindaBot-logo.png";

type PublicSize = {
  size: string;
  price: number | null;
  availability: "in_stock" | "low_stock" | "sold_out";
};
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
  colors: string[];
  sizes: PublicSize[];
  promos: QuotePromo[];
};

const currency = (amount: number) =>
  `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ShopPage() {
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [chatSession, setChatSession] = useState<{
    productId: string;
    sessionId: string;
  } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  function openChat(productId: string) {
    if (closeTimerRef.current !== null)
      window.clearTimeout(closeTimerRef.current);
    setChatSession({ productId, sessionId: crypto.randomUUID() });
    setChatOpen(true);
  }

  function closeChat() {
    setChatOpen(false);
    closeTimerRef.current = window.setTimeout(() => setChatSession(null), 240);
  }

  useEffect(() => {
    let active = true;
    let loadingCatalog = false;
    let controller: AbortController | null = null;
    const loadCatalog = async () => {
      if (loadingCatalog) return;
      loadingCatalog = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 12000);
      try {
        const { url, supabaseKey } = getSupabasePublicEnv();
        const response = await fetch(
          `${url.replace(/\/$/, "")}/rest/v1/public_catalog?select=*&order=name.asc`,
          {
            headers: { apikey: supabaseKey },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("Catalog request failed");
        const data = (await response.json()) as PublicProduct[];
        if (!active) return;
        setProducts(data);
        setError("");
      } catch {
        if (active) {
          setError((current) => current || (
            controller?.signal.aborted
              ? "Matagal ang connection. Pakisubukan i-refresh ang shop po."
              : "Hindi ma-load ang shop ngayon. Pakisubukan ulit po."
          ));
        }
      } finally {
        window.clearTimeout(timeout);
        loadingCatalog = false;
        if (active) setLoading(false);
      }
    };
    void loadCatalog();
    const refreshTimer = window.setInterval(() => {
      if (!document.hidden) void loadCatalog();
    }, 60000);
    const onVisibilityChange = () => {
      if (!document.hidden) void loadCatalog();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      if (controller) controller.abort();
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      `${product.name} ${product.description}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [products, search]);
  const availableCount = products.filter((product) =>
    product.sizes?.some((size) => size.availability !== "sold_out"),
  ).length;

  return (
    <main className="shop-page">
      <header className="shop-header">
        <Link href="/shop" className="brand">
          <Image className="brand-logo" src={tindabotLogo} alt="" priority />
          <span>
            Tinda<span className="brand-accent">Bot</span>
          </span>
        </Link>
        <nav className="shop-nav" aria-label="Shop navigation">
          <a href="#catalog">Shop</a>
          <a href="#shop-about">About the shop</a>
          <a className="shop-help-link" href="#shop-help">
            Need help?
          </a>
        </nav>
        <span className="shop-header-caption">Curated everyday styles</span>
      </header>
      <section className="shop-hero">
        <div className="shop-hero-copy">
          <p className="eyebrow">TINDABOT ONLINE SHOP</p>
          <h1>
            Find a piece
            <br />
            that feels like you.
          </h1>
          <p>
            Browse current styles and available sizes. May tanong po? We’re one
            message away.
          </p>
          <a className="shop-hero-cta" href="#catalog">
            Explore the collection <span aria-hidden="true">↓</span>
          </a>
        </div>
        <div className="shop-hero-art" aria-hidden="true">
          <span className="shop-art-orbit orbit-one" />
          <span className="shop-art-orbit orbit-two" />
          <span className="shop-art-sun" />
          <span className="shop-art-garment">
            <i />
            <i />
            <i />
          </span>
          <span className="shop-art-label">
            NEW SEASON
            <br />
            <strong>Made for everyday</strong>
          </span>
        </div>
      </section>
      <section id="catalog" className="shop-catalog-section">
        <div className="shop-section-heading">
          <div>
            <p className="eyebrow">THE COLLECTION</p>
            <h2>Find your next favorite</h2>
            <p>
              Live styles selected for you. Prices and stock update from the
              shop po.
            </p>
          </div>
          <label className="shop-search">
            <span className="sr-only">Search products</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.8" />
              <path d="m16 16 5 5" />
            </svg>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the collection"
            />
          </label>
        </div>
        <div className="shop-collection-meta">
          <span>
            {loading
              ? "Loading collection"
              : `${filtered.length} styles to explore`}
          </span>
          <span>{availableCount} styles with available sizes</span>
        </div>
        {error && (
          <p className="shop-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p className="shop-state">Loading catalog…</p>
        ) : filtered.length === 0 ? (
          <p className="shop-state">
            {search
              ? "Walang matching item po."
              : "Wala pang available na item sa shop."}
          </p>
        ) : (
          <section className="shop-grid" aria-label="Shop catalog">
            {filtered.map((product) => {
              const sizes = product.sizes ?? [];
              const prices = (product.sizes ?? []).map((size) => ({
                offer: quote(product, 1, currentTime, product.promos ?? [], size.price),
                list: quote(product, 1, currentTime, [], size.price).subtotal,
              }));
              const bestPrice = prices.length
                ? prices.reduce((lowest, current) => current.offer.total < lowest.offer.total ? current : lowest)
                : null;
              const pricing = bestPrice
                ? bestPrice.offer
                : quote(product, 1, currentTime, product.promos ?? []);
              const listPrice = bestPrice
                ? bestPrice.list
                : quote(product, 1, currentTime).subtotal;
              const hasSizePriceDifferences = new Set(
                sizes.map((size) => size.price ?? product.price),
              ).size > 1;
              const timing = offerTiming(product.discount_starts, product.discount_ends, currentTime);
              const offerStart = formatOfferDateTime(product.discount_starts);
              const offerEnd = formatOfferDateTime(product.discount_ends);
              const badges = (product.promos ?? []).filter(
                (promo) =>
                  quote(product, promo.min_qty, currentTime, [promo]).saved > 0,
              );
              const available = sizes.some(
                (size) => size.availability !== "sold_out",
              );
              return (
                <article className="shop-product" key={product.id}>
                  {product.image_url ? (
                    <img
                      className="shop-product-image"
                      src={product.image_url}
                      alt={product.name}
                      width={600}
                      height={740}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div
                      className="shop-product-image shop-image-placeholder"
                      aria-hidden="true"
                    >
                      No image
                    </div>
                  )}
                  <div className="shop-product-body">
                    <div className="shop-product-heading">
                      <h2>{product.name}</h2>
                      <span
                        className={`shop-stock ${available ? "available" : "unavailable"}`}
                      >
                        {!available
                          ? "Sold out"
                          : sizes.some((size) => size.availability === "low_stock")
                            ? "Low stock"
                            : "Available"}
                      </span>
                    </div>
                    <p className="shop-description">
                      {product.description || " "}
                    </p>
                    <div className="shop-price-row">
                      {product.discount_type && !timing.ended && offerStart && offerEnd && (
                        <small className={`offer-schedule${timing.active && timing.daysLeft !== null && timing.daysLeft <= 3 ? " offer-ending-soon" : ""}`}>
                          {timing.upcoming ? "Offer starts " : "Offer "}{offerStart} – {offerEnd}
                          {timing.active && timing.daysLeft !== null && timing.daysLeft <= 3 && (
                            <b className="offer-urgency">
                              {timing.daysLeft <= 1 ? "Ends today. Buy now!" : `${timing.daysLeft} days left. Buy now!`}
                            </b>
                          )}
                        </small>
                      )}
                      {hasSizePriceDifferences && <small>From</small>}
                      <strong>{currency(pricing.unit)}</strong>
                      {pricing.saved > 0 && <del>{currency(listPrice)}</del>}
                      {pricing.label && (
                        <span className="offer-badge">{pricing.label}</span>
                      )}
                    </div>
                    {product.colors?.length > 0 && (
                      <div className="shop-colors">
                        <strong>Available colors</strong>
                        <span>{product.colors.join(", ")}</span>
                      </div>
                    )}
                    <div className="shop-offers">
                      {badges.map((promo) => (
                        <span
                          className="offer-badge"
                          key={`${promo.label}-${promo.min_qty}`}
                        >
                          {promo.label} · {promo.min_qty}+ pcs
                        </span>
                      ))}
                    </div>
                    <div className="shop-sizes" aria-label="Size availability">
                      {sizes.map((item) => (
                        <span
                          className={`shop-size ${item.availability}`}
                          key={item.size}
                        >
                          <b>{item.size}</b>
                          <small>{currency(item.price ?? product.price)}</small>
                          <small>
                            {item.availability === "sold_out"
                              ? "Sold out"
                              : item.availability === "low_stock"
                                ? "Low stock"
                                : "In stock"}
                          </small>
                        </span>
                      ))}
                    </div>
                    <div className="shop-product-actions">
                      <button
                        className="button button-primary"
                        type="button"
                        onClick={() => openChat(product.id)}
                      >
                        Ask about this
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </section>
      <section id="shop-about" className="shop-about">
        <p className="eyebrow">MADE FOR CHAT-FIRST SHOPPING</p>
        <h2>Questions are part of finding the right piece.</h2>
        <p>
          Our automated shop assistant can help with catalog details, pricing,
          size availability, and shipping. If your request needs a person, you
          can ask the seller any time po.
        </p>
      </section>
      <footer id="shop-help" className="shop-footer">
        <span>Automated assistant po ito ng shop.</span>
        <span>
          Need a person? Open a product chat and choose “Talk to the seller.”
        </span>
        <nav className="shop-legal-links" aria-label="Privacy links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/data-deletion">Data deletion</Link>
        </nav>
      </footer>
      {chatSession && (
        <>
          <button
            className={`shop-chat-backdrop${chatOpen ? " open" : ""}`}
            type="button"
            onClick={closeChat}
            aria-label="Close chat panel"
            tabIndex={chatOpen ? 0 : -1}
          />
          <aside
            className={`shop-chat-drawer${chatOpen ? " open" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="Ask about this item"
            aria-hidden={!chatOpen}
          >
            <ChatWidget
              key={chatSession.sessionId}
              productId={chatSession.productId}
              sessionId={chatSession.sessionId}
              onClose={closeChat}
            />
          </aside>
        </>
      )}
    </main>
  );
}
