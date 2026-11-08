import { geminiUnderstand } from "./gemini.ts";

const hints = [{ name: "Isla blouse", sizes: ["S", "M"], colors: ["blue"] }];

function response(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 12 },
  }), { status, headers: { "content-type": "application/json" } });
}

const classification = {
  intent: "availability", product_query: "Isla blouse", size: "M", color: "blue",
  qty: 1, product_ref: null, language: "taglish", reply: null,
};

const config = (fetcher: typeof fetch) => ({ enabled: true, key: "test-key", model: "test-model", fetcher });

Deno.test("valid JSON maps to an existing intent", async () => {
  const result = await geminiUnderstand("available pa?", hints, {}, config(async () => response(classification)));
  if (result?.intent !== "availability" || result.product_query !== "Isla blouse") throw new Error("Expected mapped availability intent");
});

Deno.test("429 returns null", async () => {
  const result = await geminiUnderstand("hello", hints, {}, config(async () => new Response("{}", { status: 429 })));
  if (result !== null) throw new Error("Expected quota response to fall back");
});

Deno.test("timeout returns null", async () => {
  const result = await geminiUnderstand("hello", hints, {}, config((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
  if (result !== null) throw new Error("Expected timeout to fall back");
});

Deno.test("unsafe numeric other reply is dropped", async () => {
  const result = await geminiUnderstand("how do I pay?", hints, {}, config(async () => response({ intent: "other", product_query: null, size: null, color: null, qty: null, product_ref: null, language: "en", reply: "Pay ₱250 po." })));
  if (result?.reply !== null) throw new Error("Expected unsafe reply text to be dropped");
});

Deno.test("fallback off never calls fetch", async () => {
  let called = false;
  const result = await geminiUnderstand("hello", hints, {}, {
    ...config(async () => { called = true; return response(classification); }), enabled: false,
  });
  if (called || result !== null) throw new Error("Expected disabled fallback not to fetch");
});

Deno.test("unknown product_ref is returned as null", async () => {
  const result = await geminiUnderstand("how much was that?", hints, { recent: [{ id: "known", name: "Known blouse" }] }, config(async () => response({ ...classification, intent: "price", product_ref: "not-in-recent" })));
  if (result?.product_ref !== null) throw new Error("Expected out-of-list product reference to be discarded");
});

Deno.test("history contact details and street addresses are masked in the outgoing request", async () => {
  let sentBody = "";
  await geminiUnderstand("hello", hints, { history: [{ role: "customer", text: "Call me at 0917 123 4567 or demo@example.com, 123 Mabini Street" }] }, config(async (_input, init) => {
    sentBody = String(init?.body ?? "");
    return response(classification);
  }));
  if (["0917 123 4567", "demo@example.com", "123 Mabini Street"].some((value) => sentBody.includes(value)) || (sentBody.match(/\[hidden\]/g) ?? []).length < 3) {
    throw new Error("Expected history contact details and address to be masked");
  }
});
