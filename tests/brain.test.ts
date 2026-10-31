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
    size_chart_url: null,
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

  it("welcomes customers on /start only in Auto mode and explains basic help and commands", async () => {
    const automatic = await runIncomingBrain({ ...baseInput, message: "/start", firstContact: true });
    expect(automatic.reply).toContain("automated assistant");
    expect(automatic.reply).toContain("basic questions");
    expect(automatic.reply).toContain("/assistant");
    expect(automatic.reply).toContain("/seller");
    expect(automatic.action).toBe("reply");

    const human = await runIncomingBrain({ ...baseInput, message: "/start", aiMode: "human" });
    expect(human.reply).toBeNull();
    expect(human.action).toBe("none");
  });

  it("includes quote-based product details in a Telegram product deep-link welcome", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "/start product_10000000-0000-4000-8000-000000000009",
      firstContact: true,
      contextProductId: product.id,
    });
    expect(result.reply).toContain(product.name);
    expect(result.reply).toContain("₱33.33");
    expect(result.reply).toContain("Available sizes: S");
  });

  it("uses the linked product for a short follow-up price question", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "magkano po ito?",
      contextProductId: product.id,
    }, ai(understanding({ product_query: null, confidence: 0.85 })));

    expect(result.reply).toContain(product.name);
    expect(result.reply).toContain("₱99.99");
  });

  it("answers deictic availability questions using the linked shop item", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "Is this available po?",
      contextProductId: product.id,
    });

    expect(result.reply).toContain(product.name);
    expect(result.reply).toContain("available");
    expect(result.needsSeller).toBe(false);
  });

  it("uses the shop-selected item and Tagalog quantity words for short price follow-ups", async () => {
    const examples: Array<[string, number, string]> = [
      ["How much po sa tatlo?", 3, "99.99"],
      ["Magkano po dito kapag tatlo?", 3, "99.99"],
      ["magkano po sa apat?", 4, "133.32"],
    ];
    for (const [message, quantity, subtotal] of examples) {
      const result = await runIncomingBrain({
        ...baseInput,
        message,
        contextProductId: product.id,
      });

      expect(result.reply).toContain(product.name);
      expect(result.reply).toContain(`x${quantity}`);
      expect(result.reply).toContain(subtotal);
      expect(result.needsSeller).toBe(false);
    }
  });

  it("prefers the selected shop item over a mistaken deictic product phrase", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "Is this available po?",
      contextProductId: product.id,
    }, ai(understanding({ intent: "availability", product_query: "this", confidence: 0.95 })));

    expect(result.reply).toContain(product.name);
    expect(result.needsSeller).toBe(false);
  });

  it("lists configured shipping rates outside Metro Manila", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "sa ibang lugar po? how much?",
      settings: {
        ...baseInput.settings,
        shipping_rates: { "Metro Manila": 80, Luzon: 120, Visayas: 150, Mindanao: 180 },
      },
    });

    expect(result.reply).toContain("outside Metro Manila");
    expect(result.reply).toContain("Luzon ₱120.00");
    expect(result.reply).toContain("Visayas ₱150.00");
    expect(result.reply).not.toContain("Metro Manila ₱80.00");
    expect(result.needsSeller).toBe(false);
  });

  it("returns to assistant mode on /assistant and clears the handoff wait", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "/assistant",
      pending: { seller_handoff: true, last_product: { product_id: product.id } },
    });
    expect(result.reply).toContain("Assistant mode na po tayo ulit");
    expect(result.reply).toContain("/seller");
    expect(result.pending.seller_handoff).toBeUndefined();
    expect(result.pending.last_product).toEqual({ product_id: product.id });
    expect(result.clearSellerHandoff).toBe(true);
  });

  it("uses quote output in its deterministic price reply", async () => {
    const provider = ai(understanding());
    const result = await runIncomingBrain(baseInput, provider);

    expect(result.action).toBe("reply");
    expect(result.reply).toContain("₱99.99");
    expect(result.quotedPriceMatches).toBe(true);
  });

  it("uses the supported-topics escalation for unrecognized messages", async () => {
    const result = await runIncomingBrain(
      baseInput,
      ai(understanding({ intent: "unknown", product_query: null, confidence: 0.2 })),
    );

    expect(result.reply).toContain("I-check ko muna ito sa seller po");
    expect(result.reply).toContain("presyo, size at stock, shipping, bayad, at order status");
    expect(result.needsSeller).toBe(true);
    expect(result.missedRequest).toBe(true);
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

  it("explains that an unlisted item is not in the catalog and flags it for the seller", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "hm po ba yung denim jacket?",
      products: [product],
    });
    expect(result.needsSeller).toBe(true);
    expect(result.missedRequest).toBe(true);
    expect(result.reply).toContain("denim jacket");
    expect(result.reply).toContain("catalog ng shop");
    expect(result.reply).toContain("seller");
  });

  it("stores seller handoff and stays silent on acknowledgement messages", async () => {
    const handoff = await runIncomingBrain({ ...baseInput, message: "/seller" });
    expect(handoff.reply).toContain("Naipasa na po kayo sa seller");
    expect(handoff.pending.seller_handoff).toBe(true);

    for (const message of ["ok", "okayy", "okok", "sgee", "okay sigee", "sure no problem"]) {
      const result = await runIncomingBrain({
        ...baseInput,
        message,
        pending: handoff.pending,
      });
      expect(result.action).toBe("none");
      expect(result.reply).toBeNull();
      expect(result.pending.seller_handoff).toBe(true);
    }
  });

  it("continues answering new questions during seller handoff", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "hm Isla blouse?",
      pending: { seller_handoff: true },
    });
    expect(result.action).toBe("reply");
    expect(result.reply).toContain("Isla Linen Top");
    expect(result.pending.seller_handoff).toBe(true);
  });

  it("explains that the assistant cannot know the seller's schedule", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "mga what time po kaya sya avail?",
      pending: { seller_handoff: true },
    });
    expect(result.reply).toContain("I don't know what exact day or time");
    expect(result.needsSeller).toBe(true);
    expect(result.missedRequest).toBe(true);
    expect(result.pending.seller_handoff).toBe(true);

    const thanks = await runIncomingBrain({
      ...baseInput,
      message: "okayy",
      pending: result.pending,
    });
    expect(thanks.action).toBe("none");
    expect(thanks.reply).toBeNull();
  });

  it("lists all active catalog items with their current offer, sizes, and stock", async () => {
    const second: BrainProduct = {
      ...product,
      id: "second-product",
      name: "Habi Ribbed Tank Top",
      aliases: ["tank top"],
      price: 120,
      variants: [
        { id: "tank-s", size: "S", stock: 2 },
        { id: "tank-m", size: "M", stock: 0 },
      ],
    };
    const result = await runIncomingBrain({
      ...baseInput,
      message: "What items are available?",
      products: [product, second],
    });
    expect(result.reply).toContain("Isla Linen Top");
    expect(result.reply).toContain("Habi Ribbed Tank Top");
    expect(result.reply).toContain("S (5 available)");
    expect(result.reply).toContain("M (sold out)");
    expect(result.reply).toContain("33.33");
    expect(result.reply).toContain("120.00");
  });

  it("attaches the seller's uploaded size chart to a matching customer request", async () => {
    const chartUrl = "https://storage.example.com/size-chart.webp";
    const result = await runIncomingBrain({
      ...baseInput,
      message: "Pwede pong makita ang chart size?",
      settings: { ...baseInput.settings, size_chart_url: chartUrl },
    });
    expect(result.reply).toContain("size chart");
    expect(result.imageUrl).toBe(chartUrl);
    expect(result.needsSeller).toBe(false);
  });

  it("escalates a size-chart request when the seller has not uploaded one", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "Can I see the size chart?",
    });
    expect(result.reply).toContain("Wala pa pong uploaded");
    expect(result.needsSeller).toBe(true);
    expect(result.missedRequest).toBe(true);
  });

  it("answers combined size availability and price questions for the requested quantity", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "Isla blouse size S still available and how much for 3 items?",
    });
    expect(result.reply).toContain("3");
    expect(result.reply).toContain("S");
    expect(result.reply).toContain("stock");
    expect(result.reply).toContain("99.99");
  });

  it("lets the customer switch to a different catalog item during follow-up", async () => {
    const tee: BrainProduct = {
      ...product,
      id: "tee",
      name: "Bayanihan Basic T-Shirt",
      aliases: ["t-shirt"],
      price: 450,
      variants: [{ id: "tee-m", size: "M", stock: 5 }],
    };
    const first = await runIncomingBrain({
      ...baseInput,
      message: "Magkano Bayanihan Basic T-Shirt?",
      products: [tee, product],
    });
    const second = await runIncomingBrain({
      ...baseInput,
      message: "hm Isla blouse?",
      products: [tee, product],
      pending: first.pending,
    });
    expect(second.reply).toContain("Isla Linen Top");
    expect(second.reply).toContain("33.33");
    expect(second.reply).not.toContain("450.00");
  });

  it("uses the last mentioned item when a short price follow-up omits its name", async () => {
    const first = await runIncomingBrain({
      ...baseInput,
      message: "Magkano Isla blouse?",
    });
    const followUp = await runIncomingBrain({
      ...baseInput,
      message: "How much for 3 pcs?",
      pending: first.pending,
    });
    expect(followUp.reply).toContain("Isla Linen Top");
    expect(followUp.reply).toContain("x3");
    expect(followUp.reply).toContain("99.99");
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

  it("accepts a shared-alias clarification when the customer repeats an exact product name", async () => {
    const products: BrainProduct[] = [
      {
        ...product,
        id: "plain-tee",
        name: "T-Shirt",
        aliases: ["tee"],
        price: 100,
        variants: [{ id: "plain-tee-m", size: "M", stock: 6 }],
      },
      {
        ...product,
        id: "bayanihan-tee",
        name: "Bayanihan Basic T-Shirt",
        aliases: ["t-shirt"],
        price: 450,
        variants: [{ id: "bayanihan-tee-m", size: "M", stock: 8 }],
      },
    ];
    const question = await runIncomingBrain({
      ...baseInput,
      message: "How much po 2 medium t-shirt?",
      products,
    });
    expect(question.reply).toContain("T-Shirt o Bayanihan Basic T-Shirt");

    const answer = await runIncomingBrain({
      ...baseInput,
      message: "T-shirt",
      products,
      pending: question.pending,
    });
    expect(answer.reply).toContain("T-Shirt (M) x2");
    expect(answer.reply).toContain("200.00");
    expect(answer.reply).not.toContain("Alin po rito");
  });

  it("answers with the full catalog item when the customer gives a generated partial name", async () => {
    const futureProduct: BrainProduct = {
      ...product,
      id: "hiraya-shirt",
      name: "Hiraya Oversized Graphic T-Shirt",
      aliases: [],
      price: 520,
      variants: [{ id: "hiraya-m", size: "M", stock: 7 }],
    };
    const result = await runIncomingBrain({
      ...baseInput,
      message: "Magkano po ang hiraya shirt?",
      products: [futureProduct],
    });

    expect(result.reply).toContain("Hiraya Oversized Graphic T-Shirt");
    expect(result.reply).toContain("520.00");
    expect(result.needsSeller).toBe(false);
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

  it("lists only payment methods enabled in settings", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "What payment methods?",
      settings: { ...baseInput.settings, bot_options: { payment_methods: ["GCash", "Cash on Delivery"] } },
    }, ai(understanding({ intent: "payment", product_query: null, size: null, quantity: null, quantities_mentioned: [] })));
    expect(result.reply).toContain("GCash, Cash on Delivery");
    expect(result.reply).not.toContain("Maya");
  });

  it("uses the courier selections from settings", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "Which courier do you use?",
      settings: { ...baseInput.settings, bot_options: { couriers: ["J&T", "LBC"] } },
    });
    expect(result.reply).toContain("J&T, LBC");
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
