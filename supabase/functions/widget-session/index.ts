import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

function corsHeaders(request: Request): HeadersInit | null {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(data: unknown, status: number, headers: HeadersInit = {}) {
  return Response.json(data, { status, headers });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);
  if (!cors) return json({ error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  let body: { product_id?: unknown } = {};
  try {
    const rawBody = await request.text();
    if (rawBody.length > 2048) return json({ error: "Request is too large" }, 413, cors);
    if (rawBody) body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400, cors);
  }

  const ip = request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";
  const { data: allowed, error: limitError } = await supabase.rpc(
    "consume_widget_session_creation",
    { p_ip_hash: await sha256(ip) },
  );
  if (limitError) {
    console.error("[widget-session] creation limit check failed", limitError.message);
    return json({ error: "Could not start chat. Please try again shortly." }, 503, cors);
  }
  if (allowed !== true) return json({ error: "Too many new chats. Please try again later." }, 429, cors);

  let productId: string | null = null;
  if (body.product_id !== undefined && body.product_id !== null) {
    if (typeof body.product_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.product_id))
      return json({ error: "Invalid product" }, 400, cors);
    const { data: product, error } = await supabase.from("products")
      .select("id").eq("id", body.product_id).eq("active", true).maybeSingle();
    if (error) return json({ error: "Could not load this product" }, 503, cors);
    if (!product) return json({ error: "This product is no longer available" }, 404, cors);
    productId = product.id;
  }

  const rawToken = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const customerId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const { error: customerError } = await supabase.from("customers").insert({
    id: customerId,
    channel: "web",
    external_id: customerId,
    name: "Web chat visitor",
  });
  if (customerError) {
    console.error("[widget-session] customer creation failed", customerError.message);
    return json({ error: "Could not start chat. Please try again." }, 500, cors);
  }

  const { error: conversationError } = await supabase.from("conversations").insert({
    id: conversationId,
    customer_id: customerId,
    context_product_id: productId,
  });
  if (conversationError) {
    await supabase.from("customers").delete().eq("id", customerId);
    console.error("[widget-session] conversation creation failed", conversationError.message);
    return json({ error: "Could not start chat. Please try again." }, 500, cors);
  }

  const { error: sessionError } = await supabase.from("widget_sessions").insert({
    token: await sha256(rawToken),
    customer_id: customerId,
    conversation_id: conversationId,
    created_from_hash: await sha256(ip),
  });
  if (sessionError) {
    await supabase.from("customers").delete().eq("id", customerId);
    console.error("[widget-session] session creation failed", sessionError.message);
    return json({ error: "Could not start chat. Please try again." }, 500, cors);
  }

  return json({ token: rawToken }, 201, cors);
});
