export type QuoteProduct = {
  price: number;
  discount_type?: "percent" | "fixed" | null;
  discount_value?: number | null;
  discount_starts?: string | null;
  discount_ends?: string | null;
};

export type QuotePromo = {
  label: string;
  kind: "qty_percent";
  min_qty: number;
  value: number;
  starts_at?: string | null;
  ends_at?: string | null;
  active?: boolean;
};

function roundLine(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function manilaDay(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function withinDates(now: Date, starts?: string | null, ends?: string | null) {
  const today = manilaDay(now);
  return (!starts || today >= manilaDay(starts)) && (!ends || today <= manilaDay(ends));
}

export function quote(
  product: QuoteProduct,
  quantity: number,
  now: Date,
  promos: QuotePromo[] = [],
) {
  const qty = Math.max(0, Math.floor(quantity));
  const price = Math.max(0, Number(product.price) || 0);
  const subtotal = roundLine(price * qty);
  const options: { total: number; label: string | null }[] = [
    { total: subtotal, label: null },
  ];

  const discountValue = Math.max(0, Number(product.discount_value) || 0);
  if (
    product.discount_type &&
    discountValue > 0 &&
    withinDates(now, product.discount_starts, product.discount_ends)
  ) {
    const perUnit = product.discount_type === "percent"
      ? price * (1 - Math.min(discountValue, 100) / 100)
      : price - discountValue;
    options.push({
      total: roundLine(Math.max(0, perUnit) * qty),
      label: product.discount_type === "percent"
        ? `${discountValue}% off`
        : `₱${roundLine(discountValue).toFixed(2)} off`,
    });
  }

  for (const promo of promos) {
    if (
      promo.active !== false && promo.kind === "qty_percent" && qty >= promo.min_qty &&
      withinDates(now, promo.starts_at, promo.ends_at)
    ) {
      options.push({
        total: roundLine(price * (1 - Math.min(Math.max(promo.value, 0), 100) / 100) * qty),
        label: promo.label,
      });
    }
  }

  options.sort((a, b) => a.total - b.total);
  const best = options[0];
  return {
    unit: qty > 0 ? best.total / qty : 0,
    qty,
    subtotal,
    total: best.total,
    saved: roundLine(Math.max(0, subtotal - best.total)),
    label: best.label,
  };
}
