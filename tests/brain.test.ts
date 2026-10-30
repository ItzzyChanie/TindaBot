import { describe, expect, it, vi } from "vitest";
import { labelAutoReply, runIncomingBrain, type BrainRules, type BrainInput, type BrainProduct } from "../supabase/functions/_shared/brain";
import type { Understanding } from "../supabase/functions/_shared/rules";

const product: BrainProduct = {
  id: "product-1",
  name: "Isla Linen Top",
  aliases: ["Isla blouse"],
  description: "Linen top",
  price: 33.33,
  active: true,
  discount_type: null,
  discount_value: null,
  discount_starts: null,
  discount_ends: null,
  variants: [
    { id: "variant-s", size: "S", stock: 5 },
    { id: "variant-m", size: "M", stock: 0 },
  ],
  promos: [],
};

const baseInput: BrainInput = {
  message: "How much is Isla blouse, size S, 3 pcs?",
  aiMode: "auto",
  status: "open",
  firstContact: false,
  pending: {},
  products: [product],
  settings: {
    shipping_rates: { Visayas: 75 },
    payment_instructions: "Mock bank transfer instructions",
    policies: "Mock policies",
  },
  now: new Date("2026-10-29T00:00:00.000Z"),
};

function understanding(overrides: Partial<Understanding> = {}): Understanding {
  return {
    intent: "price",
    product_query: "Isla blouse",
    size: "S",
    quantity: 3,
    quantities_mentioned: [3],
    location: "Cebu",
    confidence: 0.95,
    ...overrides,
  };
}

function ai(result: Understanding): BrainRules {
  return {
    understand: vi.fn(() => result),
  };
}

describe("grounded incoming conversation brain", () => {
  it("labels automatic replies and leaves non-auto replies unchanged", () => {
    expect(labelAutoReply("Hello po", "auto")).toBe("Hello po\n— Assistant");
    expect(labelAutoReply("Hello po", "suggest")).toBe("Hello po");
  });

  it("welcomes customers on /start only in Auto mode and explains seller handoff", async () => {
    const automatic = await runIncomingBrain({ ...baseInput, message: "/start", firstContact: true });
    expect(automatic.reply).toContain("automated assistant");
    expect(automatic.reply).toContain("/seller");
    expect(automatic.action).toBe("reply");

    const human = await runIncomingBrain({ ...baseInput, message: "/start", aiMode: "human" });
    expect(human.reply).toBeNull();
    expect(human.action).toBe("none");
  });

  it("uses quote output in its deterministic price reply", async () => {
    const provider = ai(understanding());
    const result = await runIncomingBrain(baseInput, provider);

    expect(result.action).toBe("reply");
    expect(result.reply).toContain("₱99.99");
    expect(result.quotedPriceMatches).toBe(true);
  });

  it("handles a new customer question even while the conversation awaits the seller", async () => {
    const provider = ai(understanding());
    const result = await runIncomingBrain(
      { ...baseInput, status: "needs_seller" },
      provider,
    );

    expect(provider.understand).toHaveBeenCalledOnce();
    expect(result.reply).toContain("99.99");
  });

  it("includes Metro Manila delivery for Malabon in the quote", async () => {
    const provider = ai(understanding({ quantity: 2, location: "Malabon" }));
    const result = await runIncomingBrain({
      ...baseInput,
      settings: {
        ...baseInput.settings,
        shipping_rates: { ...baseInput.settings.shipping_rates, "Metro Manila": 80 },
      },
    }, provider);

    expect(result.reply).toContain("146.66");
    expect(result.quotedPriceMatches).toBe(true);
  });

  it("quotes the requested t-shirt quantity, size, and Malabon delivery from catalog facts", async () => {
    const tShirt: BrainProduct = {
      ...product,
      id: "bayanihan-tee",
      name: "Bayanihan Basic T-Shirt",
      aliases: ["t-shirt", "basic tee", "cotton t-shirt"],
      price: 450,
      variants: [{ id: "bayanihan-tee-m", size: "M", stock: 12 }],
    };
    const result = await runIncomingBrain({
      ...baseInput,
      message: "magkano po 2 medium t-shirt, pa-deliver sa malabon",
      products: [tShirt],
      settings: {
        ...baseInput.settings,
        shipping_rates: { "Metro Manila": 80 },
      },
    });

    expect(result.reply).toContain("980.00");
    expect(result.quotedPriceMatches).toBe(true);
  });

  it("keeps product context so a typoed size and later delivery area complete the quote", async () => {
    const tee: BrainProduct = {
      ...product, id: "tee", name: "Bayanihan Basic T-Shirt", aliases: ["t-shirt"], price: 450,
      variants: [
        { id: "tee-s", size: "S", stock: 4 },
        { id: "tee-m", size: "M", stock: 8 },
        { id: "tee-l", size: "L", stock: 3 },
      ],
    };
    const first = await runIncomingBrain({
      ...baseInput, message: "Pabili po 2 t-shirt?", products: [tee],
      settings: { ...baseInput.settings, shipping_rates: { "Metro Manila": 80 } },
    });
    expect(first.reply).toContain("Anong size po");
    expect(first.pending.clarification).toMatchObject({ kind: "size", product_id: "tee", quantity: 2 });

    const sized = await runIncomingBrain({
      ...baseInput, message: "meduim po", products: [tee], pending: first.pending,
      settings: { ...baseInput.settings, shipping_rates: { "Metro Manila": 80 } },
    });
    expect(sized.reply).toContain("900.00");
    expect(sized.pending.clarification).toMatchObject({ kind: "location", size: "M", quantity: 2 });

    const delivered = await runIncomingBrain({
      ...baseInput, message: "Malabon po", products: [tee], pending: sized.pending,
      settings: { ...baseInput.settings, shipping_rates: { "Metro Manila": 80 } },
    });
    expect(delivered.reply).toContain("980.00");
    expect(delivered.pending.clarification).toBeUndefined();
  });

  it("matches an FAQ size question to any catalog product the customer names", async () => {
    const tee: BrainProduct = {
      ...product, id: "tee", name: "Bayanihan Basic T-Shirt", aliases: ["t-shirt"], price: 450,
      variants: [
        { id: "tee-s", size: "S", stock: 4 },
        { id: "tee-m", size: "M", stock: 8 },
        { id: "tee-l", size: "L", stock: 0 },
      ],
    };
    const faq = await runIncomingBrain({ ...baseInput, message: "Anong sizes ang available?", products: [tee] });
    expect(faq.reply).toContain("Aling item");
    const answer = await runIncomingBrain({
      ...baseInput, message: "bayanihan basic tshirt po", products: [tee], pending: faq.pending,
    });
    expect(answer.reply).toContain("S: 4 available");
    expect(answer.reply).toContain("M: 8 available");
    expect(answer.reply).toContain("L: sold out");
  });

  it("answers the price FAQ with Metro Manila shipping for a selected catalog item", async () => {
    const tee: BrainProduct = {
      ...product, id: "tee", name: "Bayanihan Basic T-Shirt", aliases: ["t-shirt"], price: 450,
      variants: [{ id: "tee-m", size: "M", stock: 8 }],
    };
    const faq = await runIncomingBrain({ ...baseInput, message: "Magkano po ito?", products: [tee], settings: { ...baseInput.settings, shipping_rates: { "Metro Manila": 80 } } });
    expect(faq.reply).toContain("Aling item");
    const answer = await runIncomingBrain({
      ...baseInput, message: "bayanihan basic tshirt po", products: [tee], pending: faq.pending,
      settings: { ...baseInput.settings, shipping_rates: { "Metro Manila": 80 } },
    });
    expect(answer.reply).toContain("450.00");
    expect(answer.reply).toContain("80.00");
    expect(answer.reply).toContain("530.00");
  });

  it("asks the customer to choose when two catalog products share t-shirt", async () => {
    const duplicate: BrainProduct = {
      ...product,
      id: "other-tee",
      name: "Amihan Cotton Tee",
      aliases: ["t-shirt"],
      variants: [{ id: "other-tee-m", size: "M", stock: 4 }],
    };
    const result = await runIncomingBrain({
      ...baseInput,
      message: "Magkano po ang 2 medium t-shirt, pa-deliver sa Malabon?",
      products: [
        {
          ...product,
          id: "bayanihan-tee",
          name: "Bayanihan Basic T-Shirt",
          aliases: ["t-shirt"],
          price: 450,
          variants: [{ id: "bayanihan-tee-m", size: "M", stock: 12 }],
        },
        duplicate,
      ],
    });

    expect(result.needsSeller).toBe(false);
    expect(result.reply).toContain("Bayanihan Basic T-Shirt");
    expect(result.reply).toContain("Amihan Cotton Tee");
    expect(result.reply).not.toContain("I-check ko muna");
  });

  it("escalates when a known delivery region has no configured shipping rate", async () => {
    const tee: BrainProduct = {
      ...product,
      name: "Bayanihan Basic T-Shirt",
      aliases: ["t-shirt"],
      price: 450,
      variants: [{ id: "tee-m", size: "M", stock: 12 }],
    };
    const result = await runIncomingBrain({
      ...baseInput,
      message: "Magkano po ang 2 medium t-shirt, pa-deliver sa Malabon?",
      products: [tee],
      settings: { ...baseInput.settings, shipping_rates: {} },
    });

    expect(result.needsSeller).toBe(true);
    expect(result.reply).toContain("shipping rate");
    expect(result.reply).not.toContain("900.00");
  });

  it("always replies with the code-computed quote amount", async () => {
    const provider = ai(understanding());
    const result = await runIncomingBrain(baseInput, provider);

    expect(result.reply).toContain("₱99.99");
  });

  it("returns a saved draft action in suggest mode", async () => {
    const provider = ai(understanding());
    const result = await runIncomingBrain({ ...baseInput, aiMode: "suggest" }, provider);

    expect(result.action).toBe("draft");
    expect(result.reply).toContain("₱99.99");
    expect(result.needsSeller).toBe(false);
  });

  it("escalates low-confidence and complaint messages without generating a reply", async () => {
    for (const intent of [understanding({ confidence: 0.4 }), understanding({ intent: "complaint" })]) {
      const provider = ai(intent);
      const result = await runIncomingBrain(baseInput, provider);
      expect(result.needsSeller).toBe(true);
      expect(result.missedRequest).toBe(true);
    }
  });

  it("does not run automatic rules in human mode", async () => {
    const provider = ai(understanding());
    const result = await runIncomingBrain({ ...baseInput, aiMode: "human" }, provider);

    expect(result.action).toBe("none");
    expect(provider.understand).not.toHaveBeenCalled();
  });

  it("lists per-size availability and stock when the customer asks what sizes are available", async () => {
    const provider = ai(understanding({ intent: "availability", size: null }));
    const result = await runIncomingBrain(baseInput, provider);

    expect(result.reply).toContain("S: 5 available");
    expect(result.reply).toContain("M: sold out");
  });

  it("stores an order proposal and marks a later confirmation for atomic order creation", async () => {
    const initial = await runIncomingBrain(
      { ...baseInput, message: "I want to order Isla blouse size S, 2 pcs", pending: {} },
      ai(understanding({ intent: "order_confirm", quantity: 2, quantities_mentioned: [2] })),
    );
    expect(initial.pending.order).toMatchObject({ variant_id: "variant-s", quantity: 2, subtotal: 66.66 });

    const confirmation = await runIncomingBrain(
      { ...baseInput, message: "Sige po", pending: initial.pending },
      ai(understanding({ intent: "order_confirm", product_query: null, size: null, quantity: null, quantities_mentioned: [] })),
    );
    expect(confirmation.action).toBe("confirm_order");
    expect(confirmation.orderToConfirm).toEqual(initial.pending.order);
  });

  it("includes an automated-assistant disclosure on first contact", async () => {
    const result = await runIncomingBrain({ ...baseInput, message: "hello", firstContact: true }, ai(understanding({ intent: "greeting", product_query: null, size: null, quantity: null, quantities_mentioned: [] })));
    expect(result.reply).toContain("Automated assistant");
    expect(result.reply).toContain("SELLER");
  });

  it("answers order status from the saved order facts", async () => {
    const result = await runIncomingBrain(
      { ...baseInput, message: "Nasaan na order ko?", latestOrder: { id: 1042, total: 174.99, shipping: 75, status: "paid", created_at: "2026-10-29T00:00:00Z" } },
      ai(understanding({ intent: "status", product_query: null, size: null, quantity: null, quantities_mentioned: [] })),
    );
    expect(result.reply).toContain("Order #1042");
    expect(result.reply).toContain("₱174.99");
  });

});
