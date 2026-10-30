import {
  resolveProduct,
  understandFromRules,
  type CatalogProduct,
} from "../supabase/functions/_shared/rules.ts";

type EvalCase = {
  message: string;
  expected: {
    intent: string;
    product: string | null;
    size: string | null;
    quantity: number | null;
  };
};

const catalog: CatalogProduct[] = [
  { name: "Bayanihan Basic T-Shirt", aliases: ["t-shirt", "basic tee", "cotton t-shirt"], sizes: ["S", "M", "L"] },
  { name: "Isla Linen Top", aliases: ["Isla blouse", "Isla top"], sizes: ["S", "M", "L"] },
  { name: "Sinta Wrap Dress", aliases: ["Sinta dress", "wrap dress"], sizes: ["S", "M", "L"] },
  { name: "Amihan Cotton Tee", aliases: ["Amihan shirt", "Amihan tee"], sizes: ["S", "M"] },
  { name: "Tala Pleated Skirt", aliases: ["Tala skirt"], sizes: ["S", "M"] },
  { name: "Luna Knit Cardigan", aliases: ["Luna cardigan"], sizes: ["S", "M"] },
  { name: "Baybay Cropped Pants", aliases: ["Baybay trousers", "Baybay pants"], sizes: ["M", "L"] },
  { name: "Dahlia Puff Sleeve Blouse", aliases: ["Dahlia blouse", "Dahlia top"], sizes: ["S", "M"] },
  { name: "Sol Bucket Hat", aliases: ["Sol hat", "bucket hat"], sizes: ["One size"] },
  { name: "Habi Ribbed Tank Top", aliases: ["ribbed tank", "tank top"], sizes: ["S", "M", "L"] },
  { name: "Liway Midi Skirt", aliases: ["midi skirt", "Liway skirt"], sizes: ["S", "M", "L"] },
  { name: "Amara Linen Trousers", aliases: ["linen pants", "linen trousers"], sizes: ["S", "M", "L"] },
];

const cases = JSON.parse(await Deno.readTextFile("eval/messages.json")) as EvalCase[];
const diagnose = Deno.args.includes("--diagnose") || Deno.env.get("EVAL_DIAGNOSE") === "true";
const showFailures = Deno.args.includes("--failures");
const limitArgument = Deno.args.find((argument) => argument.startsWith("--limit="))?.split("=", 2)[1]
  ?? Deno.env.get("EVAL_LIMIT");
const limit = limitArgument === undefined ? cases.length : Number(limitArgument);
if (!Number.isInteger(limit) || limit < 1) {
  console.error("Use --limit with a positive whole number, for example --limit=3.");
  Deno.exit(1);
}
const casesToRun = cases.slice(0, diagnose ? 1 : Math.min(limit, cases.length));
const correct = { intent: 0, product: 0, size: 0, quantity: 0 };
let diagnostic: ReturnType<typeof understandFromRules> | null = null;

for (const testCase of casesToRun) {
  const actual = understandFromRules(testCase.message, catalog);
  diagnostic = actual;
  const resolution = actual.intent === "unknown"
    ? null
    : resolveProduct(actual.product_query, catalog);
  const product = resolution?.status === "matched" ? resolution.product.name : null;
  if (showFailures && (
    actual.intent !== testCase.expected.intent ||
    product !== testCase.expected.product ||
    (actual.size ?? null)?.toLowerCase() !== testCase.expected.size?.toLowerCase() ||
    (actual.quantity ?? null) !== testCase.expected.quantity
  )) {
    console.log(JSON.stringify({
      message: testCase.message,
      expected: testCase.expected,
      actual: {
        intent: actual.intent,
        product,
        size: actual.size,
        quantity: actual.quantity,
      },
    }));
  }
  if (actual.intent === testCase.expected.intent) correct.intent += 1;
  if (product === testCase.expected.product) correct.product += 1;
  if ((actual.size ?? null)?.toLowerCase() === testCase.expected.size?.toLowerCase()) correct.size += 1;
  if ((actual.quantity ?? null) === testCase.expected.quantity) correct.quantity += 1;
}

if (diagnose) {
  console.log("Rule diagnostic message: " + casesToRun[0].message);
  console.log(JSON.stringify(diagnostic, null, 2));
  Deno.exit(0);
}

console.log(`Rule samples:  ${casesToRun.length}/${cases.length}`);
console.log(`Intent:       ${score(correct.intent, casesToRun.length)}`);
console.log(`Product:      ${score(correct.product, casesToRun.length)}`);
console.log(`Size:         ${score(correct.size, casesToRun.length)}`);
console.log(`Quantity:     ${score(correct.quantity, casesToRun.length)}`);

function score(value: number, total: number): string {
  return `${value}/${total} (${total ? ((value / total) * 100).toFixed(1) : "0.0"}%)`;
}
