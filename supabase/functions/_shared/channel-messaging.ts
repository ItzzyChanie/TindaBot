export type MessageChannel = "telegram" | "messenger" | "instagram";
export type ChannelSendOptions = {
  replyMarkup?: Record<string, unknown>;
  imageUrls?: string[];
  attachments?: { url: string; name: string; mimeType: string; size: number }[];
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
  const send = async (sendUrl: string, messageBody: Record<string, unknown>, requestKind: "text" | "image" | "file") => {
    let response: Response;
    try {
      response = await fetch(sendUrl, { method: "POST", headers, body: JSON.stringify(messageBody) });
    } catch {
      console.info("Channel send result", { channel, requestKind, httpStatus: null, transportError: true });
      throw new Error(`${channel} message delivery failed`);
    }
    let responseData: Record<string, unknown> = {};
    try {
      const parsed = await response.clone().json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) responseData = parsed as Record<string, unknown>;
    } catch {
      // Some successful send responses have no JSON body.
    }
    const apiError = responseData.error && typeof responseData.error === "object"
      ? responseData.error as Record<string, unknown>
      : {};
    console.info("Channel send result", {
      channel,
      requestKind,
      httpStatus: response.status,
      success: response.ok,
      ...(channel !== "telegram" && !response.ok ? {
        metaErrorCode: typeof apiError.code === "number" ? apiError.code : null,
        metaErrorSubcode: typeof apiError.error_subcode === "number" ? apiError.error_subcode : null,
        metaErrorType: typeof apiError.type === "string" ? apiError.type : null,
      } : {}),
    });
    if (!response.ok || responseData.ok === false) {
      if (response.status === 401 || response.status === 403) throw new Error("token_rejected");
      throw new Error(`${channel} message delivery failed`);
    }
  };
  if (text.trim()) await send(url, body, "text");

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

  for (const attachment of (options.attachments ?? []).slice(0, 1)) {
    if (!/^https:\/\//i.test(attachment.url)) throw new Error("invalid attachment URL");
    if (channel === "telegram") {
      let response: Response;
      try {
        const download = await fetch(attachment.url);
        if (!download.ok) throw new Error("attachment download failed");
        const bytes = await download.arrayBuffer();
        if (bytes.byteLength !== attachment.size) throw new Error("attachment size changed");
        const form = new FormData();
        form.set("chat_id", recipientId);
        const photo = attachment.mimeType === "image/jpeg" || attachment.mimeType === "image/png";
        const usePhoto = photo && attachment.size <= 10 * 1024 * 1024;
        form.set(usePhoto ? "photo" : "document", new File([bytes], attachment.name, { type: attachment.mimeType }));
        response = await fetch(`https://api.telegram.org/bot${token}/${usePhoto ? "sendPhoto" : "sendDocument"}`, {
          method: "POST",
          body: form,
        });
      } catch {
        throw new Error("telegram attachment delivery failed");
      }
      let telegramResult: { ok?: boolean } = {};
      try {
        telegramResult = await response.clone().json();
      } catch {
        // Telegram normally returns JSON, but keep the HTTP status authoritative.
      }
      if (!response.ok || telegramResult.ok === false) {
        if (response.status === 401 || response.status === 403) throw new Error("token_rejected");
        throw new Error("telegram attachment delivery failed");
      }
      console.info("Channel send result", {
        channel,
        requestKind: attachment.mimeType.startsWith("image/") ? "image" : "file",
        httpStatus: response.status,
        success: true,
      });
      continue;
    }

    const isImage = attachment.mimeType.startsWith("image/");
    const isInstagramPdf = channel === "instagram" && attachment.mimeType === "application/pdf";
    if (channel === "instagram" && !isImage && !isInstagramPdf) {
      await send(url, {
        recipient: { id: recipientId },
        message: { text: `${attachment.name}: ${attachment.url}` },
      }, "file");
      continue;
    }
    await send(url, {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: isImage ? "image" : "file",
          payload: { url: attachment.url, is_reusable: false },
        },
      },
    }, isImage ? "image" : "file");
  }
}

export function isWithinCustomerWindow(lastCustomerMessageAt: string | null, channel: string): boolean {
  if (channel === "telegram") return true;
  const lastMessage = lastCustomerMessageAt ? Date.parse(lastCustomerMessageAt) : 0;
  return lastMessage > 0 && Date.now() - lastMessage <= 24 * 60 * 60 * 1000;
}

