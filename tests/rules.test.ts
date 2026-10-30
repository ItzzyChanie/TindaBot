import { describe, expect, it } from "vitest";
import { matchCatalogSize, matchQuantityAnswer, understandFromRules, type CatalogProduct } from "../supabase/functions/_shared/rules";

const catalog: CatalogProduct[] = [
  {
    name: "Bayanihan Basic T-Shirt",
    aliases: ["t-shirt", "basic tee", "cotton t-shirt"],
    sizes: ["S", "M", "L"],
  },
  {
    name: "Habi Ribbed Tank Top",
    aliases: ["ribbed tank", "tank top"],
    sizes: ["S", "M", "L"],
  },
];

describe("catalog-grounded message rules", () => {
  it("extracts product, size, quantity, and Metro Manila from the sample message", () => {
    expect(understandFromRules(
      "Magkano po ang 2 medium t-shirt, pa-deliver sa Malabon?",
      catalog,
    )).toEqual({
      intent: "price",
      product_query: "t-shirt",
      size: "M",
      quantity: 2,
      quantities_mentioned: [2],
      location: "Metro Manila",
      confidence: 0.95,
      availability_requested: false,
    });
  });

  it("recognizes common English and Taglish quantity wording", () => {
    const result = understandFromRules(
      "How much are dalawang medium basic tees?",
      catalog,
    );
    expect(result).toMatchObject({
      intent: "price",
      product_query: "basic tee",
      size: "M",
      quantity: 2,
      location: null,
    });
  });

  it("leaves conflicting quantities for the brain to clarify", () => {
    expect(understandFromRules("Price for 2 or 3 basic tees?", catalog))
      .toMatchObject({
        intent: "price",
        product_query: "basic tee",
        quantity: null,
        quantities_mentioned: [2, 3],
      });
  });

  it("preserves an unknown product phrase so the brain escalates it", () => {
    expect(understandFromRules(
      "Magkano po 2 medium denim jacket?",
      catalog,
    )).toMatchObject({
      intent: "price",
      product_query: "denim jacket",
      quantity: 2,
      size: null,
    });
  });

  it("preserves a shared alias so the customer can choose between matching products", () => {
    const result = understandFromRules(
      "Magkano po ang 2 medium t-shirt, pa-deliver sa Malabon?",
      [
        ...catalog,
        { name: "Amihan Cotton Tee", aliases: ["t-shirt"], sizes: ["S", "M"] },
      ],
    );

    expect(result).toMatchObject({
      intent: "price",
      product_query: "t-shirt",
      size: "M",
      quantity: 2,
      location: "Metro Manila",
    });
  });

  it("classifies greetings and leaves unrelated questions unknown", () => {
    expect(understandFromRules("Hello po", catalog).intent).toBe("greeting");
    expect(understandFromRules("What is the weather today?", catalog).intent)
      .toBe("unknown");
  });

  it("recognizes size answers regardless of casing and common typos", () => {
    for (const answer of ["m", "MEDIUM", "meduim", "M po", "LARGE", "larg", "small", "smol"]) {
      expect(matchCatalogSize(answer, ["S", "M", "L"])).not.toBeNull();
    }
    expect(matchCatalogSize("medium", ["S", "M", "L"])).toBe("M");
    expect(matchCatalogSize("LARGE", ["S", "M", "L"])).toBe("L");
    expect(matchQuantityAnswer("dalawa po")).toBe(2);
    expect(matchQuantityAnswer("3 pcs")).toBe(3);
  });

  it("recognizes short price and availability wording around item names", () => {
    for (const message of ["How much Bayanihan Basic T-Shirt?", "hm po yung bayanihan basic t-shirt?"]) {
      expect(understandFromRules(message, catalog)).toMatchObject({
        intent: "price",
        product_query: "Bayanihan Basic T-Shirt",
      });
    }
    for (const message of [
      "Meron po ba kayong Bayanihan Basic Tshirt?",
      "avail po ba yung Bayanihan Basic T-Shirt",
    ]) {
      expect(understandFromRules(message, catalog)).toMatchObject({
        intent: "availability",
        product_query: expect.any(String),
      });
    }
  });
});
