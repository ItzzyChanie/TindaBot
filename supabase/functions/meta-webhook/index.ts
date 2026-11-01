import { createClient } from "@supabase/supabase-js";
import { handleIncoming, saveAssistantReply } from "../_shared/handleIncoming.ts";
import { isWithinCustomerWindow, sendToChannel } from "../_shared/channel-messaging.ts";
import {
  extractMetaInboundMessages,
  metaCustomerDisplayName,
  metaSignatureSecretForObject,
  verifyMetaSignature,
  type MetaInboundMessage,
} from "../_shared/meta-webhook-security.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function logMetaEvent(
  event: MetaInboundMessage,
  signaturePassed: boolean,
  ignoredReason: string | null,
  processingFailure: string | null = null,
) {
  console.info("Meta webhook event", {
    objectType: event.objectType,
    eventType: event.eventType,
    fieldType: event.fieldType,
    signaturePassed,
    senderIdPresent: Boolean(event.senderId),
    recipientIdPresent: Boolean(event.recipientId),
    recipientMatchesInstagramAccount: event.channel === "instagram"
      ? event.recipientId === (Deno.env.get("INSTAGRAM_ACCOUNT_ID") ?? "")
      : null,
    eventIgnored: Boolean(ignoredReason),
    ignoredReason,
    processingFailure,
  });
}

async function getCustomerName(channel: "messenger" | "instagram", senderId: string): Promise<string | undefined> {
  const { data: customer, error } = await supabase.from("customers")
    .select("name").eq("channel", channel).eq("external_id", senderId).maybeSingle();
  if (!error && typeof customer?.name === "string" && customer.name.trim()) return customer.name;

  const token = channel === "messenger"
    ? Deno.env.get("MESSENGER_PAGE_TOKEN")
    : Deno.env.get("INSTAGRAM_ACCESS_TOKEN");
  if (!token) return undefined;
  const graphHost = channel === "messenger" ? "graph.facebook.com" : "graph.instagram.com";
  const fields = channel === "messenger" ? "first_name,last_name" : "name,username";
  try {
    const response = await fetch(`https://${graphHost}/v26.0/${encodeURIComponent(senderId)}?fields=${fields}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) return undefined;
    const profile = await response.json() as Record<string, unknown>;
    return metaCustomerDisplayName(channel, profile);
  } catch {
    return undefined;
  }
}

async function processEvents(events: MetaInboundMessage[]): Promise<void> {
  for (const event of events) {
    let ignoredReason = event.ignoredReason;
    let processingFailure: string | null = null;
    let replyId: string | null = null;
    try {
      if (ignoredReason) {
        logMetaEvent(event, true, ignoredReason);
        continue;
      }

      const senderId = event.senderId!;
      const messageId = event.messageId!;
      const { data: claimed, error: claimError } = await supabase.rpc("claim_meta_webhook_message", {
        p_external_message_id: messageId,
      });
      if (claimError) throw claimError;
      if (!claimed) {
        ignoredReason = "duplicate_message_id";
        logMetaEvent(event, true, ignoredReason);
        continue;
      }

      const text = event.text?.trim()
        ? event.text.trim()
        : event.hasAttachments
          ? "Pasensya na po, text messages lang muna ang naiintindihan ko. Puwede rin pong magtanong sa seller."
          : "";
      if (!text) {
        ignoredReason = "empty_message_without_attachment";
        logMetaEvent(event, true, ignoredReason);
        continue;
      }

      const name = await getCustomerName(event.channel, senderId);
      const incoming = await handleIncoming(event.channel, senderId, text, { externalMessageId: messageId, name });
      if (incoming.duplicate) {
        ignoredReason = "duplicate_message_id";
        logMetaEvent(event, true, ignoredReason);
        continue;
      }
      if (!incoming.reply) {
        ignoredReason = "no_automatic_reply";
        logMetaEvent(event, true, ignoredReason);
        continue;
      }

      const imageUrls = incoming.imageUrls?.length
        ? incoming.imageUrls.slice(0, 5)
        : incoming.imageUrl ? [incoming.imageUrl] : [];
      replyId = await saveAssistantReply(incoming.conversationId, incoming.reply, imageUrls);
      const { data: activity, error: activityError } = await supabase.from("conversations")
        .select("last_customer_message_at").eq("id", incoming.conversationId).single();
      if (activityError) throw activityError;
      if (!isWithinCustomerWindow(activity.last_customer_message_at, event.channel)) {
        await supabase.from("messages").update({ delivery_status: "failed", failure_reason: "outside_window" })
          .eq("id", replyId);
        ignoredReason = "outside_24_hour_window";
        logMetaEvent(event, true, ignoredReason);
        continue;
      }

      await sendToChannel(event.channel, senderId, incoming.reply, { imageUrls });
      logMetaEvent(event, true, null);
    } catch (error) {
      if (replyId) {
        await supabase.from("messages").update({ delivery_status: "failed", failure_reason: "delivery_failed" })
          .eq("id", replyId);
      }
      processingFailure = error instanceof Error ? error.name : "unknown_error";
      console.error("Meta webhook event processing failed", {
        channel: event.channel,
        processingFailure,
      });
      logMetaEvent(event, true, ignoredReason, processingFailure);
    }
  }
}

function safeObjectType(value: unknown): "page" | "instagram" | "unknown" {
  return value === "page" || value === "instagram" ? value : "unknown";
}

Deno.serve(async (request: Request) => {
  const verifyToken = Deno.env.get("META_VERIFY_TOKEN") ?? "";
  if (request.method === "GET") {
    const url = new URL(request.url);
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === verifyToken && verifyToken) {
      console.info("Meta webhook request", {
        objectType: "unknown", eventType: "verification", fieldType: "hub_verification", signaturePassed: null,
        senderIdPresent: false, recipientIdPresent: false, recipientMatchesInstagramAccount: null,
        eventIgnored: false, ignoredReason: null,
      });
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
    }
    console.info("Meta webhook request", {
      objectType: "unknown", eventType: "verification", fieldType: "hub_verification", signaturePassed: null,
      senderIdPresent: false, recipientIdPresent: false, recipientMatchesInstagramAccount: null,
      eventIgnored: true, ignoredReason: "verification_failed",
    });
    return new Response("Forbidden", { status: 403 });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await request.text();
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    console.info("Meta webhook request", {
      objectType: "unknown",
      eventType: "unknown",
      fieldType: "unknown",
      signaturePassed: false,
      senderIdPresent: false,
      recipientIdPresent: false,
      recipientMatchesInstagramAccount: null,
      eventIgnored: true,
      ignoredReason: "invalid_json",
    });
    return new Response("Invalid JSON", { status: 400 });
  }

  const objectType = safeObjectType(payload.object);
  const events = extractMetaInboundMessages(payload, Deno.env.get("INSTAGRAM_ACCOUNT_ID") ?? "");
  const secret = metaSignatureSecretForObject(
    objectType,
    Deno.env.get("META_APP_SECRET") ?? "",
    Deno.env.get("INSTAGRAM_APP_SECRET") ?? "",
  );
  const signaturePassed = await verifyMetaSignature(rawBody, request.headers.get("X-Hub-Signature-256"), secret);
  const fieldTypes = [...new Set(events.map((event) => event.fieldType))];
  console.info("Meta webhook request", {
    objectType,
    eventType: events.length ? events.map((event) => event.eventType) : ["unknown"],
    fieldType: fieldTypes.length ? fieldTypes : ["unknown"],
    signaturePassed,
  });

  if (!signaturePassed) {
    if (events.length) {
      const signatureFailure = secret ? "invalid_signature" : "signing_secret_not_configured";
      for (const event of events) logMetaEvent(event, false, signatureFailure);
    } else {
      console.info("Meta webhook event", {
        objectType,
        eventType: "unknown",
        fieldType: "unknown",
        signaturePassed: false,
        senderIdPresent: false,
        recipientIdPresent: false,
        recipientMatchesInstagramAccount: objectType === "instagram" ? false : null,
        eventIgnored: true,
        ignoredReason: secret ? "invalid_signature" : "signing_secret_not_configured",
      });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  if (objectType === "unknown") return Response.json({ ok: true });
  if (!events.length) {
    console.info("Meta webhook event", {
      objectType,
      eventType: "unknown",
      fieldType: "unknown",
      signaturePassed: true,
      senderIdPresent: false,
      recipientIdPresent: false,
      recipientMatchesInstagramAccount: objectType === "instagram" ? false : null,
      eventIgnored: true,
      ignoredReason: "no_supported_events",
    });
  }
  const task = processEvents(events).catch((error) => {
    console.error("Meta webhook processing failed", { errorType: error instanceof Error ? error.name : "unknown_error" });
  });
  const edgeRuntime = (globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
  else void task;
  return Response.json({ ok: true });
});
