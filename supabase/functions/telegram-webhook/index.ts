import { createClient } from "@supabase/supabase-js";
import {
  claimTelegramUpdate,
  finishTelegramUpdate,
  handleIncoming,
  saveChannelMessageIds,
  saveAssistantReply,
} from "../_shared/handleIncoming.ts";
import faq from "../_shared/faq.json" with { type: "json" };
import { sendToChannel } from "../_shared/channel-messaging.ts";
import { notifySeller } from "../_shared/notify.ts";

const telegramToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const replyMarkup = {
  keyboard: [faq.questions.slice(0, 2), faq.questions.slice(2, 4), faq.questions.slice(4)],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: faq.placeholder,
};

type TelegramMessage = {
  text?: unknown;
  caption?: unknown;
  photo?: { file_id?: string; file_unique_id?: string }[];
  document?: {
    file_id?: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
  };
  chat?: { id?: number };
  message_id?: number;
  reply_to_message?: { message_id?: number };
  from?: { first_name?: string; last_name?: string; username?: string };
};

type TelegramCallbackQuery = {
  id?: string;
  data?: string;
  from?: { first_name?: string; last_name?: string; username?: string };
  message?: TelegramMessage;
};
type TelegramUpdate = { update_id?: number; message?: TelegramMessage; edited_message?: TelegramMessage; callback_query?: TelegramCallbackQuery };

async function sendTelegramMessage(chatId: number, text: string): Promise<string | null> {
  if (!telegramToken) throw new Error("Telegram bot is not configured");
  const response = await fetch(
    `https://api.telegram.org/bot${telegramToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: replyMarkup,
      }),
    },
  );
  if (!response.ok) throw new Error("Telegram sendMessage failed");
  const result = await response.json() as { result?: { message_id?: number } };
  return result.result?.message_id === undefined ? null : String(result.result.message_id);
}

async function sendTelegramPhoto(chatId: number, photo: string, caption = ""): Promise<string | null> {
  if (!telegramToken) throw new Error("Telegram bot is not configured");
  const response = await fetch(
    `https://api.telegram.org/bot${telegramToken}/sendPhoto`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo,
        ...(caption ? { caption } : {}),
        reply_markup: replyMarkup,
      }),
    },
  );
  if (!response.ok) throw new Error("Telegram sendPhoto failed");
  const result = await response.json() as { result?: { message_id?: number } };
  return result.result?.message_id === undefined ? null : String(result.result.message_id);
}

async function processTelegramUpdate(
  updateId: number,
  message: TelegramMessage,
  edited = false,
): Promise<void> {
  let claimed = false;
  let succeeded = false;
  let conversationId: string | null = null;
  let customerName: string | null = null;
  let replyDeliveryStarted = false;
  try {
    claimed = await claimTelegramUpdate(updateId);
    if (!claimed) {
      console.info("[telegram] duplicate update ignored", { updateId });
      return;
    }

    const chatId = message.chat?.id;
    if (!chatId) return;
    if (edited) {
      const channelMessageId = message.message_id === undefined ? null : String(message.message_id);
      const editedText = typeof message.text === "string" ? message.text : typeof message.caption === "string" ? message.caption : "";
      if (!channelMessageId || !editedText || editedText.length > 4000) {
        succeeded = true;
        return;
      }
      const { data: customer, error: customerError } = await supabase.from("customers")
        .select("id").eq("channel", "telegram").eq("external_id", String(chatId)).maybeSingle();
      if (customerError) throw customerError;
      const { data: conversations, error: conversationError } = customer
        ? await supabase.from("conversations").select("id").eq("customer_id", customer.id)
        : { data: [], error: null };
      if (conversationError) throw conversationError;
      const conversationIds = (conversations ?? []).map((conversation) => conversation.id);
      const { data: existing, error: lookupError } = conversationIds.length
        ? await supabase.from("messages").select("id").in("conversation_id", conversationIds)
          .eq("sender", "customer").contains("channel_message_ids", [channelMessageId]).maybeSingle()
        : { data: null, error: null };
      if (lookupError) throw lookupError;
      if (existing) {
        const { error } = await supabase.from("messages").update({ body: editedText, edited_at: new Date().toISOString() }).eq("id", existing.id);
        if (error) throw error;
      }
      succeeded = true;
      return;
    }
    const photo = message.photo?.at(-1);
    const document = message.document;
    const hasProof = Boolean(photo?.file_id || document?.file_id);
    const text = typeof message.text === "string"
      ? message.text
      : typeof message.caption === "string"
        ? message.caption
        : hasProof
          ? "Payment proof received (" + (photo ? "photo" : "document") + ")."
          : "";

    if (!text && !hasProof) {
      await sendTelegramMessage(
        chatId,
        "Pasensya na po, text, photo, or document lang muna ang supported.",
      );
      succeeded = true;
      return;
    }
    if (text.length > 4000) {
      await sendTelegramMessage(
        chatId,
        "Pasensya na po, hanggang 4,000 characters lang ang kaya kong basahin. Puwede po bang paikliin ang message o magtanong sa seller?",
      );
      succeeded = true;
      return;
    }

    const name = [message.from?.first_name, message.from?.last_name]
      .filter(Boolean)
      .join(" ") || message.from?.username || null;
    customerName = name;
    const startPayload = text.match(/^\/start(?:@[a-z0-9_]+)?\s+product_([0-9a-f-]{36})\s*$/i);
    const incoming = await handleIncoming("telegram", String(chatId), text, {
      name,
      channelMessageId: message.message_id === undefined ? undefined : String(message.message_id),
      replyToChannelMessageId: message.reply_to_message?.message_id === undefined ? undefined : String(message.reply_to_message.message_id),
      productId: startPayload?.[1] ?? null,
      paymentProof: hasProof
        ? {
          kind: photo ? "photo" : "document",
          file_id: (photo?.file_id ?? document?.file_id)!,
          file_unique_id: photo?.file_unique_id ?? document?.file_unique_id ?? null,
          file_name: document?.file_name ?? null,
          mime_type: document?.mime_type ?? null,
          caption: typeof message.caption === "string" ? message.caption : null,
        }
        : undefined,
    });
    conversationId = incoming.conversationId;
    if (incoming.reply) {
      const images = incoming.imageUrls?.length
        ? incoming.imageUrls.slice(0, 5)
        : incoming.imageUrl ? [incoming.imageUrl] : [];
      const savedReplyId = await saveAssistantReply(incoming.conversationId, incoming.reply, images);
      const channelMessageIds: string[] = [];
      if (images.length) {
        replyDeliveryStarted = true;
        const caption = incoming.reply.replace(/https:\/\/\S+/g, "").trim();
        for (let index = 0; index < images.length; index += 1) {
          try {
            const sentId = await sendTelegramPhoto(chatId, images[index], index === 0 ? caption : "");
            if (sentId) channelMessageIds.push(sentId);
          } catch {
            const sentId = await sendTelegramMessage(chatId, index === 0 ? incoming.reply : images[index]);
            if (sentId) channelMessageIds.push(sentId);
          }
        }
      } else {
        replyDeliveryStarted = true;
        channelMessageIds.push(...await sendToChannel("telegram", String(chatId), incoming.reply, {
          replyMarkup: incoming.replyMarkup as Record<string, unknown> | undefined ?? replyMarkup,
        }));
      }
      await saveChannelMessageIds(savedReplyId, channelMessageIds);
    }
    succeeded = true;
  } catch (error) {
    if (replyDeliveryStarted && conversationId) {
      void notifySeller({
        type: "delivery_failed", conversationId, customerName, channel: "telegram",
        reason: "Telegram message delivery failed", dedupeKey: `delivery_failed:${conversationId}`,
      });
    }
    console.error("Telegram update processing failed", {
      updateId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    if (claimed) {
      try {
        await finishTelegramUpdate(updateId, succeeded);
      } catch (error) {
        console.error("Could not record Telegram update status", {
          updateId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }
}

async function answerTelegramCallback(callbackQueryId: string): Promise<void> {
  if (!telegramToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${telegramToken}/answerCallbackQuery`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  } catch {
    // Callback acknowledgement is best-effort; the selected message is still processed.
  }
}

async function processTelegramCallback(updateId: number, callback: TelegramCallbackQuery): Promise<void> {
  let claimed = false;
  let succeeded = false;
  try {
    claimed = await claimTelegramUpdate(updateId);
    if (!claimed) return;
    const chatId = callback.message?.chat?.id;
    const callbackId = callback.id;
    const match = typeof callback.data === "string" ? callback.data.match(/^recent_product:([1-3])$/) : null;
    if (!chatId || !callbackId || !match) {
      succeeded = true;
      return;
    }
    const name = [callback.from?.first_name, callback.from?.last_name].filter(Boolean).join(" ") || callback.from?.username || null;
    const incoming = await handleIncoming("telegram", String(chatId), match[1], {
      externalMessageId: `callback:${callbackId}`,
      name,
    });
    if (incoming.reply) {
      const savedReplyId = await saveAssistantReply(incoming.conversationId, incoming.reply, incoming.imageUrls ?? []);
      const channelMessageIds = await sendToChannel("telegram", String(chatId), incoming.reply, {
        replyMarkup: incoming.replyMarkup as Record<string, unknown> | undefined ?? replyMarkup,
        imageUrls: incoming.imageUrls ?? (incoming.imageUrl ? [incoming.imageUrl] : []),
      });
      await saveChannelMessageIds(savedReplyId, channelMessageIds);
    }
    succeeded = true;
  } catch (error) {
    console.error("Telegram callback processing failed", {
      updateId,
      errorType: error instanceof Error ? error.name : "unknown_error",
    });
  } finally {
    if (callback.id) await answerTelegramCallback(callback.id);
    if (claimed) {
      try {
        await finishTelegramUpdate(updateId, succeeded);
      } catch (error) {
        console.error("Could not record Telegram callback status", {
          updateId,
          errorType: error instanceof Error ? error.name : "unknown_error",
        });
      }
    }
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  if (!webhookSecret)
    return new Response("Webhook is not configured", { status: 500 });
  if (
    request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== webhookSecret
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!telegramToken)
    return new Response("Bot is not configured", { status: 500 });

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const edited = Boolean(update.edited_message);
  if (update.callback_query) {
    if (!Number.isSafeInteger(update.update_id)) return new Response("Invalid Telegram update ID", { status: 400 });
    const task = processTelegramCallback(update.update_id as number, update.callback_query);
    const edgeRuntime = (globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(task);
      return Response.json({ ok: true });
    }
    await task;
    return Response.json({ ok: true });
  }
  const message = update.edited_message ?? update.message;
  if (!message?.chat?.id) return Response.json({ ok: true });
  if (!Number.isSafeInteger(update.update_id))
    return new Response("Invalid Telegram update ID", { status: 400 });

  const updateId = update.update_id as number;
  const task = processTelegramUpdate(updateId, message, edited);
  const edgeRuntime = (
    globalThis as typeof globalThis & {
      EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
    }
  ).EdgeRuntime;

  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(task);
    return Response.json({ ok: true });
  }

  await task;
  return Response.json({ ok: true });
});
