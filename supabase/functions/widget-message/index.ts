import { createClient } from "@supabase/supabase-js";
import { handleIncoming, saveAssistantReply } from "../_shared/handleIncoming.ts";
import { ATTACHMENT_BUCKET, type MessageAttachment } from "../_shared/message-attachments.ts";

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
  let body: { token?: unknown; text?: unknown; cursor?: unknown; product_id?: unknown; action?: unknown; message_id?: unknown; reply_to_message_id?: unknown };
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
  if (body.product_id !== undefined && body.product_id !== null &&
    (typeof body.product_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.product_id)))
    return json({ error: "Invalid product" }, 400, cors);
  const text = typeof body.text === "string" ? body.text : "";
  if ([...text].length > 500) return json({ error: "Messages can be up to 500 characters" }, 413, cors);
  let cursor: string | null = null;
  if (body.cursor !== undefined && body.cursor !== null) {
    if (typeof body.cursor !== "string" || !Number.isFinite(Date.parse(body.cursor)))
      return json({ error: "Invalid message cursor" }, 400, cors);
    cursor = new Date(body.cursor).toISOString();
  }
  const syncCursor = new Date().toISOString();
  const message = text.trim();
  const tokenHash = await sha256(token);
  const { data: session, error: sessionError } = await supabase
    .from("widget_sessions")
    .select("token, customer_id, conversation_id")
    .eq("token", tokenHash)
    .maybeSingle();
  if (sessionError || !session) return json({ error: "Chat session expired. Please start a new chat." }, 401, cors);

  const { data: allowed, error: rateError } = await supabase.rpc("consume_widget_request", {
    p_token: tokenHash,
    p_is_message: message.length > 0 && body.action === undefined,
  });
  if (rateError) {
    console.error("[widget-message] rate limit check failed", rateError.message);
    return json({ error: "Chat is temporarily unavailable. Please try again." }, 503, cors);
  }
  if (allowed !== true) return json({ error: "Sending messages too quickly. Please wait a moment." }, 429, cors);

  const action = body.action === "edit" || body.action === "unsend" ? body.action : null;
  if (body.action !== undefined && !action) return json({ error: "Unsupported message action" }, 400, cors);
  if (action) {
    if (typeof body.message_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.message_id))
      return json({ error: "Invalid message" }, 400, cors);
    const editedText = typeof body.text === "string" ? body.text.trim() : "";
    if (action === "edit" && (!editedText || [...editedText].length > 500))
      return json({ error: "Edited messages must be 1 to 500 characters" }, 400, cors);
    const { data: target, error: targetError } = await supabase.from("messages")
      .select("id, sender, body, image_urls, attachments, unsent_at")
      .eq("id", body.message_id).eq("conversation_id", session.conversation_id).maybeSingle();
    if (targetError || !target || target.sender !== "customer" || target.unsent_at)
      return json({ error: "This message cannot be changed" }, 409, cors);
    if ((target.image_urls?.length ?? 0) || (target.attachments?.length ?? 0))
      return json({ error: "Only text messages can be edited or unsent" }, 409, cors);
    const { error: updateError } = await supabase.from("messages").update(action === "edit"
      ? { body: editedText, edited_at: new Date().toISOString() }
      : { body: "", unsent_at: new Date().toISOString() }).eq("id", target.id);
    if (updateError) return json({ error: "Could not update this message" }, 500, cors);
    return json({ ok: true }, 200, cors);
  }

  let conversationId = session.conversation_id as string;
  let productId = typeof body.product_id === "string" ? body.product_id : null;
  if (productId) {
    const { data: product, error } = await supabase.from("products")
      .select("id").eq("id", productId).eq("active", true).maybeSingle();
    if (error) return json({ error: "Could not load this product" }, 503, cors);
    if (!product) return json({ error: "This product is no longer available" }, 404, cors);
    productId = product.id;
    const { error: contextError } = await supabase.from("conversations")
      .update({ context_product_id: productId }).eq("id", conversationId);
    if (contextError) throw contextError;
  }
  if (message) {
    const replyToMessageId = typeof body.reply_to_message_id === "string" ? body.reply_to_message_id : undefined;
    const incoming = await handleIncoming("web", session.customer_id, message, { name: "Web chat visitor", productId, replyToMessageId });
    conversationId = incoming.conversationId;
    if (conversationId !== session.conversation_id) {
      const { error: updateError } = await supabase.from("widget_sessions")
        .update({ conversation_id: conversationId }).eq("token", tokenHash);
      if (updateError) throw updateError;
    }
    if (incoming.reply) await saveAssistantReply(
      conversationId,
      incoming.reply,
      incoming.imageUrls?.length ? incoming.imageUrls : incoming.imageUrl ? [incoming.imageUrl] : [],
    );
  }

  let query = supabase.from("messages")
    .select("id, sender, body, image_urls, attachments, reply_to_text, edited_at, unsent_at, created_at")
    .eq("conversation_id", conversationId)
    .in("sender", ["customer", "ai", "seller"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (cursor) query = query.or(`created_at.gte.${cursor},edited_at.gte.${cursor},unsent_at.gte.${cursor}`);
  const { data: messages, error: messagesError } = await query;
  if (messagesError) {
    console.error("[widget-message] messages could not be loaded", messagesError.message);
    return json({ error: "Could not load chat messages. Please try again." }, 500, cors);
  }

  const messageRows = [...(messages ?? [])].reverse();
  const attachmentRows = messageRows.flatMap((message) => (message.attachments ?? []) as MessageAttachment[]);
  const { data: signedRows, error: signingError } = attachmentRows.length
    ? await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrls(
      attachmentRows.map((attachment) => attachment.path),
      60 * 60 * 24 * 90,
    )
    : { data: [], error: null };
  if (signingError) console.error("[widget-message] attachment signing failed", signingError.message);
  const signedByPath = new Map((signedRows ?? []).map((item) => [item.path, item.signedUrl]));
  const messagesWithSignedAttachments = messageRows.map((message) => ({
    ...message,
    attachments: ((message.attachments ?? []) as MessageAttachment[]).map((attachment) => ({
      ...attachment,
      signedUrl: signedByPath.get(attachment.path) ?? null,
    })),
  }));

  return json({
    messages: messagesWithSignedAttachments,
    cursor: syncCursor,
  }, 200, cors);
});
