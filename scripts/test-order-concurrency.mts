const databaseUrl = Deno.env.get("TEST_DATABASE_URL") ?? "";
if (!databaseUrl) {
  console.error("Set TEST_DATABASE_URL to a local Supabase Postgres connection string.");
  Deno.exit(1);
}

const parsedUrl = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)) {
  console.error("Concurrency test refuses to run against a remote database.");
  Deno.exit(1);
}

const ids = Array.from({ length: 6 }, () => crypto.randomUUID());
const [productId, variantId, customerOne, customerTwo, conversationOne, conversationTwo] = ids;
let fixtureCreated = false;

async function psql(statement: string) {
  const command = new Deno.Command("psql", {
    args: ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement, databaseUrl],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  return {
    success: result.code === 0,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
  };
}

try {
  const setup = await psql(
    "BEGIN;" +
      "INSERT INTO public.products (id,name,price) VALUES ('" + productId + "','Mock concurrency item',10.00);" +
      "INSERT INTO public.variants (id,product_id,size,stock) VALUES ('" + variantId + "','" + productId + "','One size',1);" +
      "INSERT INTO public.customers (id,channel,external_id,name) VALUES " +
      "('" + customerOne + "','test','" + customerOne + "','Mock buyer 1')," +
      "('" + customerTwo + "','test','" + customerTwo + "','Mock buyer 2');" +
      "INSERT INTO public.conversations (id,customer_id) VALUES " +
      "('" + conversationOne + "','" + customerOne + "')," +
      "('" + conversationTwo + "','" + customerTwo + "');" +
      "COMMIT;",
  );
  if (!setup.success) throw new Error("Could not prepare the local test fixture: " + setup.stderr);
  fixtureCreated = true;

  const items = JSON.stringify([{ variant_id: variantId, qty: 1, unit_price: 10, offer_label: null }]).replaceAll("'", "''");
  const call = (conversationId: string) => psql(
    "SELECT public.create_order('" + conversationId + "','" + items + "'::jsonb,0,10);",
  );
  const results = await Promise.all([call(conversationOne), call(conversationTwo)]);
  const successes = results.filter((result) => result.success).length;
  const stockRejected = results.some((result) => !result.success && result.stderr.includes("OUT_OF_STOCK"));
  const stock = await psql("SELECT stock FROM public.variants WHERE id='" + variantId + "';");
  const orderCount = await psql(
    "SELECT count(*) FROM public.orders WHERE conversation_id IN ('" + conversationOne + "','" + conversationTwo + "');",
  );

  if (successes !== 1 || !stockRejected || stock.stdout !== "0" || orderCount.stdout !== "1") {
    console.error("Concurrency invariant failed.");
    for (const result of results) console.error(result.success ? "order created" : result.stderr);
    Deno.exitCode = 1;
  } else {
    console.log("Concurrency invariant passed: one order succeeded and stock reached zero.");
  }
} finally {
  if (fixtureCreated) {
    const cleanup = await psql(
      "BEGIN;" +
        "DELETE FROM public.orders WHERE conversation_id IN ('" + conversationOne + "','" + conversationTwo + "');" +
        "DELETE FROM public.conversations WHERE id IN ('" + conversationOne + "','" + conversationTwo + "');" +
        "DELETE FROM public.customers WHERE id IN ('" + customerOne + "','" + customerTwo + "');" +
        "DELETE FROM public.products WHERE id='" + productId + "';" +
        "COMMIT;",
    );
    if (!cleanup.success) {
      console.error("Could not clean up the local concurrency fixture: " + cleanup.stderr);
      Deno.exitCode = 1;
    }
  }
}
