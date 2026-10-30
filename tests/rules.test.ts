import { describe, expect, it } from "vitest";
import { isAcknowledgement, matchCatalogSize, matchQuantityAnswer, understandFromRules, type CatalogProduct } from "../supabase/functions/_shared/rules";

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

  it("treats deictic availability wording as having no product phrase", () => {
    expect(understandFromRules("Is this available po?", catalog)).toMatchObject({
      intent: "availability",
      product_query: null,
    });
  });

  it("recognizes shipping questions about areas outside Metro Manila", () => {
    expect(understandFromRules("sa ibang lugar po? how much?", catalog)).toMatchObject({
      intent: "shipping",
      product_query: null,
      location: null,
    });
    expect(understandFromRules("shipping outside Metro Manila to Cebu", catalog))
      .toMatchObject({ intent: "shipping", location: "Visayas" });
    expect(understandFromRules("How much is the shipping fee in other places outside Metro Manila?", catalog))
      .toMatchObject({ intent: "shipping", product_query: null, location: null });
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

  it("extracts Tagalog and English quantity words for catalog items", () => {
    const examples: Array<[string, number]> = [
      ["isa", 1], ["isang", 1], ["one", 1],
      ["dalawa", 2], ["dalawang", 2], ["two", 2],
      ["tatlo", 3], ["tatlong", 3], ["three", 3],
      ["apat", 4], ["apat na", 4], ["four", 4], ["lima", 5], ["limang", 5], ["five", 5],
      ["anim", 6], ["six", 6], ["pito", 7], ["seven", 7],
      ["walo", 8], ["eight", 8], ["siyam", 9], ["nine", 9],
      ["sampu", 10], ["ten", 10], ["labing isang", 11], ["eleven", 11],
      ["labing dalawa", 12], ["twelve", 12], ["dalawampu", 20], ["twenty", 20],
    ];
    for (const [word, quantity] of examples) {
      expect(understandFromRules(`magkano po ${word} medium t-shirt`, catalog).quantity)
        .toBe(quantity);
    }
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

  it("recognizes natural and reordered size-chart requests", () => {
    for (const message of [
      "Meron po ba kayong picture ng size chart?",
      "Can I see the/your size chart?",
      "Pwede pong makita ang catalog size chart",
      "Avail po ba yung chart size?",
      "See Size Chart",
    ]) {
      expect(understandFromRules(message, catalog).intent).toBe("size_chart");
    }
  });

  it("recognizes acknowledgement replies with casing, repeated letters, and common typos", () => {
    for (const message of [
      "ok", "ok ok", "okok", "okay", "okayy", "sure", "suree", "sige", "sge", "sgee",
      "okay sigee", "ok sige", "sure, no problem", "sige po", "no problem", "thank you",
    ]) {
      expect(isAcknowledgement(message)).toBe(true);
    }
    expect(isAcknowledgement("okay, how much is the shirt?")).toBe(false);
  });

  it("recognizes questions about the seller's availability time", () => {
    for (const message of [
      "what time po kaya sya avail?",
      "mga what time po kaya siya available?",
      "what time po kayo available?",
    ]) {
      expect(understandFromRules(message, catalog).intent).toBe("seller_availability");
    }
  });
});
