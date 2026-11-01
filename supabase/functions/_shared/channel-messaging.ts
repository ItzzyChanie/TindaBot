export type MessageChannel = "telegram" | "messenger" | "instagram";

export async function sendToChannel(
  channel: MessageChannel,
  recipientId: string,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<void> {
  let url: string;
  let body: Record<string, unknown>;
  let token: string;

  if (channel === "telegram") {
    token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
    url = `https://api.telegram.org/bot${token}/sendMessage`;
    body = { chat_id: recipientId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) };
  } else if (channel === "messenger") {
    token = Deno.env.get("MESSENGER_PAGE_TOKEN") ?? "";
    url = "https://graph.facebook.com/v26.0/me/messages";
    body = { recipient: { id: recipientId }, message: { text } };
  } else {
    token = Deno.env.get("INSTAGRAM_ACCESS_TOKEN") ?? "";
    const accountId = Deno.env.get("INSTAGRAM_ACCOUNT_ID") ?? "";
    if (!accountId) throw new Error("Instagram messaging is not configured");
    url = `https://graph.instagram.com/v26.0/${encodeURIComponent(accountId)}/messages`;
    body = { recipient: { id: recipientId }, message: { text } };
  }

  if (!token) throw new Error(`${channel} messaging is not configured`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(channel === "telegram" ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${channel} message delivery failed`);
}

export function isWithinCustomerWindow(lastCustomerMessageAt: string | null, channel: string): boolean {
  if (channel === "telegram") return true;
  const lastMessage = lastCustomerMessageAt ? Date.parse(lastCustomerMessageAt) : 0;
  return lastMessage > 0 && Date.now() - lastMessage <= 24 * 60 * 60 * 1000;
}

