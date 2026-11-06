import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { deleteTelegramMessage, editTelegramTextMessage, isWithinCustomerWindow, sendToChannel, type MessageChannel } from "../_shared/channel-messaging.ts";
import { ATTACHMENT_BUCKET, validateAttachments, type MessageAttachment } from "../_shared/message-attachments.ts";
import { notifySeller } from "../_shared/notify.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
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

async function createChannelAttachments(
  supabase: SupabaseClient,
  attachments: MessageAttachment[],
) {
  const result = [];
  for (const attachment of attachments) {
    const { data, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(attachment.path, 60 * 60 * 24 * 90);
    if (error || !data?.signedUrl) throw new Error("attachment could not be accessed");
    result.push({ ...attachment, url: data.signedUrl });
  }
  return result;
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
  let body: {
    conversationId?: unknown;
    text?: unknown;
    sendDraft?: unknown;
    retryMessageId?: unknown;
    attachments?: unknown;
    action?: unknown;
    messageId?: unknown;
    replyToMessageId?: unknown;
  };
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
  const retryMessageId = typeof body.retryMessageId === "string" ? body.retryMessageId : null;
  const action = body.action === "edit" || body.action === "unsend" ? body.action : null;
  const actionMessageId = typeof body.messageId === "string" ? body.messageId : null;
  const replyToMessageId = typeof body.replyToMessageId === "string" ? body.replyToMessageId : null;
  const attachments = body.attachments === undefined
    ? []
    : validateAttachments(body.attachments, conversationId);
  if (!conversationId || attachments === null || (!action && !retryMessageId && !text && !attachments.length) || (action && !actionMessageId) || text.length > 4000) {
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
    .select("channel, external_id, name")
    .eq("id", conversation.customer_id)
    .maybeSingle();
  if (customerError || !customer || !["telegram", "messenger", "instagram", "web"].includes(customer.channel)) {
    return Response.json(
      { error: "This conversation channel cannot receive seller replies" },
      { status: 400, headers: cors ?? {} },
    );
  }
  const selectedAttachment = attachments[0];
  if (selectedAttachment && (customer.channel === "messenger" || customer.channel === "instagram")) {
    const maxBytes = selectedAttachment.mimeType.startsWith("image/")
      ? 8 * 1024 * 1024
      : 25_000_000;
    if (selectedAttachment.size > maxBytes) {
      return Response.json(
        { error: selectedAttachment.mimeType.startsWith("image/") ? "Meta image attachments must be 8 MB or smaller" : "Meta file attachments must be 25 MB or smaller" },
        { status: 413, headers: cors ?? {} },
      );
    }
  }
  if (action) {
    if (action === "edit" && !text) return Response.json({ error: "Edited messages cannot be empty" }, { status: 400, headers: cors ?? {} });
    const { data: target, error: targetError } = await supabase.from("messages")
      .select("id, sender, body, channel_message_ids, attachments, image_urls, delivery_status, unsent_at, created_at")
      .eq("id", actionMessageId)
      .eq("conversation_id", conversation.id)
      .maybeSingle();
    if (targetError || !target || !["seller", "ai"].includes(target.sender) || target.delivery_status !== "sent" || target.unsent_at) {
      return Response.json({ error: "Only sent seller and bot replies can be changed" }, { status: 409, headers: cors ?? {} });
    }
    if ((target.attachments?.length ?? 0) > 0 || (target.image_urls?.length ?? 0) > 0) {
      return Response.json({ error: "Edit and unsend are available for text-only replies" }, { status: 409, headers: cors ?? {} });
    }
    if (customer.channel === "messenger" || customer.channel === "instagram") {
      return Response.json({ error: "Meta does not allow this message to be edited or unsent through TindaBot" }, { status: 409, headers: cors ?? {} });
    }
    if (customer.channel === "telegram" && Date.now() - Date.parse(target.created_at) > 48 * 60 * 60 * 1000) {
      return Response.json({ error: action === "edit" ? "Telegram only allows editing messages sent within the last 48 hours" : "Telegram only allows deleting messages sent within the last 48 hours" }, { status: 409, headers: cors ?? {} });
    }
    try {
      const providerIds = Array.isArray(target.channel_message_ids) ? target.channel_message_ids as string[] : [];
      if (customer.channel === "telegram") {
        if (!providerIds.length) return Response.json({ error: "Telegram message ID is unavailable for this older reply" }, { status: 409, headers: cors ?? {} });
        if (action === "edit") await editTelegramTextMessage(customer.external_id, providerIds[0], text);
        else for (const providerId of providerIds) await deleteTelegramMessage(customer.external_id, providerId);
      }
      const { error: updateError } = await supabase.from("messages").update(
        action === "edit"
          ? { body: text, edited_at: new Date().toISOString() }
          : { body: "", unsent_at: new Date().toISOString(), channel_message_ids: [] },
      ).eq("id", target.id);
      if (updateError) throw updateError;
      return Response.json({ ok: true }, { headers: cors ?? {} });
    } catch {
      return Response.json({ error: action === "edit" ? "Message could not be edited in its channel" : "Message could not be unsent in its channel" }, { status: 502, headers: cors ?? {} });
    }
  }
  if (retryMessageId) {
    if (customer.channel === "web")
      return Response.json({ error: "Web chat replies do not need channel retry" }, { status: 409, headers: cors ?? {} });
    const { data: failedMessage, error: failedMessageError } = await supabase.from("messages")
      .select("id, body, image_urls, attachments, sender, delivery_status")
      .eq("id", retryMessageId)
      .eq("conversation_id", conversation.id)
      .maybeSingle();
    if (failedMessageError || !failedMessage || failedMessage.delivery_status !== "failed" || !["seller", "ai"].includes(failedMessage.sender))
      return Response.json({ error: "This failed message cannot be retried" }, { status: 409, headers: cors ?? {} });
    const { data: activity, error: activityError } = await supabase.from("conversations")
      .select("last_customer_message_at").eq("id", conversation.id).single();
    if (activityError) return Response.json({ error: "Could not check the reply window" }, { status: 500, headers: cors ?? {} });
    if (!isWithinCustomerWindow(activity.last_customer_message_at, customer.channel)) {
      await supabase.from("messages").update({ failure_reason: "outside_window" }).eq("id", failedMessage.id);
      return Response.json({ error: "The 24-hour reply window has closed. Ask the customer to message again." }, { status: 409, headers: cors ?? {} });
    }
    try {
      const channelMessageIds = await sendToChannel(customer.channel as MessageChannel, customer.external_id, failedMessage.body, {
        imageUrls: Array.isArray(failedMessage.image_urls) ? failedMessage.image_urls : [],
        attachments: await createChannelAttachments(supabase, Array.isArray(failedMessage.attachments) ? failedMessage.attachments as MessageAttachment[] : []),
      });
      const { error: deliveredError } = await supabase.from("messages")
        .update({ delivery_status: "sent", failure_reason: null, channel_message_ids: channelMessageIds }).eq("id", failedMessage.id);
      if (deliveredError) throw deliveredError;
      return Response.json({ ok: true }, { headers: cors ?? {} });
    } catch (error) {
      const failureReason = error instanceof Error && error.message === "token_rejected" ? "token_rejected" : "delivery_failed";
      await supabase.from("messages").update({ delivery_status: "failed", failure_reason: failureReason }).eq("id", failedMessage.id);
      void notifySeller({ type: "delivery_failed", conversationId: conversation.id, customerName: customer.name, channel: customer.channel, reason: failureReason, dedupeKey: `delivery_failed:${conversation.id}` });
      return Response.json({ error: failureReason }, { status: 502, headers: cors ?? {} });
    }
  }
  let replyToText: string | null = null;
  let replyToProviderId: string | null = null;
  if (replyToMessageId) {
    const { data: target, error: targetError } = await supabase.from("messages")
      .select("id, body, sender, channel_message_ids, external_message_id, unsent_at")
      .eq("id", replyToMessageId)
      .eq("conversation_id", conversation.id)
      .maybeSingle();
    if (targetError || !target) return Response.json({ error: "Reply target not found" }, { status: 404, headers: cors ?? {} });
    replyToText = target.unsent_at ? "Message was unsent" : target.body.slice(0, 180);
    const ids = Array.isArray(target.channel_message_ids) ? target.channel_message_ids as string[] : [];
    replyToProviderId = ids[0] ?? target.external_message_id ?? null;
  }
  const customerText = customer.channel === "messenger" || customer.channel === "instagram" || (customer.channel === "telegram" && replyToText && !replyToProviderId)
    ? replyToText ? `↪ ${replyToText}\n\n${text}` : text
    : text;
  const { data: savedMessage, error: messageError } = await supabase.from("messages").insert({
    conversation_id: conversation.id,
    sender: sendDraft ? "ai" : "seller",
    body: text,
    attachments,
    reply_to_message_id: replyToMessageId,
    reply_to_text: replyToText,
    delivery_status: customer.channel === "web" ? "sent" : "pending",
  }).select("id").single();
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

  if (customer.channel === "web")
    return Response.json({ ok: true }, { headers: cors ?? {} });

  try {
    const channel = customer.channel as MessageChannel;
    const { data: activity, error: activityError } = await supabase.from("conversations")
      .select("last_customer_message_at").eq("id", conversation.id).single();
    if (activityError) throw activityError;
    if (!isWithinCustomerWindow(activity.last_customer_message_at, channel)) {
      await supabase.from("messages").update({ delivery_status: "failed", failure_reason: "outside_window" }).eq("id", savedMessage.id);
      return Response.json(
        { error: "Reply saved, but the 24-hour reply window has closed" },
        { status: 409, headers: cors ?? {} },
      );
    }
    const channelAttachments = await createChannelAttachments(supabase, attachments);
    const channelMessageIds = await sendToChannel(channel, customer.external_id, customerText, {
      attachments: channelAttachments,
      replyToMessageId: channel === "telegram" ? replyToProviderId : null,
    });
    const { error: deliveredError } = await supabase.from("messages")
      .update({ delivery_status: "sent", failure_reason: null, channel_message_ids: channelMessageIds }).eq("id", savedMessage.id);
    if (deliveredError) throw deliveredError;
  } catch (error) {
    const failureReason = error instanceof Error && error.message === "token_rejected" ? "token_rejected" : "delivery_failed";
    await supabase.from("messages").update({ delivery_status: "failed", failure_reason: failureReason }).eq("id", savedMessage.id);
    void notifySeller({ type: "delivery_failed", conversationId: conversation.id, customerName: customer.name, channel: customer.channel, reason: failureReason, dedupeKey: `delivery_failed:${conversation.id}` });
    return Response.json(
      { error: "Reply saved, but the channel could not deliver it" },
      { status: 502, headers: cors ?? {} },
    );
  }

  return Response.json({ ok: true }, { headers: cors ?? {} });
});
