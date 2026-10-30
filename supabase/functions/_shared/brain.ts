import {
  matchCatalogLocation,
  matchCatalogSize,
  matchQuantityAnswer,
  resolveProduct,
  understandFromRules,
  type CatalogProduct,
  type Understanding,
} from "./rules.ts";
import { quote, type QuotePromo } from "./quote.ts";

export type BrainVariant = { id: string; size: string; stock: number };
export type BrainProduct = CatalogProduct & {
  id: string;
  description: string;
  price: number;
  active: boolean;
  discount_type: "percent" | "fixed" | null;
  discount_value: number | null;
  discount_starts: string | null;
  discount_ends: string | null;
  variants: BrainVariant[];
  promos: QuotePromo[];
};
export type BrainPending = Record<string, unknown> & {
  order?: Record<string, unknown>;
  clarification?: Record<string, unknown>;
};
export type BrainInput = {
  message: string;
  aiMode: "auto" | "suggest" | "human";
  status: "open" | "needs_seller" | "resolved";
  firstContact: boolean;
  pending: BrainPending;
  products: BrainProduct[];
  settings: {
    shipping_rates: Record<string, number>;
    payment_instructions: string;
    policies: string;
  };
  latestOrder?: {
    id: number;
    total: number;
    status: string;
    shipping: number;
    created_at: string;
  } | null;
  now?: Date;
};
export type BrainResult = {
  action: "none" | "reply" | "draft" | "confirm_order";
  reply: string | null;
  pending: BrainPending;
  needsSeller: boolean;
  missedRequest: boolean;
  quotedPriceMatches: boolean | null;
  orderToConfirm?: Record<string, unknown>;
};
export type BrainRules = {
  understand: typeof understandFromRules;
};

const defaultRules: BrainRules = { understand: understandFromRules };
const disclosure =
  "Automated assistant po ito ng shop. I-type ang SELLER para makausap ang seller.";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function peso(value: number): string {
  return (
    "₱" +
    value.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function regionFor(location: string | null): string | null {
  const value = (location ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    /\b(metro manila|ncr|manila|quezon city|makati|taguig|pasig|pasay|paranaque|caloocan|marikina|mandaluyong|muntinlupa|las pinas|malabon|navotas|san juan|pateros|valenzuela)\b/.test(
      value,
    )
  )
    return "Metro Manila";
  if (
    /\b(luzon|batanes|cagayan|isabela|pampanga|bulacan|cavite|laguna|batangas|bicol|baguio|ilocos)\b/.test(
      value,
    )
  )
    return "Luzon";
  if (
    /\b(visayas|cebu|bohol|iloilo|negros|leyte|samar|bacolod|dumaguete|ormoc)\b/.test(
      value,
    )
  )
    return "Visayas";
  if (
    /\b(mindanao|davao|cagayan de oro|zamboanga|general santos|gensan|butuan|cotabato)\b/.test(
      value,
    )
  )
    return "Mindanao";
  return null;
}

export function runIncomingBrain(
  input: BrainInput,
  rules: BrainRules = defaultRules,
): BrainResult {
  const base: BrainResult = {
    action: "none",
    reply: null,
    pending: input.pending,
    needsSeller: false,
    missedRequest: false,
    quotedPriceMatches: null,
  };
  if (input.aiMode === "human") return base;

  const sellerRequest = /^\s*(seller|\/seller)\s*$/i.test(input.message);
  const escalate = (text: string): BrainResult => ({
    ...base,
    action: input.aiMode === "suggest" ? "draft" : "reply",
    reply: text + (input.firstContact ? " " + disclosure : ""),
    needsSeller: true,
    missedRequest: true,
  });
  if (sellerRequest) {
    return escalate(
      "Sige po, ipapa-check ko ito sa seller. Makaka-follow up po siya rito.",
    );
  }

  const clarification = record(input.pending.clarification);
  const activePending: BrainPending = { ...input.pending };
  delete activePending.clarification;

  let understanding: Understanding;
  try {
    const summary = input.products
      .filter((product) => product.active)
      .map(({ name, aliases, variants }) => ({
        name,
        aliases,
        sizes: variants.map((variant) => variant.size),
      }));
    understanding = rules.understand(input.message, summary);
  } catch {
    console.warn("[reply-rules] could not classify incoming message", {
      failure: "rule_evaluation_error",
    });
    return escalate("I-check ko muna ito sa seller po.");
  }
  const clarificationProduct = input.products.find((item) =>
    item.active && item.id === clarification.product_id
  );
  if (clarification.kind === "product" && Array.isArray(clarification.candidates)) {
    const candidates = input.products.filter((item) => item.active &&
      (clarification.candidates as unknown[]).includes(item.name));
    const selected = resolveProduct(input.message, candidates);
    if (selected.status === "matched" && typeof clarification.intent === "string") {
      understanding = {
        intent: clarification.intent as Understanding["intent"],
        product_query: selected.product.name,
        size: typeof clarification.size === "string" ? clarification.size : null,
        quantity: typeof clarification.quantity === "number" ? clarification.quantity : null,
        quantities_mentioned: [],
        location: typeof clarification.location === "string" ? clarification.location : null,
        confidence: 0.95,
      };
    }
  }
  if (clarificationProduct && typeof clarification.intent === "string") {
    const kind = clarification.kind;
    const intent = clarification.intent as Understanding["intent"];
    const common = {
      intent, product_query: clarificationProduct.name, confidence: 0.95,
      quantities_mentioned: [] as number[],
    };
    if (kind === "size") {
      const size = matchCatalogSize(input.message, clarificationProduct.variants.map((v) => v.size));
      if (size) understanding = { ...common, size, quantity: Number(clarification.quantity) || null, location: typeof clarification.location === "string" ? clarification.location : null };
    } else if (kind === "quantity") {
      const quantity = matchQuantityAnswer(input.message);
      if (quantity) understanding = { ...common, size: typeof clarification.size === "string" ? clarification.size : null, quantity, quantities_mentioned: [quantity], location: typeof clarification.location === "string" ? clarification.location : null };
    } else if (kind === "location") {
      const location = matchCatalogLocation(input.message);
      if (location) understanding = { ...common, size: typeof clarification.size === "string" ? clarification.size : null, quantity: Number(clarification.quantity) || 1, location };
    }
  }
  if (clarification.kind && understanding.confidence < 0.6) {
    const prompt = clarification.kind === "size"
      ? "Anong size po ang gusto ninyo? Available sizes po ay " +
        (clarificationProduct?.variants.map((item) => item.size).join(", ") ?? "") + "."
      : clarification.kind === "quantity"
        ? "Ilang piraso po ang gusto ninyong kunin?"
        : clarification.kind === "location"
          ? "Anong area po kayo: Metro Manila, Luzon, Visayas, o Mindanao?"
          : "Alin po rito ang tinutukoy ninyo: " +
            (Array.isArray(clarification.candidates) ? clarification.candidates.join(" o ") : "") + "?";
    return {
      ...base,
      action: input.aiMode === "suggest" ? "draft" : "reply",
      reply: prompt + (input.firstContact ? " " + disclosure : ""),
      pending: input.pending,
    };
  }
  if (understanding.intent === "unknown" || understanding.confidence < 0.6) {
    console.info("[reply-rules] seller escalation", {
      failure: "unrecognized_message",
      intent: understanding.intent,
      confidence: understanding.confidence,
      catalog_count: input.products.filter((product) => product.active).length,
      product_query_present: Boolean(understanding.product_query),
    });
    return escalate("I-check ko muna ito sa seller po.");
  }
  if (["complaint", "other"].includes(understanding.intent)) {
    return escalate("Pasensya na po. I-check ko muna ito sa seller.");
  }
  if (
    input.pending.order &&
    understanding.intent === "order_confirm" &&
    /\b(sige|order na|confirm|yes|oo|go na|kuha ko na)\b/i.test(input.message)
  ) {
    return {
      ...base,
      action: "confirm_order",
      reply: null,
      orderToConfirm: record(input.pending.order),
      pending: input.pending,
    };
  }

  const respond = (
    facts: Record<string, unknown>,
    template: string,
    pending = activePending,
  ): BrainResult => {
    let text = template;
    if (input.firstContact) text += " " + disclosure;
    return {
      ...base,
      action: input.aiMode === "suggest" ? "draft" : "reply",
      reply: text,
      pending,
      quotedPriceMatches:
        typeof facts.quote_total === "number" &&
        facts.quote_total === facts.expected_quote_total,
    };
  };

  if (understanding.intent === "greeting") {
    return respond(
      { greeting: true, automated_assistant: true },
      "Hello po! Ano pong item ang gusto ninyong itanong?",
    );
  }
  if (understanding.intent === "order_help") {
    return respond(
      { order_help: true },
      "Para mag-order po, sabihin ang item, size, quantity, at delivery area. Iche-check ko ang stock at total bago ko hingin ang confirmation.",
    );
  }
  if (understanding.intent === "payment") {
    if (!input.settings.payment_instructions.trim())
      return escalate(
        "Wala pa po akong payment instructions. I-check ko muna sa seller po.",
      );
    return respond(
      { payment_instructions: input.settings.payment_instructions },
      "Payment instructions po: " + input.settings.payment_instructions,
    );
  }
  if (understanding.intent === "status") {
    if (!input.latestOrder)
      return escalate(
        "Wala pa po akong mahanap na order record. I-check ko muna sa seller po.",
      );
    const total = Number(input.latestOrder.total);
    const statusLabel =
      input.latestOrder.status === "awaiting_payment"
        ? "awaiting payment"
        : input.latestOrder.status;
    return respond(
      {
        order_id: input.latestOrder.id,
        status: statusLabel,
        total,
        amounts: [total],
      },
      "Order #" +
        input.latestOrder.id +
        " po ay " +
        statusLabel +
        ". Total: " +
        peso(total) +
        ".",
    );
  }
  if (understanding.intent === "shipping") {
    const region = regionFor(understanding.location);
    const rate = region ? input.settings.shipping_rates[region] : undefined;
    if (typeof rate !== "number") {
      if (!region && input.settings.shipping_rates["Metro Manila"] === undefined &&
        input.settings.shipping_rates.Luzon === undefined &&
        input.settings.shipping_rates.Visayas === undefined &&
        input.settings.shipping_rates.Mindanao === undefined) {
        return escalate("Hindi ko makita ang shipping rates. I-check ko muna sa seller po.");
      }
      if (region)
        return escalate(
          "Hindi ko makita ang shipping rate para sa area na ito. I-check ko muna sa seller po.",
        );
      return respond(
        { shipping_regions: Object.keys(input.settings.shipping_rates) },
        "Anong area po kayo: Metro Manila, Luzon, Visayas, o Mindanao?",
        { ...activePending, clarification: { kind: "location", intent: "shipping" } },
      );
    }
    if (input.pending.order) {
      const oldOrder = record(input.pending.order);
      const order: Record<string, unknown> = {
        ...oldOrder,
        region,
        shipping: rate,
        shipping_known: true,
      };
      order.total =
        Math.round(
          ((Number(oldOrder.subtotal) || 0) + rate + Number.EPSILON) * 100,
        ) / 100;
      const amounts = [
        rate,
        Number(order.subtotal),
        Number(order.total),
      ].filter(Number.isFinite);
      return respond(
        {
          product: oldOrder.product_name,
          size: oldOrder.size,
          quantity: oldOrder.quantity,
          region,
          shipping: rate,
          total: order.total,
          amounts,
        },
        "Shipping to " +
          region +
          " po ay " +
          peso(rate) +
          ". Total po ay " +
          peso(Number(order.total)) +
          ". I-confirm po ba ang order?",
        { ...activePending, order },
      );
    }
    return respond(
      { region, shipping: rate, amounts: [rate] },
      "Shipping to " + region + " po ay " + peso(rate) + ".",
    );
  }

  const resolution = resolveProduct(
    understanding.product_query,
    input.products.filter((product) => product.active),
  );
  if (resolution.status === "ambiguous") {
    const names = resolution.candidates.map((product) => product.name);
    return respond(
      { candidates: names },
      "Alin po rito ang tinutukoy ninyo: " + names.join(" o ") + "?",
      { ...activePending, clarification: { kind: "product", candidates: resolution.candidates.map((item) => item.name), intent: understanding.intent, size: understanding.size, quantity: understanding.quantity, location: understanding.location } },
    );
  }
  if (resolution.status === "not_found") {
    console.info("[reply-rules] product not matched", {
      catalog_count: input.products.filter((item) => item.active).length,
      product_query_present: Boolean(understanding.product_query),
    });
    if (!understanding.product_query)
      return respond(
        { need_product: true },
        "Aling item po ang gusto ninyong itanong?",
      );
    return escalate(
      "Hindi ko makita ang item na iyan sa catalog. I-check ko muna sa seller po.",
    );
  }
  const product = resolution.product;
  const sizes = product.variants.map((variant) => variant.size);
  const chosenSize = understanding.size;
  if (chosenSize && !sizes.includes(chosenSize)) {
    return respond(
      { product: product.name, available_sizes: sizes },
      "Available sizes po ay " +
        sizes.join(", ") +
        ". Anong size po ang gusto ninyo?",
      { ...activePending, clarification: { kind: "size", product_id: product.id, intent: understanding.intent, quantity: understanding.quantity, location: understanding.location } },
    );
  }
  const size = chosenSize ?? (sizes.length === 1 ? sizes[0] : null);
  if (
    !size && sizes.length > 1 &&
    ["price", "availability", "order_confirm", "question"].includes(understanding.intent)
  ) {
    return respond(
      { product: product.name, available_sizes: sizes },
      "Anong size po ang gusto ninyo? Available sizes po ay " + sizes.join(", ") + ".",
      { ...activePending, clarification: { kind: "size", product_id: product.id, intent: understanding.intent, quantity: understanding.quantity, location: understanding.location } },
    );
  }
  if (
    understanding.quantities_mentioned.length > 1 &&
    understanding.quantity === null
  ) {
    return respond(
      {
        product: product.name,
        quantities_mentioned: understanding.quantities_mentioned,
      },
      "Ilang piraso po ang gusto ninyong kunin?",
      { ...activePending, clarification: { kind: "quantity", product_id: product.id, intent: understanding.intent, size, location: understanding.location } },
    );
  }

  const quantity = understanding.quantity ?? 1;
  const variant = size
    ? product.variants.find((item) => item.size === size)
    : product.variants[0];
  if (!variant)
    return escalate("I-check ko muna ang available sizes sa seller po.");
  if (variant.stock < quantity) {
    return respond(
      {
        product: product.name,
        size: variant.size,
        requested: quantity,
        stock: variant.stock,
      },
      variant.stock === 0
        ? "Pasensya na po, sold out ang " +
            product.name +
            " (" +
            variant.size +
            "). I-check ko kung may alternative sa seller po."
        : "May " +
            variant.stock +
            " " +
            variant.size +
            " pa po ng " +
            product.name +
            "; " +
            quantity +
            " ang hinahanap ninyo. Ilan po ang gusto ninyong kunin?",
    );
  }

  const now = input.now ?? new Date();
  const pricing = quote(product, quantity, now, product.promos);
  const region = regionFor(understanding.location);
  const shipping = region ? input.settings.shipping_rates[region] : undefined;
  if (region && typeof shipping !== "number") {
    return escalate(
      "Hindi ko makita ang shipping rate para sa " + region + ". I-check ko muna sa seller po.",
    );
  }
  const shippingAmount = typeof shipping === "number" ? shipping : 0;
  const total =
    Math.round((pricing.total + shippingAmount + Number.EPSILON) * 100) / 100;
  const orderIntent = understanding.intent === "order_confirm";
  const order = {
    product_id: product.id,
    product_name: product.name,
    variant_id: variant.id,
    size: variant.size,
    quantity,
    unit_price: pricing.unit,
    subtotal: pricing.total,
    shipping: shippingAmount,
    region,
    shipping_known: typeof shipping === "number",
    total,
    offer_label: pricing.label,
  };
  const pending: BrainPending = orderIntent
    ? { ...input.pending, order }
    : activePending;
  const amounts = [
    pricing.unit,
    pricing.total,
    pricing.subtotal,
    pricing.saved,
  ];
  if (typeof shipping === "number") amounts.push(shipping, total);
  const facts = {
    intent: understanding.intent,
    product: product.name,
    description: product.description,
    size: variant.size,
    quantity,
    stock: variant.stock,
    subtotal: pricing.total,
    unit_price: pricing.unit,
    shipping: typeof shipping === "number" ? shipping : null,
    shipping_region: region,
    total: typeof shipping === "number" ? total : null,
    offer: pricing.label,
    amounts,
    quote_total: pricing.total,
    expected_quote_total: quote(product, quantity, now, product.promos).total,
  };
  const amountSummary =
    typeof shipping === "number"
      ? "Subtotal po ay " +
        peso(pricing.total) +
        " at shipping " +
        peso(shipping) +
        ", total " +
        peso(total) +
        "."
      : "Subtotal po ay " +
        peso(pricing.total) +
        ". Sabihin po ang area ninyo para makuha ang shipping at total.";
  const template = orderIntent
    ? product.name +
      " (" +
      variant.size +
      ") x" +
      quantity +
      ": " +
      amountSummary +
      " I-confirm po ba ang order?"
    : understanding.intent === "availability"
      ? "Available po ang " +
        product.name +
        " (" +
        variant.size +
        "); may " +
        variant.stock +
        " stock. " +
        amountSummary
      : product.name + " (" + variant.size + ") po: " + amountSummary;

  const responsePending = typeof shipping === "number" ? pending : {
    ...pending,
    clarification: { kind: "location", product_id: product.id, intent: understanding.intent, size: variant.size, quantity, location: null },
  };
  return respond(facts, template, responsePending);
}
