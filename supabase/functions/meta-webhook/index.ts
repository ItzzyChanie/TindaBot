import { createClient } from "@supabase/supabase-js";
import { handleIncoming, saveAssistantReply } from "../_shared/handleIncoming.ts";
import { isWithinCustomerWindow, sendToChannel } from "../_shared/channel-messaging.ts";
import { extractMetaInboundMessages, verifyMetaSignature } from "../_shared/meta-webhook-security.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function processPayload(payload: Record<string, unknown>): Promise<void> {
  for (const event of extractMetaInboundMessages(payload)) {
    const { channel, senderId, messageId } = event;
    const { data: claimed, error: claimError } = await supabase.rpc("claim_meta_webhook_message", {
      p_external_message_id: messageId,
    });
    if (claimError) throw claimError;
    if (!claimed) continue;

    const text = event.text?.trim()
      ? event.text.trim()
      : event.hasAttachments
        ? "Pasensya na po, text messages lang muna ang naiintindihan ko. Puwede rin pong magtanong sa seller."
        : "";
    if (!text) continue;
    const incoming = await handleIncoming(channel, senderId, text, { externalMessageId: messageId });
    if (!incoming.reply || incoming.duplicate) continue;
    const replyId = await saveAssistantReply(incoming.conversationId, incoming.reply);
    try {
      const { data: activity, error: activityError } = await supabase.from("conversations")
        .select("last_customer_message_at").eq("id", incoming.conversationId).single();
      if (activityError) throw activityError;
      if (!isWithinCustomerWindow(activity.last_customer_message_at, channel)) {
        await supabase.from("messages").update({ delivery_status: "failed", failure_reason: "outside_window" })
          .eq("id", replyId);
        continue;
      }
      await sendToChannel(channel, senderId, incoming.reply);
    } catch (error) {
      await supabase.from("messages").update({ delivery_status: "failed", failure_reason: "delivery_failed" }).eq("id", replyId);
      console.error("Meta reply delivery failed", { channel, error: error instanceof Error ? error.message : "unknown" });
    }
  }
}

Deno.serve(async (request: Request) => {
  const verifyToken = Deno.env.get("META_VERIFY_TOKEN") ?? "";
  if (request.method === "GET") {
    const url = new URL(request.url);
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === verifyToken && verifyToken) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await request.text();
  if (!await verifyMetaSignature(rawBody, request.headers.get("X-Hub-Signature-256"), Deno.env.get("META_APP_SECRET") ?? "")) {
    return new Response("Unauthorized", { status: 401 });
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (payload.object !== "page" && payload.object !== "instagram") return Response.json({ ok: true });
  const task = processPayload(payload).catch((error) => {
    console.error("Meta webhook processing failed", { error: error instanceof Error ? error.message : "unknown" });
  });
  const edgeRuntime = (globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
  else void task;
  return Response.json({ ok: true });
});
