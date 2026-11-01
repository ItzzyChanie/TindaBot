export async function verifyMetaSignature(
  rawBody: string,
  signature: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signature || !/^sha256=[0-9a-f]{64}$/i.test(signature) || !appSecret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const actual = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const expected = signature.slice(7).toLowerCase();
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1) {
    mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

export function metaSignatureSecretForObject(
  objectType: unknown,
  metaAppSecret: string,
): string {
  if (objectType === "instagram" || objectType === "page") return metaAppSecret;
  return "";
}

export type MetaInboundMessage = {
  channel: "messenger" | "instagram";
  objectType: "page" | "instagram";
  fieldType: string;
  eventType: string;
  accountId: string | null;
  senderId: string | null;
  recipientId: string | null;
  messageId: string | null;
  text?: string;
  hasAttachments: boolean;
  ignoredReason: string | null;
};

export function metaCustomerDisplayName(
  channel: "messenger" | "instagram",
  profile: Record<string, unknown>,
): string | undefined {
  const name = channel === "messenger"
    ? [profile.first_name, profile.last_name]
      .filter((part): part is string => typeof part === "string" && !!part.trim())
      .join(" ")
    : (typeof profile.name === "string" && profile.name.trim()) ||
      (typeof profile.username === "string" && profile.username.trim() ? `@${profile.username.trim()}` : "");
  return name.trim() ? name.trim().slice(0, 160) : undefined;
}

export function extractMetaInboundMessages(
  payload: unknown,
  expectedInstagramAccountId = "",
): MetaInboundMessage[] {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const channel = root.object === "page" ? "messenger" : root.object === "instagram" ? "instagram" : null;
  if (!channel) return [];
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const result: MetaInboundMessage[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const entryRecord = entry as Record<string, unknown>;
    const accountId = typeof entryRecord.id === "string" ? entryRecord.id : null;
    const events = Array.isArray(entryRecord.messaging) ? entryRecord.messaging : [];
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const item = event as Record<string, unknown>;
      const message = item.message;
      const msg = message && typeof message === "object" ? message as Record<string, unknown> : null;
      const sender = item.sender && typeof item.sender === "object" ? (item.sender as Record<string, unknown>).id : null;
      const recipient = item.recipient && typeof item.recipient === "object" ? (item.recipient as Record<string, unknown>).id : null;
      const senderId = typeof sender === "string" ? sender : null;
      const recipientId = typeof recipient === "string" ? recipient : null;
      const messageId = typeof msg?.mid === "string" && msg.mid ? msg.mid : null;
      const eventType = msg ? "message" : ["postback", "reaction", "read", "delivery", "referral", "optin", "account_linking", "handover"].find((key) => key in item) ?? "unknown";
      let ignoredReason: string | null = null;
      if (!msg) ignoredReason = "unsupported_event_type";
      else if (msg.is_echo === true) ignoredReason = "echo";
      else if (!messageId) ignoredReason = "missing_message_id";
      else if (!senderId) ignoredReason = "missing_sender_id";
      else if (!accountId) ignoredReason = "missing_account_id";
      else if (channel === "instagram" && !recipientId) ignoredReason = "missing_recipient_id";
      else if (channel === "instagram" && !expectedInstagramAccountId) ignoredReason = "instagram_account_not_configured";
      else if (channel === "instagram" && accountId !== expectedInstagramAccountId) ignoredReason = "entry_account_mismatch";
      else if (channel === "instagram" && recipientId !== expectedInstagramAccountId) ignoredReason = "recipient_account_mismatch";
      else if (senderId === accountId) ignoredReason = "account_sender";
      else if (messageId && seen.has(messageId)) ignoredReason = "duplicate_in_payload";
      if (messageId) seen.add(messageId);
      result.push({
        channel,
        objectType: root.object as "page" | "instagram",
        fieldType: "messaging",
        eventType,
        accountId,
        senderId,
        recipientId,
        messageId,
        text: typeof msg?.text === "string" ? msg.text : undefined,
        hasAttachments: Array.isArray(msg?.attachments) && msg.attachments.length > 0,
        ignoredReason,
      });
    }
    const changes = Array.isArray(entryRecord.changes) ? entryRecord.changes : [];
    for (const change of changes) {
      const field = change && typeof change === "object" ? (change as Record<string, unknown>).field : null;
      result.push({
        channel,
        objectType: root.object as "page" | "instagram",
        fieldType: typeof field === "string" ? field.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64) : "unknown",
        eventType: "change",
        accountId,
        senderId: null,
        recipientId: null,
        messageId: null,
        hasAttachments: false,
        ignoredReason: "unsupported_field_event",
      });
    }
  }
  return result;
}
