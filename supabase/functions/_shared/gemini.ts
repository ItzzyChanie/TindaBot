export type AiResult = {
  intent: string;
  product_query: string | null;
  size: string | null;
  color: string | null;
  qty: number | null;
  language: "en" | "tl" | "taglish";
  reply: string | null;
};

export type CatalogHint = { name: string; category?: string | null; sizes?: string[]; colors?: string[] };
export type GeminiConfig = { enabled: boolean; key?: string; model?: string; fetcher?: typeof fetch };

const allowedIntents = new Set([
  "greeting", "question", "price", "availability", "order_confirm", "status", "payment",
  "order_help", "bulk", "shop_info", "business_hours", "after_sales", "discount",
  "discount_timing", "future_discount", "seller_handoff", "catalog", "size_chart",
  "seller_availability", "shipping", "complaint", "other",
]);

const SYSTEM_PROMPT = `You are TindaBot's intent classifier for a small Filipino online clothing/ukay shop. Return ONLY a JSON object with this shape: {"intent":"existing intent name or other","product_query":string|null,"size":string|null,"color":string|null,"qty":number|null,"language":"en"|"tl"|"taglish","reply":string|null}. Use only catalog hints for product identification. For intent other, reply briefly and helpfully to greetings, thanks, or general shipping/payment questions, in the customer's language, maximum 2 sentences. Never state prices, discounts, stock numbers, or stock promises. Never invent shop policies.`;

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

function parseResult(value: unknown): AiResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.intent !== "string" || (row.intent !== "other" && !allowedIntents.has(row.intent))) return null;
  if (!(row.product_query === null || typeof row.product_query === "string")) return null;
  if (!(row.size === null || typeof row.size === "string")) return null;
  if (!(row.color === null || typeof row.color === "string")) return null;
  if (!(row.qty === null || (typeof row.qty === "number" && Number.isInteger(row.qty) && row.qty > 0 && row.qty <= 100))) return null;
  if (!(row.language === "en" || row.language === "tl" || row.language === "taglish")) return null;
  return {
    intent: row.intent,
    product_query: row.product_query,
    size: row.size,
    color: row.color,
    qty: row.qty,
    language: row.language,
    reply: row.intent === "other" ? safeReply(row.reply) : null,
  };
}

export async function geminiUnderstand(text: string, catalogHints: CatalogHint[], config: GeminiConfig = {
  enabled: geminiFallbackEnabled(),
  key: envValue("GEMINI_API_KEY"),
  model: envValue("GEMINI_MODEL"),
}): Promise<AiResult | null> {
  if (!config.enabled || !config.key || !config.model) return null;
  const hints = catalogHints.slice(0, 40).map(({ name, category, sizes, colors }) => ({
    name, category: category ?? null, sizes: sizes ?? [], colors: colors ?? [],
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
          contents: [{ role: "user", parts: [{ text: `${text}\n\nCatalog hints: ${JSON.stringify(hints)}` }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 300, responseMimeType: "application/json" },
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
    const result = parseResult(parsed);
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
