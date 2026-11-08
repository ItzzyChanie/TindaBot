import {
  readRecentProducts,
  rememberProduct,
  resolveReference,
  runIncomingBrain,
  type BrainInput,
  type BrainProduct,
  type BrainRules,
} from "./brain.ts";
import { understandFromRules } from "./rules.ts";

const now = Date.parse("2026-11-08T04:00:00.000Z");
const products: BrainProduct[] = [
  { id: "dress", name: "Red Summer Dress", aliases: ["summer dress"], description: "Cotton dress", price: 800, active: true, discount_type: null, discount_value: null, discount_starts: null, discount_ends: null, colors: ["Red"], variants: [{ id: "dress-s", size: "S", stock: 5 }, { id: "dress-m", size: "M", stock: 4 }], promos: [] },
  { id: "jacket", name: "Denim Jacket", aliases: ["denim"], description: "Blue denim jacket", price: 1200, active: true, discount_type: null, discount_value: null, discount_starts: null, discount_ends: null, colors: ["Blue"], variants: [{ id: "jacket-m", size: "M", stock: 3 }], promos: [] },
  { id: "blouse", name: "Blue Linen Blouse", aliases: ["linen blouse"], description: "Linen blouse", price: 650, active: true, discount_type: null, discount_value: null, discount_starts: null, discount_ends: null, colors: ["Blue"], variants: [{ id: "blouse-s", size: "S", stock: 2 }], promos: [] },
];

function memory(ids: string[]) {
  return ids.reduce((state, id) => {
    const product = products.find((item) => item.id === id)!;
    return rememberProduct(state, product, {}, now);
  }, {} as Record<string, unknown>);
}

function input(message: string, pending: Record<string, unknown>): BrainInput {
  return {
    message, channel: "telegram", aiMode: "auto", status: "open", firstContact: false, pending,
    products, settings: { shipping_rates: { "Metro Manila": 80 }, payment_instructions: "", policies: "", size_chart_url: null },
    now: new Date(now),
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("three recent products: dress follow-up resolves before Gemini", async () => {
  let geminiCalls = 0;
  const rules: BrainRules = {
    understand: understandFromRules,
    fallbackEnabled: () => true,
    fallback: async () => { geminiCalls++; return null; },
  };
  const result = await runIncomingBrain(input("Magkano ulit yung dress?", memory(["blouse", "jacket", "dress"])), rules);
  assert(geminiCalls === 0, "Gemini should not run for a rules-resolved product question");
  assert(result.reply?.includes("Red Summer Dress"), "Expected the dress in the rules reply");
});

Deno.test("one recent product resolves a vague follow-up", () => {
  const result = resolveReference("how much was that one?", memory(["dress"]), null, products, now);
  assert(result.kind === "resolved" && result.product.product_id === "dress", "Expected recent dress reference");
});

Deno.test("two recent products clarify and numeric reply selects the second", async () => {
  const pending = memory(["jacket", "dress"]);
  const clarify = await runIncomingBrain(input("that one", pending), { understand: understandFromRules, fallbackEnabled: () => true, fallback: async () => { throw new Error("Gemini must not run while clarifying"); } });
  assert(clarify.reply?.includes("Red Summer Dress") && clarify.reply.includes("Denim Jacket"), "Expected both clarification options");
  assert(clarify.replyMarkup?.inline_keyboard, "Expected Telegram inline keyboard options");
  const selected = await runIncomingBrain(input("2", clarify.pending), { understand: understandFromRules, fallbackEnabled: () => true, fallback: async () => { throw new Error("Gemini must not run for a numbered selection"); } });
  assert(selected.reply?.includes("Denim Jacket"), "Expected option 2 to select Denim Jacket");
});

Deno.test("Telegram reply context resolves an older bot message product", () => {
  const result = resolveReference("how much again?", memory(["blouse"]), "Earlier quote for Red Summer Dress size M", products, now);
  assert(result.kind === "resolved" && result.product.product_id === "dress", "Expected the replied-to dress");
});

Deno.test("recent product older than 24 hours is ignored", () => {
  const state = { recent_products: [{ product_id: "dress", name: "Red Summer Dress", at: new Date(now - 86400001).toISOString() }] };
  assert(readRecentProducts(state, now).length === 0, "Expected expired memory to be dropped");
  assert(resolveReference("how much was that one?", state, null, products, now).kind === "none", "Expired reference should not resolve");
});
