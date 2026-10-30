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
    <div className="page-content">
      <div className="page-heading"><div><p className="eyebrow">YOUR SHOP</p><h1>Storefront</h1><p className="muted">Share your live catalog with customers po.</p></div></div>
      <section className="panel shop-share-panel">
        <span className="placeholder-icon" aria-hidden="true">↗</span>
        <h2>Your public shop is ready</h2>
        <p className="muted">Customers can browse active products, sizes, current offers, and ask about an item.</p>
        <div className="shop-share-actions">
          <Link className="button button-light" href="/shop" target="_blank">Preview shop</Link>
          <button className="button button-primary" type="button" onClick={() => void copyShopLink()}>{copied ? "Copied!" : "Copy shop link"}</button>
        </div>
        <small className={copyError ? "form-error" : "muted"}>{copyError ? "Could not copy automatically. Open Preview shop and copy its address." : copied ? "Shop link copied." : "Copies this app&apos;s current /shop URL."}</small>
      </section>
    </div>
  );
}
