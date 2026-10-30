import {
  claimTelegramUpdate,
  finishTelegramUpdate,
  handleIncoming,
  saveAssistantReply,
} from "../_shared/handleIncoming.ts";
import faq from "../_shared/faq.json" with { type: "json" };

const telegramToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");

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
  from?: { first_name?: string; last_name?: string; username?: string };
};

type TelegramUpdate = { update_id?: number; message?: TelegramMessage };

async function sendTelegramMessage(chatId: number, text: string) {
  if (!telegramToken) throw new Error("Telegram bot is not configured");
  const response = await fetch(
    `https://api.telegram.org/bot${telegramToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: {
          keyboard: [faq.questions.slice(0, 2), faq.questions.slice(2, 4), faq.questions.slice(4)],
          resize_keyboard: true,
          is_persistent: true,
          input_field_placeholder: faq.placeholder,
        },
      }),
    },
  );
  if (!response.ok) throw new Error("Telegram sendMessage failed");
}

async function processTelegramUpdate(
  updateId: number,
  message: TelegramMessage,
): Promise<void> {
  let claimed = false;
  let succeeded = false;
  try {
    claimed = await claimTelegramUpdate(updateId);
    if (!claimed) {
      console.info("[telegram] duplicate update ignored", { updateId });
      return;
    }

    const chatId = message.chat?.id;
    if (!chatId) return;
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
      succeeded = true;
      return;
    }

    const name = [message.from?.first_name, message.from?.last_name]
      .filter(Boolean)
      .join(" ") || message.from?.username || null;
    const incoming = await handleIncoming("telegram", String(chatId), text, {
      name,
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
    if (incoming.reply) {
      await saveAssistantReply(incoming.conversationId, incoming.reply);
      await sendTelegramMessage(chatId, incoming.reply);
    }
    succeeded = true;
  } catch (error) {
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

  const message = update.message;
  if (!message?.chat?.id) return Response.json({ ok: true });
  if (!Number.isSafeInteger(update.update_id))
    return new Response("Invalid Telegram update ID", { status: 400 });

  const updateId = update.update_id as number;
  const task = processTelegramUpdate(updateId, message);
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
