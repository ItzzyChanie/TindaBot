const url = Deno.env.get("NEXT_PUBLIC_SUPABASE_URL")?.replace(/\/$/, "");
const key = Deno.env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY");

if (!url || !key) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and the publishable/anon key in .env.local first.");
}

const headers = { apikey: key };
const startedAt = performance.now();
const catalog = await fetch(`${url}/rest/v1/public_catalog?select=id,name,price,sizes&limit=1`, { headers });
if (!catalog.ok) throw new Error(`Anon view request failed with HTTP ${catalog.status}. Apply the Day 9 migration first.`);
const rows: unknown = await catalog.json();
if (!Array.isArray(rows)) throw new Error("The public catalog response was not a row list.");
console.log(`Anon key can read public_catalog: HTTP ${catalog.status}; ${rows.length} sample row(s), ${Math.round(performance.now() - startedAt)} ms.`);

for (const table of ["products", "variants", "promos"]) {
  const response = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, { headers });
  if (response.ok) throw new Error(`Security check failed: anon key can read the ${table} base table.`);
  console.log(`Anon key is denied from ${table}: HTTP ${response.status}.`);
}
