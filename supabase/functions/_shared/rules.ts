export type UnderstandingIntent =
  | "greeting"
  | "question"
  | "price"
  | "availability"
  | "order_confirm"
  | "status"
  | "payment"
  | "order_help"
  | "bulk"
  | "shop_info"
  | "business_hours"
  | "after_sales"
  | "discount"
  | "seller_handoff"
  | "catalog"
  | "size_chart"
  | "seller_availability"
  | "shipping"
  | "complaint"
  | "other"
  | "unknown";

export type Understanding = {
  intent: UnderstandingIntent;
  product_query: string | null;
  size: string | null;
  quantity: number | null;
  quantities_mentioned: number[];
  location: string | null;
  confidence: number;
  availability_requested?: boolean;
};

export type CatalogProduct = {
  name: string;
  aliases?: string[];
  sizes?: string[];
};

type ProductMatch = { product: CatalogProduct; alias: string; start: number; end: number };

const numberWords: Record<string, number> = {
  isa: 1,
  isang: 1,
  one: 1,
  dalawa: 2,
  dalawang: 2,
  two: 2,
  tatlo: 3,
  tatlong: 3,
  three: 3,
  apat: 4,
  apatna: 4,
  four: 4,
  lima: 5,
  limang: 5,
  five: 5,
  anim: 6,
  animna: 6,
  six: 6,
  pito: 7,
  pitong: 7,
  seven: 7,
  walo: 8,
  walong: 8,
  eight: 8,
  siyam: 9,
  siyamna: 9,
  nine: 9,
  sampu: 10,
  sampung: 10,
  ten: 10,
  eleven: 11,
  "labing isa": 11,
  "labing isang": 11,
  labindalawa: 12,
  "labing dalawa": 12,
  "labing dalawang": 12,
  twelve: 12,
  labintatlo: 13,
  "labing tatlo": 13,
  thirteen: 13,
  labinapat: 14,
  "labing apat": 14,
  fourteen: 14,
  labinlima: 15,
  "labing lima": 15,
  fifteen: 15,
  labinanim: 16,
  "labing anim": 16,
  sixteen: 16,
  labimpito: 17,
  "labing pito": 17,
  seventeen: 17,
  labingwalo: 18,
  "labing walo": 18,
  eighteen: 18,
  labinsiyam: 19,
  "labing siyam": 19,
  nineteen: 19,
  dalawampu: 20,
  dalawampung: 20,
  twenty: 20,
};
const numberWordEntries = Object.entries(numberWords)
  .sort((left, right) => right[0].split(" ").length - left[0].split(" ").length);

function numberAt(tokens: string[], start: number): { value: number; end: number } | null {
  for (const [phrase, value] of numberWordEntries) {
    const parts = phrase.split(" ");
    if (tokens.slice(start, start + parts.length).join(" ") === phrase)
      return { value, end: start + parts.length };
  }
  const numeric = tokens[start]?.match(/^\d{1,2}$/);
  return numeric ? { value: Number(numeric[0]), end: start + 1 } : null;
}

const sizeWords: Record<string, string[]> = {
  s: ["s", "small", "sm", "sml", "smol"],
  m: ["m", "medium", "med", "medum", "meduim", "mediam"],
  l: ["l", "large", "larg"],
  xl: ["xl", "x large", "extra large", "extra large"],
  xxl: ["xxl", "2xl", "xx large", "double extra large"],
  "one size": ["one size", "onesize", "one size fits all"],
};

const regions: Array<{ name: string; aliases: string[] }> = [
  {
    name: "Metro Manila",
    aliases: [
      "metro manila", "ncr", "manila", "quezon city", "makati", "taguig",
      "pasig", "pasay", "paranaque", "caloocan", "marikina", "mandaluyong",
      "muntinlupa", "las pinas", "malabon", "navotas", "san juan", "pateros",
      "valenzuela",
    ],
  },
  {
    name: "Luzon",
    aliases: [
      "luzon", "batanes", "cagayan", "isabela", "pampanga", "bulacan",
      "cavite", "laguna", "batangas", "bicol", "baguio", "ilocos",
    ],
  },
  {
    name: "Visayas",
    aliases: [
      "visayas", "cebu", "bohol", "iloilo", "negros", "leyte", "samar",
      "bacolod", "dumaguete", "ormoc",
    ],
  },
  {
    name: "Mindanao",
    aliases: [
      "mindanao", "davao", "cagayan de oro", "zamboanga", "general santos",
      "gensan", "butuan", "cotabato",
    ],
  },
];

const quantityUnits = new Set([
  "pc", "pcs", "piece", "pieces", "piraso", "item", "items", "qty", "quantity",
]);

const intentPhrases = {
  size_chart: ["size chart", "chart size", "size catalog", "catalog size", "catalog size chart", "size guide", "sizing chart", "chart ng size", "chart ng sizes", "size ng catalog", "catalog ng size"],
  catalog: ["what items do you have", "what items are available", "what products do you have", "what products are available", "show me the products", "show available items", "see current available items", "current available items", "list of items", "list products", "available items", "ano mga tinda", "anong mga tinda", "ano pong items", "mga available na item", "anong products meron", "ano mga available nyo", "ano mga available ninyo"],
  complaint: ["complaint", "reklamo", "galit", "angry", "not happy", "unacceptable", "sira", "may sira", "damaged", "wrong item", "maling item", "wrong size", "refund", "return", "missing item", "item missing", "parcel missing", "kulang item", "may kulang", "kulang ang laman", "incomplete order", "iba dumating", "iba ang dumating", "iba po ang dumating", "mali dumating", "late delivery", "late parcel", "no updates", "disappointed", "hindi dumating", "did not arrive", "didn't arrive", "not delivered", "received the wrong"],
  other: ["custom", "customize", "customise", "tailor", "alter", "personalized", "personalised", "do you sell", "nagbebenta", "may tinda"],
  status: ["order status", "nasaan order", "asan order", "nasaan na order", "update sa parcel", "track my order", "where is my order", "tracking", "order confirmation", "follow up", "follow-up", "na ship na", "parcel ko"],
  payment: ["payment", "magbayad", "paano magbayad", "pwede magbayad", "pwede na magbayad", "down payment", "downpayment", "deposit", "can i pay", "may i pay", "can we pay", "pay now", "send payment", "gcash", "maya", "bank transfer", "payment details", "cash on delivery", "cod", "installment", "credit card", "debit card"],
  order_help: ["paano mag order", "paano umorder", "how to order", "how can i order", "how to buy"],
  bulk: ["bulk order", "bulk orders", "wholesale", "maramihan", "bulk pricing"],
  shop_info: ["physical store", "physical shop", "store address", "shop address", "may tindahan", "may store", "where is your shop"],
  business_hours: ["business hours", "opening hours", "store hours", "what time do you open", "what time are you open", "anong oras kayo bukas"],
  after_sales: ["exchange", "return policy", "refund policy", "can i return", "pwede mag return", "pwede mag exchange", "do you accept returns", "do you accept exchange"],
  seller_handoff: ["restock", "material", "materials", "fabric", "fabrics", "see through", "see thru", "stretch", "stretchable", "stretchy", "thick ba", "thin", "makapal", "manipis", "true to size", "size fit sa akin", "fit sa akin", "anong size ang fit", "what size would fit", "recommend a size", "height weight", "actual photo", "actual photos", "real photo", "real photos", "actual images", "same as picture", "same as photo", "sa picture", "picture lang", "photo", "photos", "picture", "video", "model", "height of the model", "available colors", "what colors", "what color", "which colors", "which color", "colors", "color", "colours", "colour", "ibang color", "other color", "other colors", "anong kulay", "kulay", "legit", "scam", "reviews", "review", "testimonials", "feedback", "reseller", "reseller price", "dropship", "dropshipping", "dropshipper"],
  discount: ["discount", "tawad", "less pa", "best price", "may bawas", "can you lower", "lower the price"],
  price: ["magkano", "how much", "price", "presyo", "hm", "total magkano", "cost", "pm price"],
  availability: ["available", "availability", "avail", "may stock", "in stock", "meron", "mayroon", "anong sizes", "anong size", "available sizes"],
  shipping: ["shipping", "delivery fee", "shipping fee", "pa deliver", "padeliver", "deliver sa", "ship to", "shipping to", "delivery", "deliver", "ship out", "ship-out", "nag ship", "nagship", "ship with", "dispatch", "cut off", "cutoff", "same day", "same-day", "lalamove", "move it", "j t", "lbc", "flash", "ninja van", "spx", "jrs", "gaano katagal", "courier", "couriers", "which courier", "what courier", "ibang lugar", "other places", "other areas", "outside metro manila", "outside manila", "outside ncr", "elsewhere", "provincial shipping"],
  order_confirm: ["order na", "order ko na", "confirm order", "confirm", "i-confirm", "sige kunin", "kuha ko na", "kukuha", "kunin ko", "pabili", "checkout", "mine", "go na"],
  greeting: ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "kamusta", "kumusta", "musta"],
};
const otherAreaShippingPhrases = [
  "ibang lugar", "ibang area", "other place", "other places", "other area",
  "other areas", "another area", "different area", "outside metro manila",
  "outside manila", "outside ncr", "elsewhere", "provincial shipping",
];

export function isAcknowledgement(message: string): boolean {
  let normalized = normalizeMessage(message);
  if (!normalized) return false;
  normalized = normalized.replace(/\b(ok){2,}\b/g, "ok");
  const words = normalized.split(" ").map((word) => word.replace(/(.)\1+/g, "$1"));
  const accepted = new Set([
    "ok", "okay", "okey", "oki", "okie", "sure", "sige", "sge", "ge", "yes",
    "yeah", "yep", "oo", "opo", "po", "noted", "alright", "allright", "no",
    "problem", "thanks", "thank", "you", "salamat", "ty", "thx",
  ]);
  if (!words.length || words.some((word) => !accepted.has(word))) return false;
  return words.some((word) => ["ok", "okay", "okey", "oki", "okie", "sure", "sige", "sge", "ge", "yes", "yeah", "yep", "oo", "opo", "no", "noted", "alright", "allright", "salamat", "thanks", "thank", "ty", "thx"].includes(word));
}

const stopWords = new Set([
  "magkano", "how", "much", "price", "presyo", "hm", "pm", "mp", "cost", "available",
  "availability", "avail", "stock", "meron", "mayroon", "may", "ba", "have", "do", "you", "it",
  "the", "a", "an", "is", "are", "in", "from", "at", "of", "to", "for", "me", "please", "paki", "po",
  "ang", "yung", "ng", "sa", "pa", "ano", "anong", "deliver", "delivery", "ship", "shipping",
  "fee", "item", "items", "pcs", "pc", "piece", "pieces", "piraso", "qty",
  "quantity", "size", "sizes", "order", "gusto", "ko", "nito", "iyan", "ito", "dito", "diyan", "dun", "na",
  "with", "and", "or", "medium", "med", "small", "large", "extra", "xl", "xxl", "kayo", "kayong", "kami", "nyo", "ninyo", "ninyong", "what", "are", "have",
  "this", "that", "ibang", "lugar", "other", "place", "places", "area", "areas", "outside", "province", "provinces", "provincial", "elsewhere", "another", "different", "location", "locations",
  "material", "fabric", "through", "stretchable", "stretchy", "thick", "makapal", "manipis", "true", "fit", "recommend", "restock", "colors", "color", "kulay", "photo", "photos", "image", "images", "picture", "video", "model", "legit", "scam", "reviews", "review", "testimonials", "feedback", "reseller", "dropship", "dropshipping", "dropshipper", "actual", "discount", "tawad",
  ...Object.keys(numberWords).flatMap((word) => word.split(" ")),
]);

export function normalizeMessage(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeProductQuery(value: string): string {
  return normalizeMessage(value)
    .replace(/\bt\s*shirt\b/g, " tshirt ")
    .replace(/\b(na|po|opo|please|pls|paki|yung|ang|itong|ito|dito|nito|diyan|dun|ba|kaya)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

function containsPhrase(message: string, phrase: string): boolean {
  return ` ${message} `.includes(` ${normalizeMessage(phrase)} `);
}

function productPhrases(product: CatalogProduct): string[] {
  const phrases = new Map<string, string>();
  for (const source of [product.name, ...(product.aliases ?? [])]) {
    const normalized = normalizeProductQuery(source);
    if (!normalized) continue;
    phrases.set(normalized, source.trim());
    const sourceVariants = [normalized, normalized.replace(/\btshirt\b/g, "shirt")];
    for (const variant of sourceVariants) {
      phrases.set(variant, phrases.get(variant) ?? variant);
      const words = variant.split(" ");
      for (let start = 0; start < words.length; start += 1) {
        for (let end = start + 1; end <= words.length; end += 1) {
          const phrase = words.slice(start, end).join(" ");
          phrases.set(phrase, phrases.get(phrase) ?? phrase);
        }
      }
    }
  }
  return [...phrases.values()];
}

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[right.length];
}

function adjacentEditDistance(left: string, right: string): number {
  if (left.length < 2 || right.length < 2) return editDistance(left, right);
  for (let index = 0; index < Math.min(left.length, right.length) - 1; index += 1) {
    if (
      left[index] !== right[index] &&
      left[index] === right[index + 1] &&
      left[index + 1] === right[index]
    ) {
      const corrected = left.slice(0, index) + right[index] + right[index + 1] + left.slice(index + 2);
      return editDistance(corrected, right) + 1;
    }
  }
  return editDistance(left, right);
}

export function matchCatalogSize(message: string, sizes: string[]): string | null {
  const normalized = normalizeMessage(message);
  const tokens = normalized.split(" ").filter(Boolean);
  const matches = new Set<string>();
  for (const size of sizes) {
    const canonical = normalizeMessage(size);
    const aliases = sizeWords[canonical] ?? [canonical];
    const exact = aliases.some((alias) => containsPhrase(normalized, alias));
    const fuzzy = tokens.some((token) => aliases.some((alias) => {
      if (alias.includes(" ") || token.length < 3 || alias.length < 3) return false;
      const distance = adjacentEditDistance(token, alias);
      const allowed = alias.length >= 6 ? 2 : 1;
      return distance > 0 && distance <= allowed;
    }));
    if (exact || fuzzy) matches.add(size);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

export function matchQuantityAnswer(message: string): number | null {
  const normalized = normalizeMessage(message);
  const direct = normalized.match(/^(\d{1,2})(?:\s+(?:pc|pcs|piece|pieces|piraso))?$/)?.[1];
  if (direct) return Number(direct) >= 1 ? Number(direct) : null;
  const tokens = normalized.split(" ");
  for (let index = 0; index < tokens.length; index += 1) {
    const found = numberAt(tokens, index);
    if (found) return found.value;
  }
  return null;
}

export function matchCatalogLocation(message: string): string | null {
  return extractLocation(normalizeMessage(message));
}

export type ProductResolution<T> =
  | { status: "matched"; product: T }
  | { status: "ambiguous"; candidates: T[] }
  | { status: "not_found"; candidates: [] };

export function resolveProduct<T extends CatalogProduct>(
  query: string | null | undefined,
  products: T[],
): ProductResolution<T> {
  const normalizedQuery = normalizeProductQuery(query ?? "");
  if (!normalizedQuery) return { status: "not_found", candidates: [] };
  const scored = products.map((product) => {
    const names = productPhrases(product);
    let score = names.includes(normalizedQuery) ? 1 : 0;
    for (const name of names) {
      if (normalizedQuery.length >= 3 && name.length >= 3 &&
        normalizedQuery.includes(name)) {
        score = Math.max(score, 0.88);
      }
      if (name.split(" ").includes(normalizedQuery)) score = Math.max(score, 0.7);
      const distance = editDistance(normalizedQuery, name);
      const allowed = Math.max(1, Math.floor(Math.min(normalizedQuery.length, name.length) * 0.2));
      if (distance <= allowed) score = Math.max(score, 0.78 - distance * 0.05);
    }
    return { product, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  if (!scored.length || scored[0].score < 0.65) return { status: "not_found", candidates: [] };
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.08) {
    return {
      status: "ambiguous",
      candidates: scored.filter((item) => scored[0].score - item.score < 0.08)
        .map((item) => item.product),
    };
  }
  return { status: "matched", product: scored[0].product };
}

export function resolveProductChoice<T extends CatalogProduct>(
  query: string | null | undefined,
  products: T[],
): ProductResolution<T> {
  const normalizedQuery = normalizeProductQuery(query ?? "");
  const exactNames = products.filter((product) =>
    normalizeProductQuery(product.name) === normalizedQuery
  );
  if (exactNames.length === 1) return { status: "matched", product: exactNames[0] };
  // A customer often repeats only the distinguishing words from a long product
  // name ("Bayanihan tshirt", "basic t-shirt"). Accept that only when those
  // words identify exactly one of the clarification candidates.
  const queryWords = [...new Set(normalizedQuery.split(" ").filter(Boolean))];
  const genericWords = new Set(["shirt", "tshirt", "tee", "top", "item", "the", "a"]);
  const distinctiveWords = queryWords.filter((word) => !genericWords.has(word));
  if (distinctiveWords.length) {
    const matches = products.filter((product) => {
      const text = normalizeProductQuery([product.name, ...(product.aliases ?? [])].join(" "));
      const words = new Set(text.split(" "));
      return distinctiveWords.every((word) => words.has(word));
    });
    if (matches.length === 1) return { status: "matched", product: matches[0] };
  }
  return resolveProduct(query, products);
}

function findProductMatches(message: string, catalog: CatalogProduct[]): ProductMatch[] {
  const matches: ProductMatch[] = [];
  for (const product of catalog) {
    for (const alias of productPhrases(product)) {
      const normalizedAlias = normalizeMessage(alias);
      if (!normalizedAlias) continue;
      const variants = [...new Set([
        normalizedAlias,
        normalizedAlias.replace(/\btshirt\b/g, "t shirt"),
        normalizedAlias.replace(/\bt shirt\b/g, "tshirt"),
        `${normalizedAlias}s`,
      ])];
      for (const variant of variants) {
        const paddedIndex = ` ${message} `.indexOf(` ${variant} `);
        if (paddedIndex >= 0) {
          const start = ` ${message} `.slice(0, paddedIndex).trim()
            .split(/\s+/).filter(Boolean).length;
          matches.push({ product, alias, start, end: start + variant.split(" ").length });
          break;
        }
      }
    }
  }
  return matches.sort((a, b) => b.alias.length - a.alias.length);
}

function extractSize(message: string, sizes: string[]): string | null {
  return matchCatalogSize(message, sizes);
}

function extractQuantities(message: string, productStart: number | null): number[] {
  const tokens = message.split(" ");
  const candidates = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    const found = numberAt(tokens, index);
    if (!found) continue;
    const value = found.value;
    if (!value || value > 100) continue;
    const prev = tokens[index - 1] ?? "";
    const next = tokens[found.end] ?? "";
    const hasUnit = quantityUnits.has(next) || quantityUnits.has(prev);
    const nearProduct = productStart !== null && productStart >= found.end &&
      productStart - index <= 4 &&
      tokens.slice(found.end, productStart).every((word) =>
        Object.values(sizeWords).flat().includes(word) || word === "size" ||
        word === "or" || word === "and" || word === "na" || /^\d{1,2}$/.test(word)
      );
    const prefixed = prev === "x" || prev === "qty" || prev === "quantity";
    const nextIsSize = Object.values(sizeWords).flat().includes(next);
    const followsProduct = productStart !== null && index > productStart &&
      index - productStart <= 4 && (hasUnit || next === "x" || nextIsSize);
    if (hasUnit || nearProduct || prefixed || followsProduct) candidates.add(value);
    index = found.end - 1;
  }
  return [...candidates].sort((a, b) => a - b);
}

function extractLocation(message: string): string | null {
  const locationText = message.replace(/\b(?:outside|outside of|other than|sa labas ng)\s+(?:the\s+)?metro manila\b/g, " ");
  const matches = regions.flatMap((region) => region.aliases
    .filter((alias) => containsPhrase(locationText, alias))
    .map((alias) => ({ region: region.name, length: alias.length })));
  matches.sort((a, b) => b.length - a.length);
  return matches[0]?.region ?? null;
}

function unknownProductQuery(message: string): string | null {
  const words = [...new Set(message.split(" ").filter((word) =>
    !stopWords.has(word) && !/^\d+$/.test(word) &&
    !regions.some((region) => region.aliases.some((alias) =>
      normalizeMessage(alias).split(" ").includes(word)
    ))
  ))];
  return words.length ? words.join(" ") : null;
}

function hasAny(message: string, phrases: string[]): boolean {
  return phrases.some((phrase) => containsPhrase(message, phrase));
}

export function understandFromRules(
  message: string,
  catalog: CatalogProduct[],
): Understanding {
  const normalized = normalizeMessage(message);
  const productMatches = findProductMatches(normalized, catalog);
  const bestMatch = productMatches[0];
  const productQuery = bestMatch?.alias ?? unknownProductQuery(normalized);
  const inferredProductStart = productQuery
    ? normalized.split(" ").indexOf(normalizeMessage(productQuery).split(" ")[0])
    : -1;
  const productStart = bestMatch?.start ??
    (inferredProductStart >= 0 ? inferredProductStart : null);
  const sizes = bestMatch?.product.sizes ?? [];
  const size = bestMatch ? extractSize(normalized, sizes) : null;
  const quantities = extractQuantities(normalized, productStart);
  const location = extractLocation(normalized);
  const orderIntent = hasAny(normalized, intentPhrases.order_confirm);
  const availabilityRequested = hasAny(normalized, intentPhrases.availability);
  const ambiguousQuery = Boolean(productQuery) &&
    resolveProduct(productQuery, catalog).status === "ambiguous";
  const availabilityCue = hasAny(normalized, intentPhrases.availability) ||
    (bestMatch && size !== null && /\b(may|meron|mayroon)\b/.test(normalized));
  const sellerAvailability = /\b(what time|anong oras|anong araw|kailan|kelan|when)\b/.test(normalized) &&
    /\b(seller|siya|sya|kayo|owner|shop)\b/.test(normalized) &&
    /\b(avail|available|online|active|free|chat|reply|message|magchat|mag chat)\b/.test(normalized);
  const sizeRecommendation = /\b(size|fit|recommend|recommendation|recommendation)\b/.test(normalized) &&
    /\b\d+(?:\.\d+)?\s*(?:kg|kgs|cm|ft|feet|lbs|lb)\b|\b\d+\s*['’]\s*\d+/.test(normalized);

  let intent: UnderstandingIntent = "unknown";
  if (sellerAvailability) intent = "seller_availability";
  else if (hasAny(normalized, intentPhrases.size_chart)) intent = "size_chart";
  else if (hasAny(normalized, intentPhrases.catalog)) intent = "catalog";
  else if (sizeRecommendation || hasAny(normalized, intentPhrases.seller_handoff)) intent = "seller_handoff";
  else if (hasAny(normalized, intentPhrases.after_sales) && !/\b(damaged|wrong item|wrong size|sira|late delivery|late parcel|disappointed|reklamo|complaint)\b/.test(normalized)) intent = "after_sales";
  else if (hasAny(normalized, intentPhrases.business_hours)) intent = "business_hours";
  else if (hasAny(normalized, intentPhrases.shop_info)) intent = "shop_info";
  else if (hasAny(normalized, intentPhrases.complaint)) intent = "complaint";
  else if (hasAny(normalized, intentPhrases.other)) intent = "other";
  else if (hasAny(normalized, intentPhrases.status)) intent = "status";
  else if (/\b(nasaan|asan)\b.*\b(order|parcel)\b/.test(normalized)) intent = "status";
  else if (hasAny(normalized, intentPhrases.payment) || /\b(pay|paid|paying|downpayment|deposit)\b/.test(normalized)) intent = "payment";
  else if (hasAny(normalized, intentPhrases.order_help)) intent = "order_help";
  else if (hasAny(normalized, intentPhrases.bulk)) intent = "bulk";
  else if (hasAny(normalized, intentPhrases.discount)) intent = "discount";
  else if (hasAny(normalized, otherAreaShippingPhrases)) intent = "shipping";
  else if (!bestMatch && hasAny(normalized, intentPhrases.shipping)) intent = "shipping";
  else if (hasAny(normalized, intentPhrases.price)) intent = "price";
  else if (normalized === "mp") intent = "price";
  else if (hasAny(normalized, intentPhrases.availability)) intent = "availability";
  else if (availabilityCue) intent = "availability";
  else if (hasAny(normalized, intentPhrases.shipping)) intent = "shipping";
  else if (orderIntent) intent = "order_confirm";
  else if (hasAny(normalized, intentPhrases.greeting)) intent = "greeting";
  else if (ambiguousQuery && /\b(may|meron|mayroon)\b/.test(normalized)) {
    intent = quantities.length > 1 && /\b(and|or)\b/.test(normalized)
      ? "availability"
      : "question";
  }
  else if (bestMatch && quantities.length > 1 && /\b(and|or)\b/.test(normalized)) intent = "availability";
  else if (bestMatch) intent = "question";

  if (intent === "unknown" && productQuery &&
    resolveProduct(productQuery, catalog).status === "matched") intent = "question";

  const confidence = intent === "unknown" ? 0 : 0.95;
  return {
    intent,
    product_query: intent === "other" && !bestMatch ? null : productQuery,
    size,
    quantity: quantities.length === 1 ? quantities[0] : null,
    quantities_mentioned: quantities,
    location,
    confidence,
    availability_requested: availabilityRequested,
  };
}
