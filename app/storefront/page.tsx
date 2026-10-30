"use client";

import Link from "next/link";
import { useState } from "react";

export default function StorefrontPage() {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copyShopLink() {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/shop`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  return (
    <div className="page-content storefront-manager-page">
      <section className="storefront-manager-hero">
        <div className="storefront-manager-copy">
          <p className="eyebrow">CUSTOMER EXPERIENCE</p>
          <h1>Meet your storefront</h1>
          <p>
            Your live catalog gives customers one place to check styles, prices,
            available sizes, and ask you a question.
          </p>
          <div className="storefront-manager-actions">
            <Link
              className="button storefront-preview-button"
              href="/shop"
              target="_blank"
            >
              Preview customer shop <span aria-hidden="true">↗</span>
            </Link>
            <button
              className="button storefront-copy-button"
              type="button"
              onClick={() => void copyShopLink()}
            >
              {copied ? "Link copied" : "Copy shop link"}
            </button>
          </div>
        </div>
        <div className="storefront-visual" aria-hidden="true">
          <div className="storefront-visual-window">
            <div className="storefront-visual-bar">
              <i />
              <i />
              <i />
            </div>
            <div className="storefront-visual-content">
              <span className="storefront-visual-image" />
              <span className="storefront-visual-lines">
                <i />
                <i />
                <i />
              </span>
              <span className="storefront-visual-price">₱850.00</span>
            </div>
          </div>
          <span className="storefront-live-badge">
            <span className="online-dot" />
            LIVE CATALOG
          </span>
        </div>
      </section>
      {copyError && (
        <p className="form-error storefront-copy-error" role="alert">
          Could not copy automatically. Open the preview and copy its address.
        </p>
      )}
      {copied && (
        <p className="catalog-notice storefront-copy-error" role="status">
          Shop link copied. Share it with customers po.
        </p>
      )}
      <section
        className="storefront-feature-grid"
        aria-label="Storefront features"
      >
        <article className="storefront-feature-card">
          <span className="feature-number">01</span>
          <h2>Live availability</h2>
          <p>Active products show their current size and stock availability.</p>
        </article>
        <article className="storefront-feature-card">
          <span className="feature-number">02</span>
          <h2>Current pricing</h2>
          <p>
            Offers and discounts are quoted with the same pricing rules as chat.
          </p>
        </article>
        <article className="storefront-feature-card">
          <span className="feature-number">03</span>
          <h2>Ask about an item</h2>
          <p>Customers can open chat from a product and ask for seller help.</p>
        </article>
      </section>
    </div>
  );
}
