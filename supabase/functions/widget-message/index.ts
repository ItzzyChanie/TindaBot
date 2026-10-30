import { createClient } from "@supabase/supabase-js";
import { handleIncoming, saveAssistantReply } from "../_shared/handleIncoming.ts";

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
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);
  if (!cors) return json({ error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4096) return json({ error: "Request is too large" }, 413, cors);
  let body: { token?: unknown; text?: unknown; cursor?: unknown };
  try {
    const rawBody = await request.text();
    if (rawBody.length > 4096) return json({ error: "Request is too large" }, 413, cors);
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400, cors);
  }

  const token = typeof body.token === "string" ? body.token : "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return json({ error: "Invalid chat session" }, 401, cors);
  if (body.text !== undefined && typeof body.text !== "string") return json({ error: "Message must be text" }, 400, cors);
  const text = typeof body.text === "string" ? body.text : "";
  if ([...text].length > 500) return json({ error: "Messages can be up to 500 characters" }, 413, cors);
  const message = text.trim();
  let cursor: string | null = null;
  if (body.cursor !== undefined && body.cursor !== null) {
    if (typeof body.cursor !== "string" || !Number.isFinite(Date.parse(body.cursor)))
      return json({ error: "Invalid message cursor" }, 400, cors);
    cursor = body.cursor;
  }

  const tokenHash = await sha256(token);
  const { data: session, error: sessionError } = await supabase
    .from("widget_sessions")
    .select("token, customer_id, conversation_id")
    .eq("token", tokenHash)
    .maybeSingle();
  if (sessionError || !session) return json({ error: "Chat session expired. Please start a new chat." }, 401, cors);

  const { data: allowed, error: rateError } = await supabase.rpc("consume_widget_request", {
    p_token: tokenHash,
    p_is_message: message.length > 0,
  });
  if (rateError) {
    console.error("[widget-message] rate limit check failed", rateError.message);
    return json({ error: "Chat is temporarily unavailable. Please try again." }, 503, cors);
  }
  if (allowed !== true) return json({ error: "Sending messages too quickly. Please wait a moment." }, 429, cors);

  let conversationId = session.conversation_id as string;
  if (message) {
    const incoming = await handleIncoming("web", session.customer_id, message, { name: "Web chat visitor" });
    conversationId = incoming.conversationId;
    if (conversationId !== session.conversation_id) {
      const { error: updateError } = await supabase.from("widget_sessions")
        .update({ conversation_id: conversationId }).eq("token", tokenHash);
      if (updateError) throw updateError;
    }
    if (incoming.reply) await saveAssistantReply(conversationId, incoming.reply);
  }

  let query = supabase.from("messages")
    .select("id, sender, body, created_at")
    .eq("conversation_id", conversationId)
    .in("sender", ["customer", "ai", "seller"])
    .order("created_at", { ascending: true })
    .limit(100);
  if (cursor) query = query.gte("created_at", cursor);
  const { data: messages, error: messagesError } = await query;
  if (messagesError) {
    console.error("[widget-message] messages could not be loaded", messagesError.message);
    return json({ error: "Could not load chat messages. Please try again." }, 500, cors);
  }

  return json({
    messages: messages ?? [],
    cursor: messages?.at(-1)?.created_at ?? cursor,
  }, 200, cors);
});
