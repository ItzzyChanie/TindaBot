import { describe, expect, it } from "vitest";
import { quote } from "../supabase/functions/_shared/quote";

const now = new Date("2026-10-29T04:00:00.000Z");
const promo = (overrides = {}) => ({
  label: "Buy 3 save 10%",
  kind: "qty_percent" as const,
  min_qty: 3,
  value: 10,
  ...overrides,
});

describe("quote", () => {
  it("quotes without an offer", () =>
    expect(quote({ price: 100 }, 2, now).total).toBe(200));
  it("applies a percent discount", () =>
    expect(
      quote(
        { price: 100, discount_type: "percent", discount_value: 20 },
        2,
        now,
      ).total,
    ).toBe(160));
  it("applies a fixed discount per item", () =>
    expect(
      quote({ price: 100, discount_type: "fixed", discount_value: 15 }, 2, now)
        .total,
    ).toBe(170));
  it("does not go below zero when a fixed discount exceeds price", () =>
    expect(
      quote({ price: 50, discount_type: "fixed", discount_value: 60 }, 2, now)
        .total,
    ).toBe(0));
  it("ignores an expired discount", () =>
    expect(
      quote(
        {
          price: 100,
          discount_type: "percent",
          discount_value: 50,
          discount_ends: "2026-10-28T15:59:59+08:00",
        },
        1,
        now,
      ).total,
    ).toBe(100));
  it("ignores a discount that has not started in Manila", () =>
    expect(
      quote(
        {
          price: 100,
          discount_type: "percent",
          discount_value: 50,
          discount_starts: "2026-10-30T00:00:00+08:00",
        },
        1,
        now,
      ).total,
    ).toBe(100));
  it("does not apply a promo below its threshold", () =>
    expect(quote({ price: 100 }, 2, now, [promo()]).total).toBe(200));
  it("applies a promo at its threshold", () =>
    expect(quote({ price: 100 }, 3, now, [promo()]).total).toBe(270));
  it("chooses the promo over a smaller discount", () =>
    expect(
      quote(
        { price: 100, discount_type: "percent", discount_value: 5 },
        3,
        now,
        [promo()],
      ).label,
    ).toBe("Buy 3 save 10%"));
  it("chooses the discount over a smaller promo", () =>
    expect(
      quote(
        { price: 100, discount_type: "percent", discount_value: 30 },
        3,
        now,
        [promo()],
      ).total,
    ).toBe(210));
  it("handles quantity one", () =>
    expect(quote({ price: 33.33 }, 1, now)).toMatchObject({
      unit: 33.33,
      subtotal: 33.33,
      total: 33.33,
      saved: 0,
    }));
  it("handles a large quantity", () =>
    expect(quote({ price: 33.33 }, 1000, now).subtotal).toBe(33330));
  it("rounds a percentage offer once for the line", () =>
    expect(
      quote(
        { price: 33.33, discount_type: "percent", discount_value: 10 },
        3,
        now,
      ).total,
    ).toBe(89.99));
  it("rounds fractional line totals to cents", () =>
    expect(quote({ price: 33.33 }, 3, now).total).toBe(99.99));
});

