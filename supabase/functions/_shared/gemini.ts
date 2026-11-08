export type AiResult = {
  intent: string;
  product_query: string | null;
  size: string | null;
  color: string | null;
  qty: number | null;
  product_ref: string | null;
  language: "en" | "tl" | "taglish";
  reply: string | null;
};

export type CatalogHint = { name: string; category?: string | null; sizes?: string[]; colors?: string[] };
export type GeminiConfig = { enabled: boolean; key?: string; model?: string; fetcher?: typeof fetch };
export type GeminiContext = {
  history?: Array<{ role: "customer" | "bot"; text: string }>;
  recent?: Array<{ id: string; name: string }>;
};

const allowedIntents = new Set([
  "greeting", "question", "price", "availability", "order_confirm", "status", "payment",
  "order_help", "bulk", "shop_info", "business_hours", "after_sales", "discount",
  "discount_timing", "future_discount", "seller_handoff", "catalog", "size_chart",
  "seller_availability", "shipping", "complaint", "other",
]);

const SYSTEM_PROMPT = `You are TindaBot's intent classifier for a small Filipino online clothing/ukay shop. Return ONLY JSON matching the response schema. product_ref must be one of the provided recent product IDs or null. Use only the catalog and recent product hints to identify products. For intent other, reply briefly and helpfully to greetings, thanks, or general shipping/payment questions, in the customer's language, maximum 2 sentences. Never state prices, discounts, stock numbers, or stock promises. Never invent shop policies.`;

function envValue(name: string): string | undefined {
  return (globalThis as typeof globalThis & { Deno?: { env?: { get(key: string): string | undefined } } }).Deno?.env?.get(name);
}

export function geminiFallbackEnabled(): boolean {
  return envValue("AI_FALLBACK") === "on";
}

function safeReply(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 400) return null;
  if (/₱|PHP|\b(?:\d[\d,.]*\s*(?:pesos?|php)|(?:price|cost|discount)\s*(?:is|:)?\s*\d)/i.test(value)) return null;
  if (/\b\d+(?:[,.]\d+)?\b/.test(value)) return null;
  return value.trim();
}

function parseResult(value: unknown, recentIds: Set<string>): AiResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.intent !== "string" || (row.intent !== "other" && !allowedIntents.has(row.intent))) return null;
  if (!(row.product_query === null || typeof row.product_query === "string")) return null;
  if (!(row.size === null || typeof row.size === "string")) return null;
  if (!(row.color === null || typeof row.color === "string")) return null;
  if (!(row.qty === null || (typeof row.qty === "number" && Number.isInteger(row.qty) && row.qty > 0 && row.qty <= 100))) return null;
  if (!(row.product_ref === null || typeof row.product_ref === "string")) return null;
  if (!(row.language === "en" || row.language === "tl" || row.language === "taglish")) return null;
  return {
    intent: row.intent,
    product_query: row.product_query,
    size: row.size,
    color: row.color,
    qty: row.qty,
    product_ref: typeof row.product_ref === "string" && recentIds.has(row.product_ref) ? row.product_ref : null,
    language: row.language,
    reply: row.intent === "other" ? safeReply(row.reply) : null,
  };
}

function maskHistoryText(value: string): string {
  return value.slice(0, 200)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[hidden]")
    .replace(/\b(?:\+?63|0)(?:[\s().-]*\d){9,12}\b/g, "[hidden]")
    .replace(/\b\d{1,5}\s+(?:[\w.'-]+\s+){0,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|village|subdivision|subd)\b[^,\n]*/gi, "[hidden]")
    .replace(/\b(?:blk|block|lot|unit|apt|apartment)\s*#?\s*[\w-]+(?:\s+[\w-]+){0,5}/gi, "[hidden]");
}

export async function geminiUnderstand(text: string, catalogHints: CatalogHint[], context: GeminiContext = {}, config: GeminiConfig = {
  enabled: geminiFallbackEnabled(),
  key: envValue("GEMINI_API_KEY"),
  model: envValue("GEMINI_MODEL"),
}): Promise<AiResult | null> {
  if (!config.enabled || !config.key || !config.model) return null;
  const hints = catalogHints.slice(0, 40).map(({ name, category, sizes, colors }) => ({
    name, category: category ?? null, sizes: sizes ?? [], colors: colors ?? [],
  }));
  const recent = (context.recent ?? []).slice(0, 3);
  const recentIds = new Set(recent.map((item) => item.id));
  const history = (context.history ?? []).slice(-6).map((item) => ({
    role: item.role === "bot" ? "model" : "user",
    parts: [{ text: maskHistoryText(item.text) }],
  }));
  const controller = new AbortController();
  const started = Date.now();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let status = 0;
  let usage: Record<string, unknown> = {};
  let ok = false;
  try {
    const response = await (config.fetcher ?? fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": config.key, "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [...history, { role: "user", parts: [{ text: `${text}\n\nCatalog hints: ${JSON.stringify(hints)}\nRecent products (IDs must be used for product_ref): ${JSON.stringify(recent)}` }] }],
          generationConfig: {
            temperature: 0, maxOutputTokens: 300, responseMimeType: "application/json",
            responseSchema: { type: "OBJECT", properties: {
              intent: { type: "STRING", enum: [...allowedIntents] },
              product_query: { type: "STRING", nullable: true }, size: { type: "STRING", nullable: true },
              color: { type: "STRING", nullable: true }, qty: { type: "INTEGER", nullable: true },
              product_ref: { type: "STRING", nullable: true },
              language: { type: "STRING", enum: ["en", "tl", "taglish"] }, reply: { type: "STRING", nullable: true },
            }, required: ["intent", "product_query", "size", "color", "qty", "product_ref", "language", "reply"] },
          },
        }),
        signal: controller.signal,
      },
    );
    status = response.status;
    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown>;
    usage = (body.usageMetadata && typeof body.usageMetadata === "object") ? body.usageMetadata as Record<string, unknown> : {};
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const first = candidates[0] as Record<string, unknown> | undefined;
    const content = first?.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const part = parts[0] as Record<string, unknown> | undefined;
    if (first?.finishReason === "SAFETY" || typeof part?.text !== "string") return null;
    let parsed: unknown;
    try { parsed = JSON.parse(part.text); } catch { return null; }
    const result = parseResult(parsed, recentIds);
    ok = result !== null;
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    console.info("[gemini-fallback]", {
      model: config.model, status, promptTokenCount: usage.promptTokenCount ?? null,
      candidatesTokenCount: usage.candidatesTokenCount ?? null, latency_ms: Date.now() - started,
      result: ok ? "ok" : "fail",
    });
  }
}
