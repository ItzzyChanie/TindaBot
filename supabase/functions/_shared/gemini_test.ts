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
  qty: 1, language: "taglish", reply: null,
};

Deno.test("valid JSON maps to an existing intent", async () => {
  const result = await geminiUnderstand("available pa?", hints, {
    enabled: true, key: "test-key", model: "test-model",
    fetcher: async () => response(classification),
  });
  if (result?.intent !== "availability" || result.product_query !== "Isla blouse") throw new Error("Expected mapped availability intent");
});

Deno.test("429 returns null", async () => {
  const result = await geminiUnderstand("hello", hints, {
    enabled: true, key: "test-key", model: "test-model", fetcher: async () => new Response("{}", { status: 429 }),
  });
  if (result !== null) throw new Error("Expected quota response to fall back");
});

Deno.test("timeout returns null", async () => {
  const result = await geminiUnderstand("hello", hints, {
    enabled: true, key: "test-key", model: "test-model",
    fetcher: (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
  });
  if (result !== null) throw new Error("Expected timeout to fall back");
});

Deno.test("unsafe numeric other reply is dropped", async () => {
  const result = await geminiUnderstand("how do I pay?", hints, {
    enabled: true, key: "test-key", model: "test-model",
    fetcher: async () => response({ intent: "other", product_query: null, size: null, color: null, qty: null, language: "en", reply: "Pay ₱250 po." }),
  });
  if (result?.reply !== null) throw new Error("Expected unsafe reply text to be dropped");
});

Deno.test("fallback off never calls fetch", async () => {
  let called = false;
  const result = await geminiUnderstand("hello", hints, {
    enabled: false, key: "test-key", model: "test-model",
    fetcher: async () => { called = true; return response(classification); },
  });
  if (called || result !== null) throw new Error("Expected disabled fallback not to fetch");
});
