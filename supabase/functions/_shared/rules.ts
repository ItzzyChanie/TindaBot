export type UnderstandingIntent =
  | "greeting"
  | "question"
  | "price"
  | "availability"
  | "order_confirm"
  | "status"
  | "payment"
  | "order_help"
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
};

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
  complaint: ["complaint", "reklamo", "sira", "damaged", "wrong item", "wrong size", "refund", "return", "late delivery", "late parcel", "no updates", "disappointed", "hindi dumating", "did not arrive", "didn't arrive", "not delivered", "received the wrong"],
  other: ["custom", "customize", "customise", "tailor", "alter", "personalized", "personalised", "do you sell", "nagbebenta", "may tinda"],
  status: ["order status", "nasaan order", "asan order", "nasaan na order", "update sa parcel", "track my order", "where is my order", "tracking", "order confirmation", "follow up", "follow-up", "na ship na", "parcel ko"],
  payment: ["payment", "magbayad", "paano magbayad", "gcash", "bank transfer", "payment details", "cash on delivery", "cod"],
  order_help: ["paano mag order", "paano umorder", "how to order", "how can i order", "how to buy"],
  price: ["magkano", "how much", "price", "presyo", "hm", "total magkano", "cost"],
  availability: ["available", "availability", "may stock", "in stock", "meron pa", "available pa", "mayroon pa", "anong sizes", "anong size", "available sizes"],
  shipping: ["shipping", "delivery fee", "shipping fee", "pa deliver", "padeliver", "deliver sa", "ship to", "shipping to", "delivery", "deliver", "nagde deliver", "gaano katagal"],
  order_confirm: ["order na", "order ko na", "confirm order", "confirm", "i-confirm", "sige kunin", "kuha ko na", "kukuha", "kunin ko", "pabili", "checkout", "mine", "go na"],
  greeting: ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "kamusta", "kumusta", "musta"],
};

const stopWords = new Set([
  "magkano", "how", "much", "price", "presyo", "hm", "cost", "available",
  "availability", "stock", "meron", "may", "ba", "have", "do", "you", "it",
  "the", "a", "an", "is", "of", "to", "for", "me", "please", "paki", "po",
  "ang", "yung", "ng", "sa", "pa", "ano", "anong", "deliver", "delivery", "ship", "shipping",
  "fee", "item", "items", "pcs", "pc", "piece", "pieces", "piraso", "qty",
  "quantity", "size", "sizes", "order", "gusto", "ko", "nito", "iyan", "ito", "na",
  "with", "and", "or", "medium", "med", "small", "large", "extra", "xl", "xxl", "kayo", "kami",
  ...Object.keys(numberWords),
]);

export function normalizeMessage(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function containsPhrase(message: string, phrase: string): boolean {
  return ` ${message} `.includes(` ${normalizeMessage(phrase)} `);
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
  const token = normalized.split(" ").find((word) => numberWords[word] !== undefined);
  return token ? numberWords[token] : null;
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
  const normalizedQuery = normalizeMessage(query ?? "");
  if (!normalizedQuery) return { status: "not_found", candidates: [] };
  const scored = products.map((product) => {
    const names = [product.name, ...(product.aliases ?? [])]
      .map(normalizeMessage).filter(Boolean);
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

function findProductMatches(message: string, catalog: CatalogProduct[]): ProductMatch[] {
  const matches: ProductMatch[] = [];
  for (const product of catalog) {
    for (const alias of [product.name, ...(product.aliases ?? [])]) {
      const normalizedAlias = normalizeMessage(alias);
      if (!normalizedAlias) continue;
      const variants = [normalizedAlias, `${normalizedAlias}s`];
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
    const token = tokens[index];
    const value = /^\d{1,2}$/.test(token) ? Number(token) : numberWords[token];
    if (!value || value > 100) continue;
    const prev = tokens[index - 1] ?? "";
    const next = tokens[index + 1] ?? "";
    const hasUnit = quantityUnits.has(next) || quantityUnits.has(prev);
    const nearProduct = productStart !== null && productStart >= index &&
      productStart - index <= 4 &&
      tokens.slice(index + 1, productStart).every((word) =>
        Object.values(sizeWords).flat().includes(word) || word === "size" ||
        word === "or" || word === "and" || /^\d{1,2}$/.test(word)
      );
    const prefixed = prev === "x" || prev === "qty" || prev === "quantity";
    const nextIsSize = Object.values(sizeWords).flat().includes(next);
    const followsProduct = productStart !== null && index > productStart &&
      index - productStart <= 4 && (hasUnit || next === "x" || nextIsSize);
    if (hasUnit || nearProduct || prefixed || followsProduct) candidates.add(value);
  }
  return [...candidates].sort((a, b) => a - b);
}

function extractLocation(message: string): string | null {
  const matches = regions.flatMap((region) => region.aliases
    .filter((alias) => containsPhrase(message, alias))
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
  const ambiguousQuery = Boolean(productQuery) &&
    resolveProduct(productQuery, catalog).status === "ambiguous";
  const availabilityCue = hasAny(normalized, intentPhrases.availability) ||
    (bestMatch && size !== null && /\b(may|meron|mayroon)\b/.test(normalized));

  let intent: UnderstandingIntent = "unknown";
  if (hasAny(normalized, intentPhrases.complaint)) intent = "complaint";
  else if (hasAny(normalized, intentPhrases.other)) intent = "other";
  else if (hasAny(normalized, intentPhrases.status)) intent = "status";
  else if (/\b(nasaan|asan)\b.*\b(order|parcel)\b/.test(normalized)) intent = "status";
  else if (hasAny(normalized, intentPhrases.payment)) intent = "payment";
  else if (hasAny(normalized, intentPhrases.order_help)) intent = "order_help";
  else if (!bestMatch && hasAny(normalized, intentPhrases.shipping)) intent = "shipping";
  else if (hasAny(normalized, intentPhrases.price)) intent = "price";
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

  const confidence = intent === "unknown" ? 0 : 0.95;
  return {
    intent,
    product_query: intent === "other" && !bestMatch ? null : productQuery,
    size,
    quantity: quantities.length === 1 ? quantities[0] : null,
    quantities_mentioned: quantities,
    location,
    confidence,
  };
}
