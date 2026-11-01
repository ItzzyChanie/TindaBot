import { createClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function secretIsSet(name: string): boolean {
  return Boolean(Deno.env.get(name)?.trim());
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);
  if (request.headers.has("Origin") && !cors)
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors ?? {} });
  if (request.method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: cors ?? {} });

  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !supabaseUrl || !anonKey)
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors ?? {} });

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization! } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user)
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors ?? {} });

  const messengerWebhookReady = secretIsSet("META_VERIFY_TOKEN") && secretIsSet("META_APP_SECRET");
  const instagramWebhookReady = secretIsSet("META_VERIFY_TOKEN") && secretIsSet("INSTAGRAM_APP_SECRET");
  return Response.json({
    channels: {
      telegram: secretIsSet("TELEGRAM_BOT_TOKEN") && secretIsSet("TELEGRAM_WEBHOOK_SECRET"),
      messenger: messengerWebhookReady && secretIsSet("MESSENGER_PAGE_TOKEN"),
      instagram: instagramWebhookReady && secretIsSet("INSTAGRAM_ACCESS_TOKEN") && secretIsSet("INSTAGRAM_ACCOUNT_ID"),
    },
  }, { headers: cors ?? { "Cache-Control": "no-store" } });
});
