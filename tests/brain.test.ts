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

  it("does not claim an unchecked payment method is accepted", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "COD pwede?",
      settings: { ...baseInput.settings, bot_options: { payment_methods: ["GCash"] } },
    }, ai(understanding({ intent: "payment", product_query: null, size: null, quantity: null, quantities_mentioned: [] })));
    expect(result.reply).toContain("wala pa pong Cash on Delivery");
    expect(result.reply).toContain("GCash");
  });

  it("uses the courier selections from settings", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "Which courier do you use?",
      settings: { ...baseInput.settings, bot_options: { couriers: ["J&T", "LBC"] } },
    });
    expect(result.reply).toContain("J&T, LBC");
  });

  it("answers store location and business-hours questions from settings", async () => {
    const settings = { ...baseInput.settings, bot_options: { address: "Mock address, Cebu", business_hours: "Mon-Sat, 9AM-6PM" } };
    const address = await runIncomingBrain({ ...baseInput, message: "May physical store ba?", settings });
    const hours = await runIncomingBrain({ ...baseInput, message: "What are your business hours?", settings });
    expect(address.reply).toContain("Mock address, Cebu");
    expect(hours.reply).toContain("Mon-Sat, 9AM-6PM");
  });

  it("answers after-sales policy questions according to enabled settings", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "What is your refund policy?",
      settings: { ...baseInput.settings, bot_options: { after_sales: { refund: true }, refund_policy: "Mock refund policy, within 7 days." } },
    });
    expect(result.reply).toContain("Mock refund policy, within 7 days.");
    expect(result.needsSeller).toBe(false);
  });

  it("quotes configured regional delivery estimates", async () => {
    const result = await runIncomingBrain({
      ...baseInput,
      message: "How long is delivery to Cebu?",
      settings: { ...baseInput.settings, bot_options: { delivery_days: { Visayas: "4-7 days" }, processing_days: 2 } },
    });
    expect(result.reply).toContain("4-7 days");
    expect(result.reply).toContain("within 2 day(s)");
  });

  it("routes unavailable product facts and seller-only requests to a logged handoff", async () => {
    for (const message of ["Anong material po?", "May actual photos po?", "May ibang color pa?", "Restock kailan?", "Paano mag-reseller?", "May reviews po?"]) {
      const result = await runIncomingBrain({ ...baseInput, message });
      expect(result.action).toBe("reply");
      expect(result.needsSeller).toBe(true);
      expect(result.missedRequest).toBe(true);
      expect(result.reply).toContain("seller");
    }
    const english = await runIncomingBrain({ ...baseInput, message: "What material is this?" });
    expect(english.reply).toContain("I’ll pass your question");
  });

  it("recognizes PM and MP shorthand price questions and bargaining", async () => {
    for (const message of ["PM price", "MP"]) {
      const result = await runIncomingBrain({ ...baseInput, message });
      expect(result.reply).toContain("Aling item");
    }
    const bargaining = await runIncomingBrain({ ...baseInput, message: "Pwede po ba tawad?" });
    expect(bargaining.reply).toContain("Fixed price");
    const namedItem = await runIncomingBrain({ ...baseInput, message: "May discount sa Isla blouse?" });
    expect(namedItem.reply).toContain("Isla Linen Top");
    expect(namedItem.reply).toContain("33.33");
  });

  it("answers ship-out and same-day questions only from enabled settings", async () => {
    const shipOut = await runIncomingBrain({ ...baseInput, message: "Kailan po ship out?", settings: { ...baseInput.settings, bot_options: { processing_days: 2 } } });
    expect(shipOut.reply).toContain("within 2 day(s)");
    const unavailable = await runIncomingBrain({ ...baseInput, message: "Same-day delivery po?", settings: { ...baseInput.settings, bot_options: { couriers: ["J&T"] } } });
    expect(unavailable.reply).toContain("wala pong naka-enable");
    const available = await runIncomingBrain({ ...baseInput, message: "Same-day delivery po?", settings: { ...baseInput.settings, bot_options: { couriers: ["Lalamove"] } } });
    expect(available.reply).toContain("Lalamove");
  });

  it("answers explicit free-shipping and named-courier questions from settings", async () => {
    const threshold = await runIncomingBrain({ ...baseInput, message: "Is there free shipping?", settings: { ...baseInput.settings, bot_options: { free_shipping_minimum: 500 } } });
    expect(threshold.reply).toContain("500.00");
    const disabled = await runIncomingBrain({ ...baseInput, message: "Free shipping?", settings: { ...baseInput.settings, bot_options: { free_shipping_minimum: 0 } } });
    expect(disabled.reply).toContain("Wala pa pong free shipping");
    const couriers = await runIncomingBrain({ ...baseInput, message: "Saan po kayo nag-ship? J&T? LBC? Flash?", settings: { ...baseInput.settings, bot_options: { couriers: ["J&T", "LBC", "Flash Express"] } } });
    expect(couriers.reply).toContain("J&T, LBC, Flash Express");
  });

  it("hands tracking number requests to the seller instead of inventing tracking data", async () => {
    const result = await runIncomingBrain({ ...baseInput, message: "Tracking number po?" });
    expect(result.needsSeller).toBe(true);
    expect(result.missedRequest).toBe(true);
    expect(result.reply).toContain("tracking number");
  });

  it("answers product details only when seller-entered catalog facts exist", async () => {
    const productFacts: BrainProduct = {
      ...product,
      colors: ["Black", "Sage"],
      material: "Cotton poplin",
      fabric_details: "Medium weight, opaque, with slight stretch.",
      fit_notes: "Relaxed fit; runs true to size.",
      size_guidance: "M fits 5'2-5'4 and 50-58 kg.",
      restock_note: "Expected around the second week of November.",
      model_details: "Model is 5'5, 52 kg, wearing size M.",
    };
    const cases: Array<[string, string]> = [
      ["What material is the Isla blouse?", "Cotton poplin"],
      ["May ibang color pa itong Isla blouse?", "Black, Sage"],
      ["True to size ba ang Isla blouse?", "Relaxed fit; runs true to size."],
      ["Anong size fit sa akin, 5'3 55kg? Isla blouse", "M fits 5'2-5'4 and 50-58 kg."],
      ["Restock kailan ang Isla blouse?", "second week of November"],
      ["Sino model ng Isla blouse?", "Model is 5'5"],
    ];
    for (const [message, expected] of cases) {
      const result = await runIncomingBrain({ ...baseInput, message, products: [productFacts] });
      expect(result.needsSeller).toBe(false);
      expect(result.reply).toContain(expected);
    }
  });

  it("shares only photos that the seller marked as actual", async () => {
    const actualProduct = {
      ...product,
      image_url: "https://images.example.com/front.jpg",
      additional_images: ["https://images.example.com/back.jpg"],
      photos_are_actual: true,
    };
    const actual = await runIncomingBrain({ ...baseInput, message: "May actual photos itong Isla blouse?", products: [actualProduct] });
    expect(actual.needsSeller).toBe(false);
    expect(actual.imageUrls).toEqual([actualProduct.image_url, ...actualProduct.additional_images]);
    const unverified = await runIncomingBrain({ ...baseInput, message: "May actual photos itong Isla blouse?", products: [{ ...actualProduct, photos_are_actual: false }] });
    expect(unverified.needsSeller).toBe(true);
  });

  it("continues the chat when the customer answers a sizing follow-up with yes", async () => {
    const fittedProduct = { ...product, fit_notes: "Height: 5'9, weight: 58 kg." };
    const answer = await runIncomingBrain({
      ...baseInput,
      message: "True to size ba po ang Isla blouse?",
      products: [fittedProduct],
    });
    expect(answer.pending.clarification).toMatchObject({ kind: "engagement" });
    const yes = await runIncomingBrain({
      ...baseInput,
      message: "yes",
      products: [fittedProduct],
      pending: answer.pending,
    });
    expect(yes.needsSeller).toBe(false);
    expect(yes.reply).toContain("Ano pa pong gusto ninyong malaman");
  });

  it("accepts a selected color as the answer to the bot's color question", async () => {
    const coloredProduct = { ...product, colors: ["Brown", "Beige", "White"] };
    const question = await runIncomingBrain({
      ...baseInput,
      message: "Anong color po ang available?",
      contextProductId: coloredProduct.id,
      products: [coloredProduct],
    });
    expect(question.pending.clarification).toMatchObject({ kind: "color", product_id: coloredProduct.id });
    const answer = await runIncomingBrain({
      ...baseInput,
      message: "brown po",
      products: [coloredProduct],
      pending: question.pending,
    });
    expect(answer.needsSeller).toBe(false);
    expect(answer.reply).toContain("Noted po, Brown");
  });

  it("uses the selected product's active catalog discount instead of calling it fixed price", async () => {
    const discountedProduct = {
      ...product,
      discount_type: "percent" as const,
      discount_value: 50,
      discount_starts: null,
      discount_ends: null,
    };
    const result = await runIncomingBrain({
      ...baseInput,
      message: "May discount po ba?",
      contextProductId: discountedProduct.id,
      products: [discountedProduct],
    });
    expect(result.reply).toContain("50% off");
    expect(result.reply).not.toContain("Fixed price");
    expect(result.reply).toContain("16.67");
  });

  it("escalates complaints for missing or incorrect deliveries", async () => {
    for (const message of ["Missing item po", "Iba po ang dumating", "May sira po yung item"]) {
      const result = await runIncomingBrain({ ...baseInput, message });
      expect(result.needsSeller).toBe(true);
      expect(result.missedRequest).toBe(true);
    }
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
