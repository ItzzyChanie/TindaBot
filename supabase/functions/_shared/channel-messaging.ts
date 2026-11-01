export type MessageChannel = "telegram" | "messenger" | "instagram";
export type ChannelSendOptions = {
  replyMarkup?: Record<string, unknown>;
  imageUrls?: string[];
};

function envValue(name: string): string {
  const runtime = globalThis as typeof globalThis & { Deno?: { env: { get(key: string): string | undefined } } };
  return runtime.Deno?.env.get(name) ?? "";
}

export async function sendToChannel(
  channel: MessageChannel,
  recipientId: string,
  text: string,
  options: ChannelSendOptions = {},
): Promise<void> {
  let url: string;
  let body: Record<string, unknown>;
  let token: string;

  if (channel === "telegram") {
    token = envValue("TELEGRAM_BOT_TOKEN");
    url = `https://api.telegram.org/bot${token}/sendMessage`;
    body = { chat_id: recipientId, text, ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}) };
  } else if (channel === "messenger") {
    token = envValue("MESSENGER_PAGE_TOKEN");
    url = "https://graph.facebook.com/v26.0/me/messages";
    body = { recipient: { id: recipientId }, message: { text } };
  } else {
    token = envValue("INSTAGRAM_ACCESS_TOKEN");
    const accountId = envValue("INSTAGRAM_ACCOUNT_ID");
    if (!accountId) {
      console.info("Channel send result", { channel, requestKind: "text", httpStatus: null, failure: "missing_account_configuration" });
      throw new Error("Instagram messaging is not configured");
    }
    url = `https://graph.instagram.com/v26.0/${encodeURIComponent(accountId)}/messages`;
    body = { recipient: { id: recipientId }, message: { text } };
  }

  if (!token) {
    console.info("Channel send result", { channel, requestKind: "text", httpStatus: null, failure: "missing_token_configuration" });
    throw new Error(`${channel} messaging is not configured`);
  }
  const headers = {
    "content-type": "application/json",
    ...(channel === "telegram" ? {} : { authorization: `Bearer ${token}` }),
  };
  const send = async (sendUrl: string, messageBody: Record<string, unknown>, requestKind: "text" | "image") => {
    let response: Response;
    try {
      response = await fetch(sendUrl, { method: "POST", headers, body: JSON.stringify(messageBody) });
    } catch {
      console.info("Channel send result", { channel, requestKind, httpStatus: null, transportError: true });
      throw new Error(`${channel} message delivery failed`);
    }
    console.info("Channel send result", { channel, requestKind, httpStatus: response.status, success: response.ok });
    if (!response.ok) throw new Error(`${channel} message delivery failed`);
  };
  await send(url, body, "text");

  const imageUrls = (options.imageUrls ?? []).filter((imageUrl) => /^https:\/\//i.test(imageUrl)).slice(0, 5);
  for (const imageUrl of imageUrls) {
    if (channel === "telegram") {
      const photoUrl = `https://api.telegram.org/bot${token}/sendPhoto`;
      await send(photoUrl, { chat_id: recipientId, photo: imageUrl }, "image");
    } else {
      await send(url, {
        recipient: { id: recipientId },
        message: { attachment: { type: "image", payload: { url: imageUrl } } },
      }, "image");
    }
  }
}

export function isWithinCustomerWindow(lastCustomerMessageAt: string | null, channel: string): boolean {
  if (channel === "telegram") return true;
  const lastMessage = lastCustomerMessageAt ? Date.parse(lastCustomerMessageAt) : 0;
  return lastMessage > 0 && Date.now() - lastMessage <= 24 * 60 * 60 * 1000;
}

