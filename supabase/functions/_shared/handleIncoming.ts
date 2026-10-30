import { createClient } from "@supabase/supabase-js";
import { labelAutoReply, runIncomingBrain, type BrainPending, type BrainProduct } from "./brain.ts";
import { quote, type QuotePromo } from "./quote.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type ProductRow = Omit<BrainProduct, "price" | "discount_value" | "variants" | "promos"> & {
  price: number | string;
  discount_value: number | string | null;
  variants: Array<BrainProduct["variants"][number] & { stock: number | string }>;
  promos: Array<QuotePromo & { value: number | string }>;
};

export type IncomingContext = {
  name?: string | null;
  productId?: string | null;
  paymentProof?: {
    kind: "photo" | "document";
    file_id: string;
    file_unique_id?: string | null;
    file_name?: string | null;
    mime_type?: string | null;
    caption?: string | null;
  };
};

export async function claimTelegramUpdate(updateId: number): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_telegram_update", {
    p_update_id: updateId,
  });
  if (error) throw error;
  return data === true;
}

export async function finishTelegramUpdate(
  updateId: number,
  succeeded: boolean,
): Promise<void> {
  const functionName = succeeded
    ? "complete_telegram_update"
    : "fail_telegram_update";
  const { error } = await supabase.rpc(functionName, {
    p_update_id: updateId,
  });
  if (error) throw error;
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function formatPeso(value: number): string {
  return "₱" + value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function savePaymentProof(conversationId: string, customerId: string, proof: NonNullable<IncomingContext["paymentProof"]>, text: string) {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, payment_proof")
    .eq("customer_id", customerId)
    .eq("status", "awaiting_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) throw orderError;

  let reply = "Natanggap po ang payment proof. Iko-confirm ito ng seller.";
  let systemBody = "Payment proof received.";
  if (order) {
    const previous = Array.isArray(order.payment_proof) ? order.payment_proof : [];
    const { error } = await supabase.from("orders").update({
      payment_proof: [...previous, {
        kind: proof.kind,
        file_id: proof.file_id,
        file_unique_id: proof.file_unique_id ?? null,
        file_name: proof.file_name ?? null,
        mime_type: proof.mime_type ?? null,
        caption: proof.caption ?? null,
        received_at: new Date().toISOString(),
      }],
    }).eq("id", order.id);
    if (error) throw error;
    systemBody = "Payment proof received for order #" + order.id + ".";
  } else {
    const { error } = await supabase.from("missed_requests").insert({
      conversation_id: conversationId,
      request_text: text,
    });
    if (error) throw error;
    reply = "Natanggap po ang file. Ipa-check ko muna sa seller dahil wala akong pending payment na maikabit dito.";
    systemBody = "Payment proof received, but no awaiting-payment order was found.";
  }

  const { error: statusError } = await supabase.from("conversations")
    .update({ status: "needs_seller" }).eq("id", conversationId);
  if (statusError) throw statusError;
  const { error: systemError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender: "system",
    body: systemBody,
  });
  if (systemError) throw systemError;
  return reply;
}

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
    .select("id, status, ai_mode, pending")
    .eq("customer_id", customer.id)
    .in("status", ["open", "needs_seller"])
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (conversationError) throw conversationError;

  let conversationId = existing?.id as string | undefined;
  const firstContact = !existing;
  if (!conversationId) {
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({ customer_id: customer.id, context_product_id: context.productId ?? null })
      .select("id, status, ai_mode, pending")
      .single();
    if (error) throw error;
    conversationId = created.id;
  }
  if (!conversationId) throw new Error("Could not create a conversation");

  const { error: messageError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender: "customer",
    body: text,
  });
  if (messageError) throw messageError;

  const { error: updateError } = await supabase.from("conversations")
    .update({ last_message_at: new Date().toISOString(), seller_read_at: null, is_hidden: false }).eq("id", conversationId);
  if (updateError) throw updateError;

  const conversation = existing ?? { status: "open", ai_mode: "auto", pending: {} };
  const aiMode = conversation.ai_mode as "auto" | "suggest" | "human";
  if (context.paymentProof) {
    const reply = await savePaymentProof(conversationId, customer.id, context.paymentProof, text);
    return {
      conversationId,
      reply: aiMode === "human" ? null : labelAutoReply(reply, aiMode),
      draft: null,
    };
  }

  if (aiMode === "human") {
    if (/^\s*(seller|\/seller)\s*$/i.test(text)) {
      const { error } = await supabase.from("conversations").update({ status: "needs_seller" }).eq("id", conversationId);
      if (error) throw error;
      const { error: missedError } = await supabase.from("missed_requests").insert({
        conversation_id: conversationId,
        request_text: text,
      });
      if (missedError) throw missedError;
    }
    return { conversationId, reply: null, draft: null };
  }

  const { data: productRows, error: productsError } = await supabase
    .from("products")
    .select("id, name, aliases, description, price, active, discount_type, discount_value, discount_starts, discount_ends, variants(id, size, stock), promos(label, kind, min_qty, value, starts_at, ends_at, active)")
    .eq("active", true);
  if (productsError) throw productsError;
  const products = ((productRows ?? []) as unknown as ProductRow[]).map((row) => ({
    ...row,
    price: Number(row.price),
    discount_value: row.discount_value === null ? null : Number(row.discount_value),
    variants: (row.variants ?? []).map((variant) => ({ ...variant, stock: Number(variant.stock) })),
    promos: (row.promos ?? []).map((promo) => ({ ...promo, value: Number(promo.value) })),
  })) as BrainProduct[];

  const { data: settingsRow, error: settingsError } = await supabase
    .from("shop_settings")
    .select("shipping_rates, payment_instructions, policies")
    .eq("shop_id", "00000000-0000-4000-8000-000000000001")
    .maybeSingle();
  if (settingsError) throw settingsError;
  const settings = settingsRow ?? { shipping_rates: {}, payment_instructions: "", policies: "" };
  const { data: latestOrderRow, error: orderError } = await supabase
    .from("orders")
    .select("id, total, shipping, status, created_at")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) throw orderError;

  const brain = await runIncomingBrain({
    message: text,
    aiMode,
    status: conversation.status as "open" | "needs_seller" | "resolved",
    firstContact,
    pending: object(conversation.pending) as BrainPending,
    products,
    settings: {
      shipping_rates: object(settings.shipping_rates) as Record<string, number>,
      payment_instructions: settings.payment_instructions ?? "",
      policies: settings.policies ?? "",
    },
    latestOrder: latestOrderRow
      ? {
        ...latestOrderRow,
        id: Number(latestOrderRow.id),
        total: Number(latestOrderRow.total),
        shipping: Number(latestOrderRow.shipping),
      }
      : null,
  });

  let reply = brain.action === "reply" ? brain.reply : null;
  let draft = brain.action === "draft" ? brain.reply : null;
  let pending: Record<string, unknown> = { ...brain.pending };
  let needsSeller = brain.needsSeller;
  let missedRequest = brain.missedRequest;

  if (brain.action === "confirm_order" && brain.orderToConfirm) {
    const order = brain.orderToConfirm;
    if (order.shipping_known !== true) {
      reply = "Anong area po kayo: Metro Manila, Luzon, Visayas, o Mindanao? Kailangan ko po ito para makuha ang shipping.";
    } else {
      const quantity = Number(order.quantity);
      const product = products.find((item) => item.id === order.product_id && item.active);
      const variant = product?.variants.find((item) => item.id === order.variant_id);
      if (!product || !variant || !Number.isInteger(quantity) || quantity <= 0) {
        reply = "Pasensya na po, hindi na available ang item na ito. I-check ko muna sa seller po.";
        pending = {};
        needsSeller = true;
        missedRequest = true;
      } else {
        if (variant.stock < quantity) {
          const { data: freshVariants, error: stockError } = await supabase.from("variants")
            .select("size, stock").eq("product_id", product.id);
          if (stockError) throw stockError;
          const alternatives = (freshVariants ?? [])
            .filter((item: { size: string; stock: number }) => item.size !== variant.size && item.stock >= quantity)
            .map((item: { size: string }) => item.size);
          reply = alternatives.length
            ? "Pasensya na po, sold out na ang size " + variant.size + ". Available pa po ang size " + alternatives.join(", ") + "."
            : "Pasensya na po, sold out na ang item. I-check ko muna sa seller po.";
          pending = {};
          if (!alternatives.length) {
            needsSeller = true;
            missedRequest = true;
          }
        } else {
          const pricing = quote(product, quantity, new Date(), product.promos);
          const rates = object(settings.shipping_rates) as Record<string, number>;
          const region = typeof order.region === "string" ? order.region : null;
          const shipping = region ? rates[region] : undefined;
          if (typeof shipping !== "number") {
            reply = "Hindi ko makita ang shipping rate para sa area na ito. I-check ko muna sa seller po.";
            pending = {};
            needsSeller = true;
            missedRequest = true;
          } else {
            const total = Math.round((pricing.total + shipping + Number.EPSILON) * 100) / 100;
            const updatedOrder = {
              ...order,
              unit_price: pricing.unit,
              subtotal: pricing.total,
              shipping,
              total,
              offer_label: pricing.label,
            };
            if (Math.round(Number(order.total) * 100) !== Math.round(total * 100)) {
              pending = { ...pending, order: updatedOrder };
              reply = "Nagbago po ang presyo. Ang bagong total ay " + formatPeso(total) +
                ". I-confirm po ulit kung itutuloy.";
            } else {
              const { data: orderId, error } = await supabase.rpc("create_order", {
                p_conversation_id: conversationId,
                p_items: [{
                  variant_id: variant.id,
                  qty: quantity,
                  unit_price: pricing.unit,
                  offer_label: pricing.label,
                }],
                p_shipping: shipping,
                p_total: total,
              });
              if (error && error.message.includes("OUT_OF_STOCK")) {
                const { data: freshVariants, error: stockError } = await supabase.from("variants")
                  .select("size, stock").eq("product_id", product.id);
                if (stockError) throw stockError;
                const freshAlternatives = (freshVariants ?? [])
                  .filter((item: { size: string; stock: number }) => item.size !== variant.size && item.stock >= quantity)
                  .map((item: { size: string }) => item.size);
                reply = freshAlternatives.length
                  ? "Pasensya na po, sold out na ang size " + variant.size + ". Available pa po ang size " + freshAlternatives.join(", ") + "."
                  : "Pasensya na po, sold out na ang item. I-check ko muna sa seller po.";
                pending = {};
                if (!freshAlternatives.length) {
                  needsSeller = true;
                  missedRequest = true;
                }
              } else if (error) {
                throw error;
              } else {
                const payment = String(settings.payment_instructions ?? "").trim();
                reply = "Confirmed po, order #" + orderId + " for " + quantity + " " + product.name +
                  " (" + variant.size + "). Total po ay " + formatPeso(total) + "." +
                  (payment ? " Payment instructions: " + payment : " I-check ko muna sa seller ang payment instructions po.");
                pending = {};
                if (!payment) {
                  needsSeller = true;
                  missedRequest = true;
                }
              }
            }
          }
        }
      }
    }
  }

  if (reply && aiMode === "auto") reply = labelAutoReply(reply, aiMode);
  if (aiMode === "suggest" && reply) {
    draft = reply;
    reply = null;
  }
  const nextPending = draft ? { ...pending, ai_draft: draft } : pending;
  const status = needsSeller ? "needs_seller" : undefined;
  const { error: brainUpdateError } = await supabase.from("conversations")
    .update({ pending: nextPending, ...(status ? { status } : {}) })
    .eq("id", conversationId);
  if (brainUpdateError) throw brainUpdateError;
  if (missedRequest) {
    const { error } = await supabase.from("missed_requests").insert({
      conversation_id: conversationId,
      request_text: text,
    });
    if (error) throw error;
  }

  return { conversationId, reply, draft };
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
