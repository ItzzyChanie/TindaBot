import { handleIncoming, saveAssistantReply } from "../_shared/handleIncoming.ts";

const telegramToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!webhookSecret) return new Response("Webhook is not configured", { status: 500 });
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== webhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!telegramToken) return new Response("Bot is not configured", { status: 500 });

  let update: { message?: { text?: unknown; chat?: { id?: number }; from?: { first_name?: string; last_name?: string; username?: string } } };
  try {
    update = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const message = update.message;
  if (typeof message?.text !== "string" || !message.chat?.id) {
    return Response.json({ ok: true });
  }
  if (message.text.length > 4000) return Response.json({ ok: true });

  try {
    const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ")
      || message.from?.username
      || null;
    const incoming = await handleIncoming("telegram", String(message.chat.id), message.text, { name });
    await saveAssistantReply(incoming.conversationId, incoming.reply);

    const telegramResponse = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: message.chat.id, text: incoming.reply }),
    });
    if (!telegramResponse.ok) throw new Error("Telegram sendMessage failed");
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Telegram update failed", error instanceof Error ? error.message : "Unknown error");
    return new Response("Unable to process update", { status: 500 });
  }
});
