import { createClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const telegramToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin: string) => origin.trim())
  .filter(Boolean);

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);
  if (request.headers.has("Origin") && !cors)
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors ?? {} });
  if (request.method !== "POST")
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: cors ?? {} },
    );

  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !supabaseUrl || !anonKey)
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: cors ?? {} },
    );

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization! } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user)
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: cors ?? {} },
    );
  if (!telegramToken)
    return Response.json(
      { error: "Telegram is not configured" },
      { status: 500, headers: cors ?? {} },
    );

  let body: { conversationId?: unknown; text?: unknown; sendDraft?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON" },
      { status: 400, headers: cors ?? {} },
    );
  }
  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const sendDraft = body.sendDraft === true;
  if (!conversationId || !text || text.length > 4000) {
    return Response.json(
      {
        error:
          "A conversation and reply of up to 4,000 characters are required",
      },
      { status: 400, headers: cors ?? {} },
    );
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id, customer_id, ai_mode, status, pending")
    .eq("id", conversationId)
    .maybeSingle();
  if (conversationError || !conversation)
    return Response.json(
      { error: "Conversation not found" },
      { status: 404, headers: cors ?? {} },
    );
  const pending = typeof conversation.pending === "object" && conversation.pending !== null
    ? conversation.pending as Record<string, unknown>
    : {};
  if (sendDraft && (conversation.ai_mode !== "suggest" || pending.ai_draft !== text))
    return Response.json(
      { error: "This AI draft is no longer available" },
      { status: 409, headers: cors ?? {} },
    );

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("channel, external_id")
    .eq("id", conversation.customer_id)
    .maybeSingle();
  if (customerError || !customer || customer.channel !== "telegram") {
    return Response.json(
      { error: "This conversation cannot be replied to through Telegram" },
      { status: 400, headers: cors ?? {} },
    );
  }

  const { error: messageError } = await supabase.from("messages").insert({
    conversation_id: conversation.id,
    sender: sendDraft ? "ai" : "seller",
    body: text,
  });
  if (messageError)
    return Response.json(
      { error: "Could not save the reply" },
      { status: 500, headers: cors ?? {} },
    );

  const nextPending = { ...pending };
  delete nextPending.ai_draft;
  const { error: modeError } = await supabase
    .from("conversations")
    .update({
      ...(sendDraft ? {} : { ai_mode: "human", pending: {} }),
      ...(sendDraft ? { pending: nextPending } : {}),
      status: conversation.status === "needs_seller" ? "open" : conversation.status,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", conversation.id);
  if (modeError)
    return Response.json(
      { error: "Reply saved, but conversation mode could not be updated" },
      { status: 500, headers: cors ?? {} },
    );

  try {
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${telegramToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: customer.external_id, text }),
      },
    );
    if (!telegramResponse.ok)
      return Response.json(
        { error: "Reply saved, but Telegram could not deliver it" },
        { status: 502, headers: cors ?? {} },
      );
  } catch {
    return Response.json(
      { error: "Reply saved, but Telegram could not be reached" },
      { status: 502, headers: cors ?? {} },
    );
  }

  return Response.json({ ok: true }, { headers: cors ?? {} });
});
