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

export type MetaInboundMessage = {
  channel: "messenger" | "instagram";
  accountId: string;
  senderId: string;
  messageId: string;
  text?: string;
  hasAttachments: boolean;
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

export function extractMetaInboundMessages(payload: unknown): MetaInboundMessage[] {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const channel = root.object === "page" ? "messenger" : root.object === "instagram" ? "instagram" : null;
  if (!channel) return [];
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const result: MetaInboundMessage[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const changes = entry as Record<string, unknown>;
    const events = Array.isArray(changes.messaging) ? changes.messaging : [];
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const item = event as Record<string, unknown>;
      const message = item.message;
      if (!message || typeof message !== "object") continue;
      const msg = message as Record<string, unknown>;
      const sender = item.sender && typeof item.sender === "object" ? (item.sender as Record<string, unknown>).id : null;
      const messageId = msg.mid;
      const accountId = changes.id;
      if (msg.is_echo || typeof messageId !== "string" || !messageId || seen.has(messageId) || typeof sender !== "string" || typeof accountId !== "string" || sender === accountId) continue;
      seen.add(messageId);
      result.push({ channel, accountId, senderId: sender, messageId, text: typeof msg.text === "string" ? msg.text : undefined, hasAttachments: Array.isArray(msg.attachments) && msg.attachments.length > 0 });
    }
  }
  return result;
}
