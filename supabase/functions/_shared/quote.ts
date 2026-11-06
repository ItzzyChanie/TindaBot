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

function boundary(value: string | null | undefined, isEnd: boolean): number | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const time = isEnd ? "23:59:59.999" : "00:00:00.000";
    const parsed = new Date(`${value}T${time}+08:00`).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function withinDates(now: Date, starts?: string | null, ends?: string | null) {
  const current = now.getTime();
  const start = boundary(starts, false);
  const end = boundary(ends, true);
  return (start === null || current >= start) && (end === null || current <= end);
}

export function offerTiming(starts?: string | null, ends?: string | null, now = new Date()) {
  const start = boundary(starts, false);
  const end = boundary(ends, true);
  const current = now.getTime();
  const active = (start === null || current >= start) && (end === null || current <= end);
  const upcoming = start !== null && current < start;
  const daysLeft = end !== null && current <= end
    ? Math.ceil((end - current) / 86_400_000)
    : null;
  return { active, upcoming, ended: end !== null && current > end, startsAt: start, endsAt: end, daysLeft };
}

export function formatOfferDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date) + " PHT";
}

export function quote(
  product: QuoteProduct,
  quantity: number,
  now: Date,
  promos: QuotePromo[] = [],
  variantPrice?: number | null,
) {
  const qty = Math.max(0, Math.floor(quantity));
  const price = Math.max(0, Number(variantPrice ?? product.price) || 0);
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
