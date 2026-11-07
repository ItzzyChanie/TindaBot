import {
  matchCatalogLocation,
  matchCatalogSize,
  matchQuantityAnswer,
  normalizeMessage,
  isAcknowledgement,
  isThankYou,
  resolveProduct,
  resolveProductChoice,
  understandFromRules,
  type CatalogProduct,
  type Understanding,
} from "./rules.ts";
import { formatOfferDateTime, offerTiming, quote, type QuotePromo } from "./quote.ts";
import {
  isCancellationRequest,
  paymentSafetyMessage,
} from "./order-customer-details.ts";

export type BrainVariant = { id: string; size: string; stock: number; price?: number | null };
export type BrainProduct = CatalogProduct & {
  id: string;
  description: string;
  image_url?: string | null;
  colors?: string[];
  material?: string;
  fabric_details?: string;
  fit_notes?: string;
  size_guidance?: string;
  restock_note?: string;
  model_details?: string;
  photos_are_actual?: boolean;
  additional_images?: string[];
  video_url?: string;
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
  last_product?: Record<string, unknown>;
};
export type BrainInput = {
  message: string;
  replyContextText?: string | null;
  replyPromptText?: string | null;
  replyPriorText?: string | null;
  channel?: string;
  sellerPresent?: boolean;
  contextProductId?: string | null;
  aiMode: "auto" | "suggest" | "human";
  status: "open" | "needs_seller" | "resolved";
  firstContact: boolean;
  pending: BrainPending;
  products: BrainProduct[];
  settings: {
    shipping_rates: Record<string, number>;
    payment_instructions: string;
    policies: string;
    size_chart_url: string | null;
    greeting_text?: string;
    shipping_text?: string;
    faq_answers?: Record<string, string>;
    bot_options?: {
      bulk_orders?: boolean;
      bulk_details?: string;
      payment_methods?: string[];
      other_payment?: string;
      couriers?: string[];
      other_courier?: string;
      free_shipping_minimum?: number;
      processing_days?: number;
      after_sales?: { exchange?: boolean; return?: boolean; refund?: boolean };
      refund_policy?: string;
      address?: string;
      business_hours?: string;
      facebook_page_name?: string;
      facebook_page_url?: string;
      delivery_days?: Record<string, string>;
    };
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
  imageUrl?: string | null;
  imageUrls?: string[];
  clearSellerHandoff?: boolean;
};
export type BrainRules = {
  understand: typeof understandFromRules;
};

const defaultRules: BrainRules = { understand: understandFromRules };
const disclosure =
  "Automated assistant po ito ng shop. I-type ang SELLER para makausap ang seller. Privacy notice: chat messages are retained for 90 days po.";
const unknownMessageReply =
  "I-check ko muna ito sa seller po. Kaya kong tumulong sa presyo, size at stock, shipping, bayad, at order status.";

export function labelAutoReply(
  reply: string,
  aiMode: BrainInput["aiMode"],
): string {
  return aiMode === "auto" ? reply + "\n— Assistant" : reply;
}

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
    .toLowerCase()
    .replace(
      /\b(?:outside|outside of|other than|sa labas ng)\s+(?:the\s+)?metro manila\b/g,
      " ",
    );
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

function replyPromptKind(
  message: string,
): "size" | "quantity" | "location" | null {
  const text = normalizeMessage(message);
  if (
    /\b(?:what|which|anong)\s+size\b/.test(text) &&
    !/\b(?:available|stock|meron|mayroon)\b/.test(text)
  )
    return "size";
  if (
    /\b(?:how many|ilang)\b/.test(text) &&
    /\b(?:pieces?|pcs?|piraso|items?|quantity|qty)\b/.test(text)
  )
    return "quantity";
  if (
    /\b(?:what|which|anong)\s+(?:delivery\s+)?(?:area|location)\b/.test(text) ||
    /\b(?:saan|where)\b.{0,35}\b(?:deliver|delivery|ship|shipping|area|location)\b/.test(
      text,
    )
  )
    return "location";
  return null;
}

function asksOtherAreaShipping(message: string): boolean {
  const normalized = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return /\b(ibang lugar|ibang area|other place|other places|other area|other areas|another area|different area|outside metro manila|outside manila|outside ncr|elsewhere|provincial shipping)\b/.test(
    normalized,
  );
}

function prefersEnglish(message: string): boolean {
  return /\b(what|how|where|when|which|do|does|is|are|can|could|would|please|my|your|the|this|that)\b/i.test(
    message,
  );
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
    return {
      ...escalate(
        "Naipasa na po kayo sa seller. Pakihintay po ng reply rito; maaaring may inaasikaso lang siya ngayon.",
      ),
      pending: { ...input.pending, seller_handoff: true },
    };
  }
  const assistantRequest = /^\s*\/assistant(?:@[a-z0-9_]+)?\s*$/i.test(
    input.message,
  );
  if (assistantRequest) {
    const pending = { ...input.pending };
    delete pending.seller_handoff;
    return {
      ...base,
      action: input.aiMode === "suggest" ? "draft" : "reply",
      reply:
        "Assistant mode na po tayo ulit. Maaari po kayong magtanong tungkol sa presyo, sizes, stock, delivery, products, at paano mag-order. Para kausapin ang seller, mag-type lang po ng /seller.",
      pending,
      clearSellerHandoff: input.pending.seller_handoff === true,
    };
  }
  const endingContext = record(input.pending.clarification);
  const endingPrompt = normalizeMessage(input.replyPromptText ?? "");
  const awaitingCustomerDecision =
    endingContext.kind === "order_interest" ||
    endingContext.kind === "reserve_decision" ||
    /\b(gusto niyo po bang ituloy|sumagot po ng yes|gusto niyo po bang mag order|do you want to reserve|reserve habang available)\b/.test(endingPrompt);
  const contextualShortReply = normalizeMessage(input.message)
    .replace(/\b(po|opo|please|pls)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const contextualNo = /^(no|noo+|nope|hindi|hinde|di|dili|wag|huwag|wag muna|huwag muna|wag na|huwag na|not now|not now muna|not right now|later na lang|mamaya na lang|wala|wla|wala na|wla na|none|nothing|never mind|nevermind|nvm)( muna( ngayon| sa ngayon)?| ngayon| sa ngayon| na lang)?$/.test(contextualShortReply);
  const contextualOkay = /^(ok|okay|okey|oki|okie|noted)$/.test(contextualShortReply);
  if (awaitingCustomerDecision && contextualNo) {
    return {
      ...base,
      action: input.aiMode === "suggest" ? "draft" : "reply",
      reply: "Sige po, noted. Hindi muna natin itutuloy ang reservation. Nandito lang po ako kung gusto ninyong magtanong ulit o mag-reserve sa ibang oras." +
        (input.firstContact ? " " + disclosure : ""),
      pending: { ...input.pending, order: undefined, clarification: undefined },
    };
  }
  if (awaitingCustomerDecision && (contextualOkay || isThankYou(input.message))) {
    return {
      ...base,
      pending: { ...input.pending, order: undefined, clarification: undefined },
    };
  }
  if (isThankYou(input.message) && awaitingCustomerDecision) {
    return {
      ...base,
      pending: { ...input.pending, order: undefined, clarification: undefined },
    };
  }
  if (isThankYou(input.message)) {
    return {
      ...base,
      action: input.aiMode === "suggest" ? "draft" : "reply",
      reply:
        "You're welcome po! Thank you din po for asking/message us. Balik lang po kayo if may gusto pa po kayong itanong." +
        (input.firstContact ? " " + disclosure : ""),
      pending: input.pending,
    };
  }
  const clarification = record(input.pending.clarification);
  if (
    input.pending.seller_handoff === true &&
    !clarification.kind &&
    !input.pending.order &&
    isAcknowledgement(input.message)
  ) {
    return base;
  }
  if (/^\s*\/start(?:@[a-z0-9_]+)?(?:\s+.*)?\s*$/i.test(input.message)) {
    if (input.aiMode !== "auto") return base;
    const contextProduct = input.products.find(
      (product) => product.active && product.id === input.contextProductId,
    );
    const productWelcome = contextProduct
      ? (() => {
          const sizes = contextProduct.variants
            .filter((variant) => variant.stock > 0)
            .map((variant) => {
              const pricing = quote(contextProduct, 1, input.now ?? new Date(), contextProduct.promos, variant.price);
              return variant.size + " — " + peso(pricing.unit);
            });
          return ` Tungkol sa ${contextProduct.name}. Available sizes: ${sizes.length ? sizes.join(", ") : "sold out po lahat sa ngayon"}.`;
        })()
      : "";
    return {
      ...base,
      action: "reply",
      reply:
        ((input.settings.greeting_text ?? "").trim() || "Kumusta po!") +
        " Ako ang automated assistant ng shop." +
        productWelcome +
        " Maaari akong sumagot ng basic questions tungkol sa catalog items, presyo, sizes at stock, shipping, payment, at paano mag-order. Mag-type ng /assistant para magpatuloy sa assistant o /seller para makausap ang seller; kapag nag-switch po kayo sa seller, pakihintay ang reply niya rito. Privacy notice: chat messages are retained for 90 days po.",
    };
  }

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
    return escalate(unknownMessageReply);
  }
  const activeProducts = input.products.filter((product) => product.active);
  const replyProductResolution = input.replyContextText
    ? resolveProduct(input.replyContextText, activeProducts)
    : { status: "not_found" as const, candidates: [] };
  const replyContextProduct =
    replyProductResolution.status === "matched"
      ? (replyProductResolution.product as BrainProduct)
      : null;
  const contextProduct =
    input.products.find(
      (product) => product.active && product.id === input.contextProductId,
    ) ?? replyContextProduct;
  let lastProductContext = record(input.pending.last_product);
  const lastProduct = input.products.find(
    (item) => item.active && item.id === lastProductContext.product_id,
  );
  let deferredReplySize: string | null = null;
  if (
    !clarification.kind &&
    understanding.intent === "unknown" &&
    input.replyPromptText
  ) {
    const promptKind = replyPromptKind(input.replyPromptText);
    if (promptKind === "size") {
      const size = matchCatalogSize(
        input.message,
        contextProduct?.variants.map((item) => item.size) ?? [
          "XXS",
          "XS",
          "S",
          "M",
          "L",
          "XL",
          "XXL",
          "XXXL",
          "One Size",
        ],
      );
      if (size) {
        understanding = {
          ...understanding,
          intent: "availability",
          product_query: null,
          size,
          confidence: 0.95,
        };
        if (!contextProduct) deferredReplySize = size;
      }
    } else if (promptKind === "quantity") {
      const quantity = matchQuantityAnswer(input.message);
      if (quantity !== null && quantity > 0 && quantity <= 100) {
        understanding = {
          ...understanding,
          intent: "availability",
          product_query: null,
          quantity,
          quantities_mentioned: [quantity],
          size: contextProduct
            ? matchCatalogSize(
                input.replyPriorText ?? "",
                contextProduct.variants.map((item) => item.size),
              )
            : null,
          confidence: 0.95,
        };
      }
    } else if (promptKind === "location") {
      const location = matchCatalogLocation(input.message);
      if (location)
        understanding = {
          ...understanding,
          intent: "shipping",
          product_query: null,
          location,
          confidence: 0.95,
        };
    }
  }
  const refersToSelectedProduct =
    /\b(this|that|it|these|those|ito|dito|nito|iyan|diyan|iyon|yun|dun|yung item|item na ito)\b/i.test(
      input.message
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    );
  if (
    (contextProduct || lastProduct || understanding.intent === "discount") &&
    ["price", "discount", "discount_timing", "future_discount"].includes(understanding.intent) &&
    understanding.quantities_mentioned.length === 0
  ) {
    const quantity = matchQuantityAnswer(input.message);
    if (quantity !== null) {
      understanding = {
        ...understanding,
        quantity,
        quantities_mentioned: [quantity],
      };
    }
  }
  if (
    contextProduct &&
    (!understanding.product_query || refersToSelectedProduct) &&
    [
      "price",
      "discount",
      "discount_timing",
      "future_discount",
      "availability",
      "question",
      "order_confirm",
      "seller_handoff",
    ].includes(understanding.intent)
  ) {
    const hasLastProductContext =
      lastProductContext.product_id === contextProduct.id;
    understanding = {
      ...understanding,
      product_query: contextProduct.name,
      size:
        understanding.size ??
        (hasLastProductContext && typeof lastProductContext.size === "string"
          ? lastProductContext.size
          : null),
      quantity:
        understanding.quantity ??
        (hasLastProductContext &&
        typeof lastProductContext.quantity === "number"
          ? lastProductContext.quantity
          : null),
      location:
        understanding.location ??
        (hasLastProductContext &&
        typeof lastProductContext.location === "string"
          ? lastProductContext.location
          : null),
      confidence: Math.max(understanding.confidence, 0.9),
    };
  }
  const clarificationProduct = input.products.find(
    (item) => item.active && item.id === clarification.product_id,
  );
  let clarifiedProduct: BrainProduct | null = null;
  if (
    clarification.kind === "product" &&
    Array.isArray(clarification.candidates)
  ) {
    const candidates = input.products.filter(
      (item) =>
        item.active &&
        (clarification.candidates as unknown[]).includes(item.name),
    );
    const selected = resolveProductChoice(input.message, candidates);
    if (
      selected.status === "matched" &&
      typeof clarification.intent === "string" &&
      (understanding.intent === "unknown" ||
        understanding.intent === "question")
    ) {
      clarifiedProduct = selected.product;
      understanding = {
        intent: clarification.intent as Understanding["intent"],
        product_query: selected.product.name,
        size:
          typeof clarification.size === "string"
            ? clarification.size
            : typeof clarification.size_answer === "string"
              ? matchCatalogSize(
                  clarification.size_answer,
                  selected.product.variants.map((item) => item.size),
                )
              : null,
        quantity:
          typeof clarification.quantity === "number"
            ? clarification.quantity
            : null,
        quantities_mentioned:
          typeof clarification.quantity === "number"
            ? [clarification.quantity]
            : [],
        location:
          typeof clarification.location === "string"
            ? clarification.location
            : null,
        confidence: 0.95,
      };
    }
  }
  if (
    clarification.kind === "location" &&
    clarification.intent === "shipping" &&
    understanding.intent === "unknown"
  ) {
    const location = matchCatalogLocation(input.message);
    if (location)
      understanding = {
        ...understanding,
        intent: "shipping",
        location,
        confidence: 0.95,
      };
  }
  if (
    clarificationProduct &&
    typeof clarification.intent === "string" &&
    understanding.intent === "unknown"
  ) {
    const kind = clarification.kind;
    const intent = clarification.intent as Understanding["intent"];
    const common = {
      intent,
      product_query: clarificationProduct.name,
      confidence: 0.95,
      quantities_mentioned: [] as number[],
    };
    if (kind === "size") {
      const size = matchCatalogSize(
        input.message,
        clarificationProduct.variants.map((v) => v.size),
      );
      if (size) {
        clarifiedProduct = clarificationProduct;
        understanding = {
          ...common,
          size,
          quantity: Number(clarification.quantity) || null,
          location:
            typeof clarification.location === "string"
              ? clarification.location
              : null,
        };
      }
    } else if (kind === "quantity") {
      const quantity = matchQuantityAnswer(input.message);
      if (quantity) {
        clarifiedProduct = clarificationProduct;
        understanding = {
          ...common,
          size:
            typeof clarification.size === "string" ? clarification.size : null,
          quantity,
          quantities_mentioned: [quantity],
          location:
            typeof clarification.location === "string"
              ? clarification.location
              : null,
        };
      }
    } else if (kind === "location") {
      const location = matchCatalogLocation(input.message);
      if (location) {
        clarifiedProduct = clarificationProduct;
        understanding = {
          ...common,
          size:
            typeof clarification.size === "string" ? clarification.size : null,
          quantity: Number(clarification.quantity) || 1,
          location,
          availability_requested: clarification.availability_requested === true,
        };
      }
    }
  }
  if (
    lastProduct &&
    !understanding.product_query &&
    [
      "price",
      "discount",
      "discount_timing",
      "future_discount",
      "availability",
      "question",
      "order_confirm",
      "seller_handoff",
    ].includes(understanding.intent)
  ) {
    understanding = {
      ...understanding,
      product_query: lastProduct.name,
      size:
        understanding.size ??
        (typeof lastProductContext.size === "string"
          ? lastProductContext.size
          : null),
      quantity:
        understanding.quantity ??
        (typeof lastProductContext.quantity === "number"
          ? lastProductContext.quantity
          : null),
      location:
        understanding.location ??
        (typeof lastProductContext.location === "string"
          ? lastProductContext.location
          : null),
    };
  }
  const normalizedShortReply = normalizeMessage(input.message)
    .replace(/\b(po|opo|please|pls)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const isYes =
    /^(yes|yeah|yep|yup|oo|opo|sige|ge|g|go|okay|ok|sure|please do)$/.test(
      normalizedShortReply,
    );
  const isNo =
    /^(no|noo+|nope|hindi|hinde|di|dili|wag|huwag|wag muna|huwag muna|wag na|huwag na|not now|not now muna|not right now|later na lang|mamaya na lang|wala|wla|wala na|wla na|none|nothing|never mind|nevermind|nvm)( muna( ngayon| sa ngayon)?| ngayon| sa ngayon| na lang)?$/.test(
      normalizedShortReply,
    );
  const isCancel = isCancellationRequest(input.message);
  const continueReply = (reply: string, pending: BrainPending): BrainResult => {
    const nextPending = { ...pending };
    delete nextPending.seller_handoff;
    return {
      ...base,
      action: input.aiMode === "suggest" ? "draft" : "reply",
      reply: reply + (input.firstContact ? " " + disclosure : ""),
      pending: nextPending,
      clearSellerHandoff:
        input.status === "needs_seller" ||
        input.pending.seller_handoff === true,
    };
  };
  const shortEndingAcknowledgement = /^(ok|okay|okey|oki|okie|noted)$/.test(
    normalizedShortReply,
  );
  if (awaitingCustomerDecision && shortEndingAcknowledgement) {
    return {
      ...base,
      pending: { ...activePending, order: undefined, clarification: undefined },
    };
  }
  if (
    isCancel &&
    (input.pending.order ||
      clarification.kind === "order_interest" ||
      clarification.intent === "order_confirm")
  ) {
    return continueReply(
      "Sige po, kinansela ko ang pending order bago ma-confirm. Wala pang stock na na-reserve o order na nailista.",
      { ...activePending, order: undefined, clarification: undefined },
    );
  }
  if (isCancel) {
    if (!input.latestOrder) {
      return continueReply(
        "Wala po akong nakikitang confirmed order na puwedeng i-cancel. Kung may pending order quote kayo, sabihin lang po kung hindi na itutuloy.",
        activePending,
      );
    }
    const pageName = input.settings.bot_options?.facebook_page_name?.trim();
    const pageUrl = input.settings.bot_options?.facebook_page_url?.trim();
    const directMessage =
      pageUrl && /^https:\/\//i.test(pageUrl)
        ? " Pwede rin po kayong mag-message sa Facebook page na " +
          (pageName || "shop page") +
          ": " +
          pageUrl +
          " at ilagay ang order #" +
          input.latestOrder.id +
          "."
        : " Pakihintay po ang seller dito sa chat.";
    return continueReply(
      "Naka-confirm na po ang order #" +
        input.latestOrder.id +
        ", kaya hindi na ito makakansela ng bot. Pakihintay po ang seller para matulungan kayo." +
        directMessage,
      activePending,
    );
  }
  if (input.pending.order && isYes) {
    return {
      ...base,
      action: "confirm_order",
      reply: null,
      orderToConfirm: record(input.pending.order),
      pending: input.pending,
    };
  }
  if (input.pending.order && isNo) {
    return continueReply(
      "Okay po, hindi ko itutuloy ang order. Nandito lang po ako kung may iba pa kayong tanong.",
      { ...activePending, order: undefined, clarification: undefined },
    );
  }
  if (
    (clarification.kind === "order_interest" && isYes) ||
    (clarification.kind === "engagement" && isNo)
  ) {
    const followupProduct = input.products.find(
      (item) => item.active && item.id === clarification.product_id,
    );
    if (followupProduct) {
      clarifiedProduct = followupProduct;
      understanding = {
        ...understanding,
        intent: "order_confirm",
        product_query: followupProduct.name,
        confidence: 0.95,
      };
      lastProductContext = {
        ...lastProductContext,
        product_id: followupProduct.id,
      };
      activePending.last_product = lastProductContext;
    }
  } else if (clarification.kind === "engagement" && isYes) {
    return continueReply(
      "Sige po! Ano pa pong gusto ninyong malaman tungkol sa item?",
      {
        ...activePending,
        clarification: {
          kind: "engagement",
          product_id: clarification.product_id,
        },
      },
    );
  } else if (clarification.kind === "engagement" && isNo) {
    const followupProduct = input.products.find(
      (item) => item.active && item.id === clarification.product_id,
    );
    if (followupProduct) {
      clarifiedProduct = followupProduct;
      understanding = {
        ...understanding,
        intent: "order_confirm",
        product_query: followupProduct.name,
        confidence: 0.95,
      };
      lastProductContext = {
        ...lastProductContext,
        product_id: followupProduct.id,
      };
      activePending.last_product = lastProductContext;
    } else {
      return continueReply(
        "Okay po. Nandito lang po kami kung may iba pa kayong tanong.",
        activePending,
      );
    }
  } else if (clarification.kind === "order_interest" && isNo) {
    return continueReply(
      "Okay po. Nandito lang po kami kung may iba pa kayong tanong.",
      { ...activePending, clarification: undefined },
    );
  }
  if (clarification.kind === "color" && clarificationProduct) {
    const colors = Array.isArray(clarification.colors)
      ? clarification.colors.filter(
          (color): color is string => typeof color === "string",
        )
      : (clarificationProduct.colors ?? []);
    const normalizedColorReply = normalizedShortReply
      .replace(/\b(color|colour|kulay|yung|ang|the|want|gusto|ko|sana)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const selectedColor = colors.find(
      (color) => normalizeMessage(color) === normalizedColorReply,
    );
    if (selectedColor) {
      const pending: BrainPending = {
        ...activePending,
        last_product: {
          ...lastProductContext,
          product_id: clarificationProduct.id,
          color: selectedColor,
        },
        clarification: {
          kind: "order_interest",
          product_id: clarificationProduct.id,
          topic: "color",
        },
      };
      return continueReply(
        "Noted po, " + selectedColor + ". Gusto niyo po bang mag-order?",
        pending,
      );
    }
    if (
      understanding.intent === "unknown" &&
      normalizedShortReply.split(" ").length <= 2
    ) {
      return continueReply(
        "Available colors po: " +
          colors.join(", ") +
          ". Aling color po ang gusto ninyo?",
        input.pending,
      );
    }
  }
  if (clarification.kind && understanding.confidence < 0.6) {
    const prompt =
      clarification.kind === "size"
        ? "Anong size po ang gusto ninyo? Available sizes po ay " +
          (clarificationProduct?.variants.map((item) => item.size).join(", ") ??
            "") +
          "."
        : clarification.kind === "quantity"
          ? "Ilang piraso po ang gusto ninyong kunin?"
          : clarification.kind === "location"
            ? "Anong area po kayo: Metro Manila, Luzon, Visayas, o Mindanao?"
            : "Alin po rito ang tinutukoy ninyo: " +
              (Array.isArray(clarification.candidates)
                ? clarification.candidates.join(" o ")
                : "") +
              "?";
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
    return escalate(unknownMessageReply);
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

  if (understanding.item_questions && understanding.item_questions.length > 1) {
    const now = input.now ?? new Date();
    const details: string[] = [];
    const combinedTotals: number[] = [];
    const sizesNeededForTotal: string[] = [];
    const products = understanding.item_questions.map((question) => {
      const product = activeProducts.find((item) => item.name === question.product_query);
      if (!product) return null;
      const variants = question.size
        ? product.variants.filter((variant) => variant.size === question.size)
        : product.variants;
      if (!variants.length) return null;
      const quantity = question.quantity ?? 1;
      const parts: string[] = [];
      if (question.asks_availability) {
        const stock = variants.map((variant) =>
          variant.size + ": " +
          (variant.stock > 0 ? variant.stock + " available" : "sold out"),
        );
        parts.push(
          question.size
            ? "size " + question.size + " has " + stock[0].split(": ")[1] + " po"
            : "sizes/stock: " + stock.join(", "),
        );
      }
      if (question.asks_price) {
        const prices = variants.map((variant) => {
          const pricing = quote(product, quantity, now, product.promos, variant.price);
          const total = pricing.total;
          return {
            pricing,
            label: variant.size + " x" + quantity + " = " + peso(total) + " subtotal",
          };
        });
        parts.push("presyo: " + prices.map((item) => item.label).join("; "));
        if (prices.length === 1) combinedTotals.push(prices[0].pricing.total);
        else sizesNeededForTotal.push(product.name);
      }
      return { product, question, quantity, variants, prices: parts, description: parts.join("; ") };
    });
    if (products.some((item) => item === null)) {
      return escalate("May item o size po akong hindi ma-match nang sigurado sa catalog. Ipa-check ko muna sa seller po.");
    }
    for (const item of products) {
      if (item && item.description) details.push(item.product.name + " — " + item.description + ".");
    }
    if (understanding.total_requested) {
      if (sizesNeededForTotal.length === 0 && combinedTotals.length > 1) {
        const combined = Math.round((combinedTotals.reduce((sum, amount) => sum + amount, 0) + Number.EPSILON) * 100) / 100;
        details.push("Pinagsamang subtotal po ay " + peso(combined) + ".");
      } else if (sizesNeededForTotal.length) {
        details.push("Para makuha ang pinagsamang total, pakisabi po ang size ng " + sizesNeededForTotal.join(" at ") + ".");
      }
    }
    return respond(
      {
        products: products.map((item) => ({
          product: item?.product.name,
          size: item?.question.size,
          quantity: item?.quantity,
          availability: item?.question.asks_availability,
          price: item?.question.asks_price,
        })),
        total_requested: understanding.total_requested === true,
      },
      details.join(" "),
    );
  }

  if (understanding.intent === "greeting") {
    return respond(
      { greeting: true, automated_assistant: true },
      (input.settings.greeting_text ?? "").trim() ||
        "Hello po! Ano pong item ang gusto ninyong itanong?",
    );
  }
  if (understanding.intent === "seller_availability") {
    return {
      ...escalate(
        "Magcha-chat po si seller dito sa lalong madaling panahon. Salamat po sa paghihintay.",
      ),
      pending: { ...input.pending, seller_handoff: true },
    };
  }
  if (understanding.intent === "seller_handoff") {
    const message = input.message.toLowerCase();
    const resolution = resolveProduct(
      understanding.product_query,
      input.products.filter((item) => item.active),
    );
    const product =
      resolution.status === "matched"
        ? (resolution.product as BrainProduct)
        : !understanding.product_query
          ? (contextProduct ?? lastProduct ?? null)
          : null;
    const detailPending: BrainPending = {
      ...activePending,
      clarification: { kind: "engagement", product_id: product?.id ?? null },
    };
    const dataReply = (
      facts: Record<string, unknown>,
      value: string,
      englishPrompt: string,
      taglishPrompt: string,
      pending = detailPending,
    ) =>
      respond(
        facts,
        `${value} ${prefersEnglish(input.message) ? englishPrompt : taglishPrompt}`,
        pending,
      );
    if (
      product &&
      /quality|matibay|tibay|durable|long lasting|pangmatagalan/.test(message)
    ) {
      const qualityFacts = [
        ...(product.material?.trim()
          ? ["Material: " + product.material.trim()]
          : []),
        ...(product.fabric_details?.trim()
          ? ["Fabric details: " + product.fabric_details.trim()]
          : []),
        ...(product.description?.trim()
          ? ["Catalog description: " + product.description.trim().slice(0, 400)]
          : []),
      ];
      if (qualityFacts.length) {
        const reply = prefersEnglish(input.message)
          ? `The seller's catalog lists these details for ${product.name}: ${qualityFacts.join("; ")}. I can't independently verify product quality, so please confirm any concerns with the seller.`
          : `Sa catalog po ng ${product.name}, nakalista ang: ${qualityFacts.join("; ")}. Hindi ko po mave-verify nang independent ang quality, kaya paki-confirm po sa seller kung may concern kayo.`;
        return dataReply(
          {
            product: product.name,
            catalog_quality_facts: qualityFacts,
            quality_independently_verified: false,
          },
          reply,
          "Would you like to ask the seller anything else about this item?",
          "May iba pa po ba kayong gustong itanong sa seller tungkol sa item?",
        );
      }
    }
    if (product && /restock/.test(message) && product.restock_note?.trim())
      return dataReply(
        { product: product.name, restock_note: product.restock_note },
        product.restock_note.trim(),
        "Would you like help with anything else about this item?",
        "May iba pa po ba kayong gustong malaman tungkol sa item?",
      );
    if (
      product &&
      /color|kulay/.test(message) &&
      (product.colors?.length ?? 0) > 0
    )
      return dataReply(
        { product: product.name, colors: product.colors },
        prefersEnglish(input.message)
          ? "Available colors: " + product.colors!.join(", ") + "."
          : "Available colors po: " + product.colors!.join(", ") + ".",
        "Which color would you like?",
        "Aling color po ang gusto ninyo?",
        {
          ...activePending,
          clarification: {
            kind: "color",
            product_id: product.id,
            colors: product.colors,
          },
        },
      );
    if (product && /size|fit|height|weight|true to size/.test(message)) {
      const asksMeasurementGuidance =
        /height|weight|recommend|fit sa akin|what size would fit|\d+\s*(?:kg|cm|ft|feet|lbs|lb)\b|\d+\s*['’]\s*\d+/.test(
          message,
        );
      const guidance = asksMeasurementGuidance
        ? product.size_guidance?.trim() || product.fit_notes?.trim()
        : product.fit_notes?.trim() || product.size_guidance?.trim();
      if (guidance)
        return dataReply(
          { product: product.name, size_guidance: guidance },
          guidance,
          "Would you like help with anything else about sizing?",
          "May iba pa po ba kayong gustong malaman tungkol sa sizing?",
        );
    }
    if (
      product &&
      /material|fabric|see.?through|stretch|thick|makapal|manipis/.test(message)
    ) {
      const details = [
        ...(/material|fabric/.test(message) && product.material?.trim()
          ? [product.material.trim()]
          : []),
        ...(/see.?through|stretch|thick|makapal|manipis/.test(message) &&
        product.fabric_details?.trim()
          ? [product.fabric_details.trim()]
          : []),
      ];
      const askedForMaterial = /material|fabric/.test(message);
      const askedForFabricDetails =
        /see.?through|stretch|thick|makapal|manipis/.test(message);
      if (
        details.length &&
        (!askedForMaterial || Boolean(product.material?.trim())) &&
        (!askedForFabricDetails || Boolean(product.fabric_details?.trim()))
      )
        return dataReply(
          {
            product: product.name,
            material: product.material,
            fabric_details: product.fabric_details,
          },
          details.join(" "),
          "Is there anything else about this item I can help with?",
          "May iba pa po ba kayong tanong tungkol sa item?",
        );
    }
    if (
      product &&
      /model|height of the model/.test(message) &&
      product.model_details?.trim()
    )
      return dataReply(
        { product: product.name, model_details: product.model_details },
        product.model_details.trim(),
        "Would you like help with anything else about this item?",
        "May iba pa po ba kayong gustong malaman tungkol sa item?",
      );
    if (product && /video/.test(message) && product.video_url?.trim()) {
      const videoUrl = product.video_url.trim();
      if (/^https:\/\//i.test(videoUrl)) {
        const reply = prefersEnglish(input.message)
          ? `Product video: ${videoUrl}. Would you like to see anything else?`
          : "Narito po ang product video: " +
            videoUrl +
            ". May iba pa po ba kayong gustong makita?";
        return {
          ...respond(
            { product: product.name, video_url: videoUrl },
            reply,
            detailPending,
          ),
          imageUrls: [],
        };
      }
    }
    if (
      product &&
      /photo|picture|actual image|same as picture/.test(message) &&
      product.photos_are_actual
    ) {
      const images = [product.image_url, ...(product.additional_images ?? [])]
        .filter(
          (url): url is string =>
            typeof url === "string" && /^https:\/\//i.test(url),
        )
        .slice(0, 5);
      if (images.length) {
        const reply =
          (prefersEnglish(input.message)
            ? "These are seller-confirmed actual product photos: "
            : "Narito po ang actual product photos: ") +
          images.join("\n") +
          (prefersEnglish(input.message)
            ? " Would you like to see anything else?"
            : "\nMay iba pa po ba kayong gustong makita?");
        return {
          ...respond(
            {
              product: product.name,
              photos_are_actual: true,
              image_count: images.length,
            },
            reply,
            detailPending,
          ),
          imageUrls: images,
        };
      }
    }
    const reason = /restock/.test(message)
      ? "restock timing"
      : /color/.test(message)
        ? "available colors"
        : /quality|matibay|tibay|durable|long lasting|pangmatagalan/.test(
              message,
            )
          ? "product quality details"
          : /material|fabric|see.?through|stretch|thick|makapal|manipis/.test(
                message,
              )
            ? "fabric and product details"
            : /size|fit|height|weight|true to size/.test(message)
              ? "size recommendations"
              : /photo|picture|video|model/.test(message)
                ? "actual photos or model details"
                : /review|feedback|legit|scam/.test(message)
                  ? "shop verification and reviews"
                  : /resell|drop.?ship/.test(message)
                    ? "reseller or dropshipping requests"
                    : "this question";
    const reply = prefersEnglish(input.message)
      ? `I’ll pass your question about ${reason} to the seller so they can give you an accurate answer. Is there anything else about the listed price, sizes, or delivery I can help with?`
      : `Ipa-check ko po sa seller ang tungkol sa ${reason} para accurate ang sagot. May iba pa po ba kayong tanong tungkol sa presyo, sizes, o delivery?`;
    return escalate(reply);
  }
  if (understanding.intent === "catalog") {
    const activeProducts = input.products.filter((item) => item.active);
    if (!activeProducts.length)
      return respond(
        { catalog_count: 0 },
        "Wala pa pong active items sa catalog ngayon. Ipa-check ko po sa seller.",
      );
    const now = input.now ?? new Date();
    const lines = activeProducts.map((item) => {
      const stocks = item.variants
        .map(
          (variant) => {
            const pricing = quote(item, 1, now, item.promos, variant.price);
            return variant.size + " — " + peso(pricing.unit) +
              (variant.stock > 0
                ? " (" + variant.stock + " available)"
                : " (sold out)");
          },
        )
        .join(", ");
      return (
        "• " +
        item.name +
        " — " +
        (stocks ? "; sizes/prices/stock: " + stocks : "")
      );
    });
    return respond(
      {
        catalog_count: activeProducts.length,
        products: activeProducts.map((item) => item.name),
      },
      "Ito po ang active items sa catalog at available sizes/stock: " +
        lines.join("\n"),
    );
  }
  if (understanding.intent === "size_chart") {
    if (!input.settings.size_chart_url) {
      return escalate(
        "Wala pa pong uploaded na size chart sa shop. Ipa-check ko muna sa seller po.",
      );
    }
    return {
      ...respond(
        { size_chart_available: true },
        "Narito po ang size chart ng shop.",
      ),
      imageUrl: input.settings.size_chart_url,
    };
  }
  if (understanding.intent === "order_help") {
    return respond(
      { order_help: true },
      input.settings.faq_answers?.order_help?.trim() ||
        "Para mag-order po, sabihin ang item, size, quantity, at delivery area. Iche-check ko ang stock at total bago ko hingin ang confirmation.",
    );
  }
  if (understanding.intent === "bulk") {
    const options = input.settings.bot_options;
    if (!options?.bulk_orders)
      return respond(
        { bulk_orders: false },
        "Sorry po, hindi muna kami tumatanggap ng bulk orders. May promo po ba kayong gustong itanong?",
      );
    const details = options.bulk_details?.trim();
    if (!details)
      return escalate(
        "Tumatanggap po kami ng bulk orders. Ilang piraso po ang kukunin ninyo? Ipa-compute ko sa seller ang bulk price.",
      );
    return respond(
      { bulk_orders: true },
      "Tumatanggap po kami ng bulk orders! " +
        details +
        " Ilang piraso po ang kukunin ninyo?",
    );
  }
  if (understanding.intent === "shop_info") {
    const options = input.settings.bot_options;
    const address = options?.address?.trim();
    const pageName = options?.facebook_page_name?.trim();
    const configuredPageUrl = options?.facebook_page_url?.trim();
    const pageUrl =
      configuredPageUrl && /^https:\/\//i.test(configuredPageUrl)
        ? configuredPageUrl
        : null;
    const asksForPage = /\b(facebook|fb|page|profile)\b/i.test(input.message);
    const asksInstagramPage = /\b(instagram|ig)\b/i.test(input.message);
    const isTrustQuestion = /\b(legit|legitimate|scam|scammer)\b/.test(
      input.message.toLowerCase(),
    );
    if (asksForPage) {
      if (asksInstagramPage)
        return escalate(
          prefersEnglish(input.message)
            ? "I don't have a seller-listed Instagram profile saved, so I'll ask the seller to share it."
            : "Wala pong Instagram profile na naka-save, kaya hihingiin ko po ito sa seller.",
        );
      if (pageUrl)
        return respond(
          { facebook_page_name: pageName || null, facebook_page_url: pageUrl },
          (prefersEnglish(input.message)
            ? "The seller-listed Facebook page is "
            : "Facebook page po ng shop: ") +
            (pageName ? pageName + " — " : "") +
            pageUrl +
            (isTrustQuestion
              ? prefersEnglish(input.message)
                ? ". I can't independently verify whether the shop is legitimate; please confirm any concerns directly with the seller."
                : ". Hindi ko po mave-verify nang independent ang legitimacy ng shop; paki-confirm po sa seller kung may concern kayo."
              : "."),
        );
      const savedName = pageName
        ? prefersEnglish(input.message)
          ? ` The seller settings list the page name as ${pageName}.`
          : ` Ang page name na inilagay ng seller ay ${pageName}.`
        : "";
      return escalate(
        (prefersEnglish(input.message)
          ? "I don't have a Facebook page link saved, so I'll ask the seller to share it."
          : "Wala pong Facebook page link na naka-save, kaya hihingiin ko po ito sa seller.") +
          savedName,
      );
    }
    if (!address)
      return escalate(
        isTrustQuestion
          ? prefersEnglish(input.message)
            ? "The seller has not added a physical store address yet, so I can’t confirm the shop location or independently verify its legitimacy. I’ll ask the seller to clarify."
            : "Wala pa pong physical store address na inilagay ang seller, kaya hindi ko makukumpirma ang lokasyon o mave-verify ang legitimacy ng shop. Ipa-confirm ko po ito sa seller."
          : "Ipa-check ko po sa seller ang exact store location. Anong item po ang gusto ninyong tingnan habang naghihintay?",
      );
    if (isTrustQuestion)
      return respond(
        { shop_address: address, legitimacy_verified: false },
        prefersEnglish(input.message)
          ? `According to the shop details entered by the seller, the physical store is at ${address}. I’m an automated assistant and can’t independently verify whether a shop is legitimate, so please confirm any concerns directly with the seller.`
          : `Ayon po sa shop details na inilagay ng seller, ang physical store ay nasa ${address}. Automated assistant lang po ako at hindi ko mave-verify nang independent ang legitimacy ng shop, kaya paki-confirm po sa seller kung may concern kayo.`,
      );
    return respond(
      { shop_address: address },
      prefersEnglish(input.message)
        ? `Yes, the seller-listed physical store address is ${address}. Would you like directions or help ordering online?`
        : "Opo, ang address ng physical store na inilagay ng seller ay " +
            address +
            ". May iba pa po ba kayong gustong malaman?",
    );
  }
  if (understanding.intent === "business_hours") {
    const hours = input.settings.bot_options?.business_hours?.trim();
    if (!hours)
      return escalate(
        "Ipa-check ko po sa seller ang business hours. May iba pa po ba kayong gustong malaman tungkol sa shop?",
      );
    return respond(
      { business_hours: hours },
      "Online po kami " +
        hours +
        ". Pwede po kayong mag-message anytime at sasagot po kami pagbalik namin. May iba pa po ba kayong tanong?",
    );
  }
  if (understanding.intent === "after_sales") {
    const options = input.settings.bot_options;
    const lower = input.message.toLowerCase();
    const kind = /refund/.test(lower)
      ? "refund"
      : /return/.test(lower)
        ? "return"
        : "exchange";
    if (!options?.after_sales?.[kind])
      return respond(
        { after_sales: kind, enabled: false },
        "Sorry po, wala pa pong " +
          kind +
          " sa ngayon. May iba pa po ba kayong tanong bago mag-order?",
      );
    if (kind === "refund") {
      const policy = options.refund_policy?.trim();
      if (policy)
        return respond(
          { after_sales: kind, enabled: true, policy },
          policy + " May iba pa po ba kayong gustong linawin?",
        );
      return respond(
        { after_sales: kind, enabled: true },
        "Sorry po, wala pa pong refund policy na available sa ngayon. Gusto niyo po ba akong magtanong sa seller?",
      );
    }
    return respond(
      { after_sales: kind, enabled: true },
      "Opo, available po ang " +
        kind +
        ". Anong item po ito? Pakisend din po ang order number para matulungan kayo.",
    );
  }
  if (["discount", "discount_timing", "future_discount"].includes(understanding.intent)) {
    const resolution = resolveProduct(
      understanding.product_query,
      input.products.filter((item) => item.active),
    );
    const product =
      resolution.status === "matched"
        ? (resolution.product as BrainProduct)
        : !understanding.product_query
          ? (contextProduct ?? lastProduct ?? null)
          : null;
    if (!product) {
      if (understanding.intent === "discount")
        return escalate(
          "Hindi po ako sigurado kung may discount o bawas sa item na tinutukoy ninyo. I-aask ko po muna ito sa seller. Kaya ko pong tumulong sa presyo, sizes, stock, shipping, bayad, at order status.",
        );
      return respond(
        { discount_product_required: true },
        "Aling item po ang tinatanong ninyo tungkol sa discount? Sabihin lang po ang pangalan para ma-check ko ang offer at schedule.",
      );
    }
    const now = input.now ?? new Date();
    const productHasDiscount = Boolean(product.discount_type && Number(product.discount_value) > 0);
    const productWindow = offerTiming(product.discount_starts, product.discount_ends, now);
    const scheduledPromos = product.promos
      .filter((promo) => promo.active !== false)
      .map((promo) => ({ promo, timing: offerTiming(promo.starts_at, promo.ends_at, now) }));
    if (understanding.intent === "discount_timing" || understanding.intent === "future_discount") {
      const details: string[] = [];
      if (productHasDiscount) {
        const start = formatOfferDateTime(product.discount_starts);
        const end = formatOfferDateTime(product.discount_ends);
        if (productWindow.active) {
          details.push(end
            ? `Ang ${product.discount_type === "percent" ? `${product.discount_value}% off` : "discount"} po ay available hanggang ${end}.`
            : "Active po ang discount, pero walang nakalistang ending date/time.");
          if (productWindow.daysLeft !== null && productWindow.daysLeft <= 3)
            details.push(productWindow.daysLeft <= 1 ? "Magtatapos na po ito today—habol na po!" : `${productWindow.daysLeft} days na lang po—habol na po!`);
        } else if (productWindow.upcoming) {
          details.push(`Naka-schedule po ang discount mula ${start ?? "sa nakatakdang oras"}${end ? ` hanggang ${end}` : ""}.`);
        } else if (productWindow.ended) {
          details.push(`Natapos na po ang discount noong ${end ?? "nakaraang schedule"}.`);
        }
      }
      for (const { promo, timing } of scheduledPromos) {
        const start = formatOfferDateTime(promo.starts_at);
        const end = formatOfferDateTime(promo.ends_at);
        if (timing.active && end)
          details.push(`${promo.label} po ay active hanggang ${end}.`);
        else if (timing.upcoming && start)
          details.push(`${promo.label} po ay magsisimula ${start}${end ? ` hanggang ${end}` : ""}.`);
      }
      if (!details.length) {
        return respond(
          { product: product.name, discount_scheduled: false },
          understanding.intent === "future_discount"
            ? `Wala pong naka-list na susunod na discount schedule para sa ${product.name} sa ngayon.`
            : `Wala pong active o naka-schedule na discount date/time para sa ${product.name} sa catalog ngayon.`,
        );
      }
      return respond(
        { product: product.name, discount_starts: product.discount_starts, discount_ends: product.discount_ends, schedules: details },
        `${product.name}: ${details.join(" ")}`,
      );
    }
    const quantity = understanding.quantity ?? 1;
    const sizeVariant = understanding.size
      ? product.variants.find((item) => item.size === understanding.size)
      : null;
    const pricing = quote(
      product,
      quantity,
      now,
      product.promos,
      sizeVariant?.price,
    );
    const end = formatOfferDateTime(product.discount_ends);
    const urgency = productHasDiscount && productWindow.active && productWindow.daysLeft !== null && productWindow.daysLeft <= 3
      ? productWindow.daysLeft <= 1 ? " Magtatapos na po ang offer today—habol na po!" : ` ${productWindow.daysLeft} days na lang po ang offer—habol na po!`
      : "";
    const endNote = (productHasDiscount && productWindow.active && end ? ` Valid po hanggang ${end}.` : "") + urgency;
    const reply =
      pricing.saved > 0 && pricing.label
        ? "Opo, may " +
          pricing.label +
          " po sa " +
          product.name +
          ". Para sa " +
          quantity +
          " piraso, bawas po ang " +
          peso(pricing.saved) +
          " at item total ay " +
          peso(pricing.total) +
          "." + endNote
        : "Wala pong active discount o promo na naka-lista sa catalog para sa " +
          product.name +
          " ngayon. Regular item total po para sa " +
          quantity +
          " piraso ay " +
          peso(pricing.total) +
          "." + (productHasDiscount && productWindow.ended && end ? ` Natapos po ang discount noong ${end}.` : "");
    return respond(
      {
        product: product.name,
        quantity,
        unit_price: pricing.unit,
        subtotal: pricing.subtotal,
        item_total: pricing.total,
        saved: pricing.saved,
        offer: pricing.label,
      },
      reply,
      understanding.intent === "discount" ? {
        ...activePending,
        last_product: {
          ...lastProductContext,
          product_id: product.id,
          quantity,
        },
        clarification: { kind: "order_interest", product_id: product.id },
      } : activePending,
    );
  }
  if (understanding.intent === "payment") {
    const orderIsReserved = input.latestOrder?.status === "awaiting_payment";
    const orderIsPaid =
      input.latestOrder?.status === "paid" ||
      input.latestOrder?.status === "shipped";
    return respond(
      {
        payment_allowed_now: false,
        order_reserved: orderIsReserved,
        payment_already_recorded: orderIsPaid,
      },
      paymentSafetyMessage({
        channel: input.channel ?? "web",
        sellerPresent: input.sellerPresent === true,
        orderId: input.latestOrder?.id,
        orderReserved: orderIsReserved,
        paymentAlreadyRecorded: orderIsPaid,
        facebookPageName: input.settings.bot_options?.facebook_page_name,
        facebookPageUrl: input.settings.bot_options?.facebook_page_url,
      }),
    );
  }
  if (understanding.intent === "status") {
    if (/\b(track|tracking|tracking number|waybill|awb)\b/i.test(input.message))
      return escalate(
        prefersEnglish(input.message)
          ? "I can’t access a tracking number here yet. I’ll ask the seller to check it for you. Please share your order number or the name on the order."
          : "Hindi ko po makita rito ang tracking number. Ipa-check ko po ito sa seller. Pakisend po ang order number o pangalan sa order.",
      );
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
    const options = input.settings.bot_options;
    const couriers = [
      ...(options?.couriers ?? []),
      ...(options?.other_courier?.trim() ? [options.other_courier.trim()] : []),
    ];
    const minimum = Number(options?.free_shipping_minimum ?? 0);
    const normalizedShippingQuestion = normalizeMessage(input.message);
    const asksFreeShipping =
      /\b(free|libre|libre na|wala|walang|without)\b.*\b(shipping|delivery|fee)\b|\b(shipping|delivery)\b.*\b(free|libre|wala|walang)\b/i.test(
        normalizedShippingQuestion,
      );
    if (asksFreeShipping) {
      const rates = Object.entries(input.settings.shipping_rates)
        .filter(([, amount]) => Number.isFinite(amount))
        .map(([area, amount]) => area + " " + peso(amount));
      const rateSummary = rates.length
        ? " Standard rates po ayon sa settings: " + rates.join(", ") + "."
        : " Wala pa pong naka-save na shipping rate sa settings.";
      const freeShipping =
        minimum > 0
          ? " May free shipping po kapag umabot sa " +
            peso(minimum) +
            " ang item subtotal."
          : " Sa ngayon po, walang naka-configure na free shipping.";
      return escalate(
        "Sorry po, " +
          (minimum > 0
            ? "may free shipping lang po kapag umabot sa " +
              peso(minimum) +
              " ang subtotal; kung hindi, may shipping fee po."
            : "hindi po free shipping ayon sa shop settings.") +
          rateSummary +
          freeShipping +
          " Puwede po kayong mag-type ng /seller o SELLER para makipag-negotiate sa seller. Kaya ko pong tumulong sa presyo, sizes, stock, shipping rates, bayad, at order status.",
      );
    }
    if (/\b(same day|same-day)\b/i.test(input.message)) {
      const sameDayCouriers = couriers.filter((courier) =>
        /^(lalamove|move it)$/i.test(courier),
      );
      if (!sameDayCouriers.length)
        return respond(
          { same_day: false },
          prefersEnglish(input.message)
            ? "Sorry, same-day delivery isn’t currently listed as available. Would you like me to check the regular delivery options for your area?"
            : "Sorry po, wala pong naka-enable na same-day delivery ngayon. Gusto niyo po bang i-check ko ang regular delivery options sa area ninyo?",
        );
      return respond(
        { same_day: true, couriers: sameDayCouriers },
        prefersEnglish(input.message)
          ? `Same-day delivery may be arranged via ${sameDayCouriers.join(" or ")}; the rider fee and availability depend on your area. Where should we check?`
          : `Pwede pong mag-check ng same-day via ${sameDayCouriers.join(" o ")}; depende po sa area ang availability at rider fee. Saan po ang delivery area?`,
      );
    }
    if (
      /\b(ship out|ship-out|dispatch|cut off|cutoff)\b/i.test(input.message)
    ) {
      const days = Number(options?.processing_days);
      if (!Number.isFinite(days) || days < 1)
        return escalate(
          prefersEnglish(input.message)
            ? "I don’t have the ship-out schedule saved. I’ll confirm it with the seller. Is there anything else I can help with?"
            : "Wala pong naka-save na ship-out schedule. Ipa-confirm ko po sa seller. May iba pa po ba akong maitutulong?",
        );
      return respond(
        { processing_days: days },
        prefersEnglish(input.message)
          ? `Orders ship out within ${days} day(s) after payment is confirmed. Would you like help checking delivery time for your area?`
          : `Ship out po ang orders within ${days} day(s) matapos ma-confirm ang payment. Gusto niyo po bang i-check ang delivery time sa area ninyo?`,
      );
    }
    const asksCourier =
      /\b(courier|couriers|which courier|what courier|lbc|flash|lalamove|ninja van|spx|jrs|move it)\b/i.test(
        input.message,
      ) || /j\s*&\s*t/i.test(input.message);
    if (asksCourier && !understanding.location) {
      if (!couriers.length)
        return escalate(
          prefersEnglish(input.message)
            ? "No couriers are listed in the shop settings. I’ll check with the seller. What else can I help with?"
            : "Wala pa pong nakalistang courier. I-check ko muna sa seller po.",
        );
      return respond(
        { couriers },
        prefersEnglish(input.message)
          ? `Available couriers are ${couriers.join(", ")}. What area should I check delivery details for?`
          : "Available po ang " +
              couriers.join(", ") +
              ". Anong area po kayo para ma-check ang delivery details?",
      );
    }
    const asksOtherAreas = asksOtherAreaShipping(input.message);
    const region = regionFor(understanding.location);
    const rate = region ? input.settings.shipping_rates[region] : undefined;
    if (!region && asksOtherAreas) {
      const otherRates = Object.entries(input.settings.shipping_rates).filter(
        ([area, amount]) =>
          area.toLocaleLowerCase() !== "metro manila" &&
          Number.isFinite(amount),
      );
      if (otherRates.length === 0)
        return escalate(
          "Wala pa po akong saved shipping rate para sa ibang areas. I-check ko muna sa seller po.",
        );
      return respond(
        {
          shipping_rates: Object.fromEntries(otherRates),
          amounts: otherRates.map(([, amount]) => amount),
        },
        "Shipping rates po outside Metro Manila: " +
          otherRates
            .map(([area, amount]) => area + " " + peso(amount))
            .join(", ") +
          ". Sabihin po ang specific area ninyo para ma-confirm ang tamang rate.",
      );
    }
    if (typeof rate !== "number") {
      if (
        !region &&
        input.settings.shipping_rates["Metro Manila"] === undefined &&
        input.settings.shipping_rates.Luzon === undefined &&
        input.settings.shipping_rates.Visayas === undefined &&
        input.settings.shipping_rates.Mindanao === undefined
      ) {
        return escalate(
          "Hindi ko makita ang shipping rates. I-check ko muna sa seller po.",
        );
      }
      if (region)
        return escalate(
          "Hindi ko makita ang shipping rate para sa area na ito. I-check ko muna sa seller po.",
        );
      return respond(
        { shipping_regions: Object.keys(input.settings.shipping_rates) },
        (minimum > 0
          ? "Free shipping po kapag umabot sa " + peso(minimum) + ". "
          : "") +
          (input.settings.shipping_text?.trim()
            ? input.settings.shipping_text.trim() + " "
            : "") +
          "Anong area po kayo: Metro Manila, Luzon, Visayas, o Mindanao?",
        {
          ...activePending,
          clarification: { kind: "location", intent: "shipping" },
        },
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
      const freeShipping = minimum > 0 && Number(oldOrder.subtotal) >= minimum;
      const finalRate = freeShipping ? 0 : rate;
      order.shipping = finalRate;
      order.total =
        Math.round(
          ((Number(oldOrder.subtotal) || 0) + finalRate + Number.EPSILON) * 100,
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
          (freeShipping ? "free po" : peso(rate)) +
          ". Total po ay " +
          peso(Number(order.total)) +
          ". I-confirm po ba ang order?",
        { ...activePending, order },
      );
    }
    const deliveryDays = region ? options?.delivery_days?.[region]?.trim() : "";
    const deliveryDetails =
      (deliveryDays
        ? " Estimated delivery po ay " + deliveryDays + " after ship-out."
        : "") +
      (options?.processing_days
        ? " Ship-out po within " +
          options.processing_days +
          " day(s) after payment confirmation."
        : "");
    const courierDetails = couriers.length ? " via " + couriers.join(", ") : "";
    const freeShippingNote = asksFreeShipping
      ? minimum > 0
        ? " Free shipping po kapag umabot sa " + peso(minimum) + " ang order."
        : " Wala pa pong free shipping sa ngayon."
      : "";
    return respond(
      { region, shipping: rate, amounts: [rate] },
      (input.settings.shipping_text?.trim()
        ? input.settings.shipping_text.trim() + " "
        : "") +
        "Shipping to " +
        region +
        " po ay " +
        peso(rate) +
        courierDetails +
        "." +
        freeShippingNote +
        deliveryDetails,
    );
  }

  const resolution = clarifiedProduct
    ? { status: "matched" as const, product: clarifiedProduct }
    : resolveProduct(
        understanding.product_query,
        input.products.filter((product) => product.active),
      );
  if (resolution.status === "ambiguous") {
    const names = resolution.candidates.map((product) => product.name);
    return respond(
      { candidates: names },
      "Alin po rito ang tinutukoy ninyo: " + names.join(" o ") + "?",
      {
        ...activePending,
        clarification: {
          kind: "product",
          candidates: resolution.candidates.map((item) => item.name),
          intent: understanding.intent,
          size: understanding.size,
          size_answer: deferredReplySize,
          quantity: understanding.quantity,
          location: understanding.location,
        },
      },
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
        {
          ...activePending,
          clarification: {
            kind: "product",
            candidates: input.products
              .filter((item) => item.active)
              .map((item) => item.name),
            intent: understanding.intent,
            size: understanding.size,
            size_answer: deferredReplySize,
            quantity: understanding.quantity,
            location:
              understanding.intent === "price" &&
              input.message
                .toLocaleLowerCase()
                .replace(/[^a-z0-9]+/g, " ")
                .trim() === "magkano po ito"
                ? "Metro Manila"
                : understanding.location,
          },
        },
      );
    return escalate(
      "Hindi ko makita ang " +
        understanding.product_query +
        " sa catalog ng shop, kaya hindi ko ma-confirm ang availability nito. Ipa-check ko muna sa seller po kung mayroon nito.",
    );
  }
  const product = resolution.product;
  const sizes = product.variants.map((variant) => variant.size);
  const chosenSize = understanding.size;
  if (understanding.intent === "availability" && !chosenSize) {
    const sizeStock = product.variants.map(
      (variant) =>
        variant.size +
        ": " +
        (variant.stock > 0 ? variant.stock + " available" : "sold out"),
    );
    return respond(
      {
        product: product.name,
        sizes: product.variants.map((item) => item.size),
        stock: product.variants.map((item) => item.stock),
      },
      product.name +
        " po, available sizes and stock: " +
        sizeStock.join(", ") +
        ".",
      {
        ...activePending,
        last_product: { product_id: product.id },
        ...(understanding.quantity !== null
          ? {
              clarification: {
                kind: "size",
                product_id: product.id,
                intent: understanding.intent,
                quantity: understanding.quantity,
                location: understanding.location,
              },
            }
          : {}),
      },
    );
  }
  if (chosenSize && !sizes.includes(chosenSize)) {
    return respond(
      { product: product.name, available_sizes: sizes },
      "Available sizes po ay " +
        sizes.join(", ") +
        ". Anong size po ang gusto ninyo?",
      {
        ...activePending,
        clarification: {
          kind: "size",
          product_id: product.id,
          intent: understanding.intent,
          quantity: understanding.quantity,
          location: understanding.location,
        },
      },
    );
  }
  const size = chosenSize ?? (sizes.length === 1 ? sizes[0] : null);
  if (
    understanding.price_quantities &&
    understanding.price_quantities.length > 1 &&
    !size &&
    sizes.length > 1
  ) {
    return respond(
      { product: product.name, price_quantities: understanding.price_quantities },
      "Makakapagbigay po ako ng magkahiwalay na quote para sa bawat dami. Anong size po ang gusto ninyo? Available sizes po ay " +
        sizes.join(", ") + ".",
      {
        ...activePending,
        last_product: { product_id: product.id },
        clarification: {
          kind: "size",
          product_id: product.id,
          intent: "price",
          location: understanding.location,
          price_quantities: understanding.price_quantities,
        },
      },
    );
  }
  if (understanding.price_quantities && understanding.price_quantities.length > 1) {
    const variant = size
      ? product.variants.find((item) => item.size === size)
      : product.variants[0];
    if (!variant) return escalate("I-check ko muna ang available sizes sa seller po.");
    const now = input.now ?? new Date();
    const quotes = understanding.price_quantities.map((quantity) => ({
      quantity,
      pricing: quote(product, quantity, now, product.promos, variant.price),
    }));
    const region = regionFor(understanding.location);
    const shipping = region ? input.settings.shipping_rates[region] : undefined;
    if (region && typeof shipping !== "number") {
      return escalate(
        "Hindi ko makita ang shipping rate para sa " + region + ". I-check ko muna sa seller po.",
      );
    }
    const lines = quotes.map(({ quantity, pricing }) => {
      const total = typeof shipping === "number"
        ? Math.round((pricing.total + shipping + Number.EPSILON) * 100) / 100
        : null;
      const stockStatus = understanding.availability_requested
        ? variant.stock >= quantity
          ? " available"
          : variant.stock === 0
            ? " sold out"
            : " (" + variant.stock + " lang ang available)"
        : "";
      return quantity + " piraso" + stockStatus + ": " +
        peso(pricing.total) + " subtotal" +
        (total === null ? "" : ", " + peso(total) + " kasama ang shipping");
    });
    const stockText = variant.stock > 0
      ? "May " + variant.stock + " stock po sa size " + variant.size + "."
      : "Sold out po ngayon ang size " + variant.size + ".";
    const shippingText = typeof shipping === "number"
      ? " Shipping sa " + region + " ay " + peso(shipping) + "."
      : " Sabihin po ang delivery area para makuha ang shipping.";
    const reply = product.name + " (" + variant.size + ") po, eto ang magkahiwalay na presyo: " +
      lines.join("; ") + ". " + stockText + shippingText;
    return respond(
      {
        product: product.name,
        size: variant.size,
        price_quotes: quotes.map(({ quantity, pricing }) => ({ quantity, subtotal: pricing.total })),
        stock: variant.stock,
        shipping: typeof shipping === "number" ? shipping : null,
      },
      reply,
      {
        ...activePending,
        last_product: {
          product_id: product.id,
          size: variant.size,
          location: understanding.location,
        },
      },
    );
  }
  if (
    !size &&
    sizes.length > 1 &&
    ["availability", "order_confirm", "question"].includes(understanding.intent)
  ) {
    return respond(
      { product: product.name, available_sizes: sizes },
      "Anong size po ang gusto ninyo? Available sizes po ay " +
        sizes.join(", ") +
        ".",
      {
        ...activePending,
        clarification: {
          kind: "size",
          product_id: product.id,
          intent: understanding.intent,
          quantity: understanding.quantity,
          location: understanding.location,
        },
      },
    );
  }

  if (
    understanding.intent === "order_confirm" &&
    size &&
    understanding.quantity === null
  ) {
    return respond(
      { product: product.name, size },
      "Noted po, " + size + ". Ilang piraso po ang gusto ninyo?",
      {
        ...activePending,
        last_product: { ...lastProductContext, product_id: product.id, size },
        clarification: {
          kind: "quantity",
          product_id: product.id,
          intent: "order_confirm",
          size,
        },
      },
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
      {
        ...activePending,
        clarification: {
          kind: "quantity",
          product_id: product.id,
          intent: understanding.intent,
          size,
          location: understanding.location,
        },
      },
    );
  }

  const quantity = understanding.quantity ?? 1;
  const variant = size
    ? product.variants.find((item) => item.size === size)
    : product.variants[0];
  if (!variant)
    return escalate("I-check ko muna ang available sizes sa seller po.");
  const now = input.now ?? new Date();
  const pricing = quote(product, quantity, now, product.promos, variant.price);
  const region = regionFor(understanding.location);
  const shipping = region ? input.settings.shipping_rates[region] : undefined;
  if (region && typeof shipping !== "number") {
    return escalate(
      "Hindi ko makita ang shipping rate para sa " +
        region +
        ". I-check ko muna sa seller po.",
    );
  }
  if (
    variant.stock < quantity &&
    (understanding.intent !== "price" || understanding.availability_requested)
  ) {
    const shortageReply =
      understanding.intent === "price"
        ? "May " +
          variant.stock +
          " stock lang po ng " +
          product.name +
          " (" +
          variant.size +
          "). Ang presyo para sa " +
          quantity +
          " piraso ay subtotal na " +
          peso(pricing.total) +
          "." +
          (typeof shipping === "number"
            ? " Shipping: " +
              peso(shipping) +
              ", total kung available ang quantity: " +
              peso(
                Math.round((pricing.total + shipping + Number.EPSILON) * 100) /
                  100,
              ) +
              "."
            : " Sabihin po ang delivery area para makuha ang shipping.")
        : variant.stock === 0
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
            " ang hinahanap ninyo. Ilan po ang gusto ninyong kunin?";
    return respond(
      {
        product: product.name,
        size: variant.size,
        requested: quantity,
        stock: variant.stock,
      },
      shortageReply,
      typeof shipping === "number"
        ? {
            ...activePending,
            last_product: {
              product_id: product.id,
              size: variant.size,
              quantity,
              location: understanding.location,
            },
          }
        : {
            ...activePending,
            last_product: {
              product_id: product.id,
              size: variant.size,
              quantity,
              location: understanding.location,
            },
            clarification: {
              kind: "location",
              product_id: product.id,
              intent: understanding.intent,
              size: variant.size,
              quantity,
              location: null,
              availability_requested:
                understanding.availability_requested === true,
            },
          },
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
    color:
      typeof lastProductContext.color === "string"
        ? lastProductContext.color
        : null,
  };
  const pending: BrainPending = orderIntent
    ? { ...activePending, order }
    : activePending;
  pending.last_product = {
    product_id: product.id,
    size: variant.size,
    quantity,
    location: understanding.location,
  };
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
    expected_quote_total: quote(product, quantity, now, product.promos, variant.price).total,
  };
  const hasOffer = pricing.saved > 0 && pricing.label !== null;
  const subtotalSummary = hasOffer
    ? "Original price po ay " +
      peso(pricing.subtotal) +
      (quantity > 1 ? " para sa " + quantity + " piraso" : "") +
      ", pero may " +
      pricing.label +
      " po ito (tipid na " +
      peso(pricing.saved) +
      "), kaya subtotal po ay " +
      peso(pricing.total) +
      " na lang."
    : "Subtotal po ay " + peso(pricing.total) + ".";
  const amountSummary =
    typeof shipping === "number"
      ? subtotalSummary +
        " Shipping po ay " +
        peso(shipping) +
        ", total " +
        peso(total) +
        "."
      : subtotalSummary +
        " Sabihin po ang area ninyo para makuha ang shipping at total.";
  const template = orderIntent
    ? product.name +
      " (" +
      variant.size +
      ") x" +
      quantity +
      ": " +
      amountSummary +
      (typeof shipping === "number"
        ? " Available pa po ito base sa latest check. Wala pang stock na na-reserve. Gusto niyo po bang ituloy? Sumagot po ng YES para mahingi ko ang delivery details at ma-reserve ang stock."
        : " Wala pang stock na na-reserve. Sabihin po ang delivery area ninyo para makuha ang shipping at final total bago magpatuloy.")
    : understanding.intent === "availability"
      ? "Available po ang " +
        product.name +
        " (" +
        variant.size +
        ")" +
        (quantity > 1 ? " para sa " + quantity + " piraso" : "") +
        "; may " +
        variant.stock +
        " stock. " +
        amountSummary
      : product.name +
        " (" + variant.size + ")" +
        (understanding.quantity ? " x" + quantity : "") +
        " po: " +
        amountSummary +
        (understanding.availability_requested
          ? " May " + variant.stock + " stock po sa size " + variant.size + "."
          : "") +
        (understanding.intent === "price" && typeof shipping === "number"
          ? " Gusto niyo po bang ituloy para ma-reserve habang available pa? Sabihin lang po ang RESERVE."
          : "");

  const responsePending =
    typeof shipping === "number"
      ? understanding.intent === "price"
        ? {
            ...pending,
            clarification: { kind: "reserve_decision", product_id: product.id },
          }
        : pending
      : {
          ...pending,
          clarification: {
            kind: "location",
            product_id: product.id,
            intent: understanding.intent,
            size: variant.size,
            quantity,
            location: null,
            availability_requested:
              understanding.availability_requested === true,
          },
        };
  return respond(facts, template, responsePending);
}
