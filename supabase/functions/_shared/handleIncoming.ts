import { createClient } from "npm:@supabase/supabase-js@2";

export type IncomingContext = {
  name?: string | null;
  productId?: string | null;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function handleIncoming(
  channel: string,
  externalId: string,
  text: string,
  context: IncomingContext = {},
) {
  if (text.length > 4000) throw new Error("Message is too long");

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .upsert({ channel, external_id: externalId, name: context.name ?? null }, { onConflict: "channel,external_id" })
    .select("id")
    .single();
  if (customerError) throw customerError;

  const { data: existing, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .eq("customer_id", customer.id)
    .in("status", ["open", "needs_seller"])
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (conversationError) throw conversationError;

  let conversationId = existing?.id as string | undefined;
  if (!conversationId) {
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({ customer_id: customer.id, context_product_id: context.productId ?? null })
      .select("id")
      .single();
    if (error) throw error;
    conversationId = created.id;
  }

  const { error: messageError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender: "customer",
    body: text,
  });
  if (messageError) throw messageError;

  const { error: updateError } = await supabase.from("conversations")
    .update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
  if (updateError) throw updateError;

  return { conversationId, reply: "Hello po! (test)" };
}

export async function saveAssistantReply(conversationId: string, body: string) {
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender: "ai",
    body,
  });
  if (error) throw error;

  const { error: updateError } = await supabase.from("conversations")
    .update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
  if (updateError) throw updateError;
}
