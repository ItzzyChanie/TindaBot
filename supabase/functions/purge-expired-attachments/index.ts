import { createClient } from "@supabase/supabase-js";
import { ATTACHMENT_BUCKET, type MessageAttachment } from "../_shared/message-attachments.ts";

const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  serviceRoleKey,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const apiKey = request.headers.get("apikey");
  if (!serviceRoleKey || (bearer !== serviceRoleKey && apiKey !== serviceRoleKey)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const conversationIds: string[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("conversations")
      .select("id")
      .lt("last_message_at", cutoff)
      .order("id")
      .range(offset, offset + 499);
    if (error) throw error;
    conversationIds.push(...(data ?? []).map((row) => row.id));
    if ((data ?? []).length < 500) break;
  }

  const expiredMessages: { id: string; attachments: MessageAttachment[] }[] = [];
  for (let offset = 0; offset < conversationIds.length; offset += 100) {
    const ids = conversationIds.slice(offset, offset + 100);
    for (let messageOffset = 0; ; messageOffset += 1000) {
      const { data, error } = await supabase.from("messages")
        .select("id, conversation_id, attachments")
        .in("conversation_id", ids)
        .order("id")
        .range(messageOffset, messageOffset + 999);
      if (error) throw error;
      for (const row of data ?? []) {
        const attachments = Array.isArray(row.attachments) ? row.attachments as MessageAttachment[] : [];
        const safeAttachments = attachments.filter((item) =>
          item && typeof item.path === "string" &&
          item.path.startsWith(`conversations/${row.conversation_id}/`)
        );
        if (safeAttachments.length) expiredMessages.push({ id: row.id, attachments: safeAttachments });
      }
      if ((data ?? []).length < 1000) break;
    }
  }

  const paths = [...new Set(expiredMessages.flatMap((message) => message.attachments.map((item) => item.path)))];
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).remove(paths.slice(offset, offset + 100));
    if (error) throw error;
  }

  for (let offset = 0; offset < expiredMessages.length; offset += 100) {
    const ids = expiredMessages.slice(offset, offset + 100).map((message) => message.id);
    const { error } = await supabase.from("messages").update({ attachments: [] }).in("id", ids);
    if (error) throw error;
  }

  const { data: purgedCount, error: purgeError } = await supabase.rpc("purge_expired_chat_data");
  if (purgeError) throw purgeError;
  return Response.json({ ok: true, deletedAttachments: paths.length, purgedRecords: purgedCount });
});
