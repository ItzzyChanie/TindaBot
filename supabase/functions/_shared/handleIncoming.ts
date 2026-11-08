import { createClient } from "@supabase/supabase-js";
import { labelAutoReply, readRecentProducts, rememberProduct, runIncomingBrain, type BrainPending, type BrainProduct } from "./brain.ts";
import { quote, type QuotePromo } from "./quote.ts";
import { resolveProduct } from "./rules.ts";
import { notifySeller } from "./notify.ts";
import { customerDetailsPrompt, isCancellationRequest, isOrderAcknowledgment, isPaymentRequest, isReservationRequest, missingCustomerDetails, missingDetailsPrompt, orderDetailFields, parseOrderDetails, paymentSafetyMessage, reservationDetailsPrompt, sellerRepliedAfterOrder, type OrderCustomerDetails, validCustomerEmail, validCustomerMobile } from "./order-customer-details.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type ProductRow = Omit<BrainProduct, "price" | "discount_value" | "variants" | "promos"> & {
  price: number | string;
  discount_value: number | string | null;
  variants: Array<BrainProduct["variants"][number] & { stock: number | string; price: number | string | null }>;
  promos: Array<QuotePromo & { value: number | string }>;
};

function notifySellerSafely(event: Parameters<typeof notifySeller>[0]): void {
  void notifySeller(event).catch((error) => {
    console.error("[notify] Notification call failed", error instanceof Error ? error.name : "unknown_error");
  });
}

export type IncomingContext = {
  externalMessageId?: string;
  channelMessageId?: string;
  replyToMessageId?: string;
  replyToChannelMessageId?: string;
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

function keepRecentProducts(pending: Record<string, unknown>, previous: Record<string, unknown>, now = Date.now()): Record<string, unknown> {
  const all = [...readRecentProducts(pending, now), ...readRecentProducts(previous, now)];
  const unique = new Map<string, (typeof all)[number]>();
  for (const item of all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    if (!unique.has(item.product_id)) unique.set(item.product_id, item);
  }
  const result: Record<string, unknown> = { ...pending, recent_products: [...unique.values()].slice(0, 3) };
  delete result.last_product;
  return result;
}

function formatPeso(value: number): string {
  return "₱" + value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sellerPresentForOrder(conversationId: string, orderId: number, aiMode: string): Promise<boolean> {
  const [{ data: order, error: orderError }, { data: sellerMessage, error: sellerMessageError }] = await Promise.all([
    supabase.from("orders").select("created_at").eq("id", orderId).maybeSingle(),
    supabase.from("messages").select("created_at").eq("conversation_id", conversationId).eq("sender", "seller")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (orderError) throw orderError;
  if (sellerMessageError) throw sellerMessageError;
  if (!order || !sellerMessage) return false;
  return aiMode === "human" || sellerRepliedAfterOrder(order.created_at, sellerMessage.created_at);
}

async function savePaymentProof(conversationId: string, customerId: string, proof: NonNullable<IncomingContext["paymentProof"]>, text: string, channel: string, customerName: string | null) {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, payment_proof, created_at")
    .eq("customer_id", customerId)
    .eq("status", "awaiting_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) throw orderError;

  if (order) {
    notifySellerSafely({ type: "payment_proof", conversationId, orderId: Number(order.id), dedupeKey: `payment_proof:${order.id}` });
  }

  let reply = "Natanggap po ang payment proof. Iko-confirm ito ng seller.";
  let systemBody = "Payment proof received.";
  if (order) {
    const [{ data: sellerMessage, error: sellerMessageError }, { data: activeConversation, error: activeConversationError }] = await Promise.all([
      supabase.from("messages").select("created_at").eq("conversation_id", conversationId).eq("sender", "seller")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("conversations").select("ai_mode").eq("id", conversationId).maybeSingle(),
    ]);
    if (sellerMessageError) throw sellerMessageError;
    if (activeConversationError) throw activeConversationError;
    const sellerIsPresent = Boolean(sellerMessage) &&
      (activeConversation?.ai_mode === "human" || sellerRepliedAfterOrder(order.created_at, sellerMessage?.created_at));
    if (!sellerIsPresent) {
      reply = "Nakita po namin ang file, pero hindi muna ito tinanggap bilang payment proof dahil hindi pa nagre-reply si seller. Huwag muna pong magbayad o mag-send ulit. Hintayin ang seller dito; kapag nag-reply na siya, saka po ipadala ang proof sa Telegram.";
      systemBody = "Customer sent a payment file before the seller replied; it was not attached to the order.";
    } else {
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
    }
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
  notifySellerSafely({ type: "needs_seller", conversationId, customerName, channel, dedupeKey: `needs_seller:${conversationId}` });
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

  let productId: string | null = null;
  if (context.productId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.productId)) {
    const { data: contextProduct, error } = await supabase.from("products")
      .select("id").eq("id", context.productId).eq("active", true).maybeSingle();
    if (error) throw error;
    productId = contextProduct?.id ?? null;
  }

  const { data: currentCustomer, error: currentCustomerError } = await supabase.from("customers")
    .select("name").eq("channel", channel).eq("external_id", externalId).maybeSingle();
  if (currentCustomerError) throw currentCustomerError;
  const customerName = context.name?.trim() || currentCustomer?.name || null;
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .upsert({ channel, external_id: externalId, name: customerName?.slice(0, 160) ?? null }, { onConflict: "channel,external_id" })
    .select("id")
    .single();
  if (customerError) throw customerError;

  const { data: existing, error: conversationError } = await supabase
    .from("conversations")
    .select("id, status, ai_mode, pending, context_product_id")
    .eq("customer_id", customer.id)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (conversationError) throw conversationError;

  let conversationId = existing?.id as string | undefined;
  const firstContact = !existing;
  if (!conversationId) {
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({ customer_id: customer.id, context_product_id: productId })
      .select("id, status, ai_mode, pending")
      .single();
    if (error) throw error;
    conversationId = created.id;
  }
  if (!conversationId) throw new Error("Could not create a conversation");
  if (existing && productId) {
    const { error } = await supabase.from("conversations")
      .update({ context_product_id: productId }).eq("id", conversationId);
    if (error) throw error;
  }

  let replyTarget: { id: string; body: string; unsent_at: string | null; reply_to_message_id: string | null; reply_to_text: string | null } | null = null;
  if (context.replyToMessageId) {
    const { data, error } = await supabase.from("messages")
      .select("id, body, unsent_at, reply_to_message_id, reply_to_text").eq("id", context.replyToMessageId)
      .eq("conversation_id", conversationId).maybeSingle();
    if (error) throw error;
    replyTarget = data;
  } else if (context.replyToChannelMessageId) {
    const { data, error } = await supabase.from("messages")
      .select("id, body, unsent_at, reply_to_message_id, reply_to_text").eq("conversation_id", conversationId)
      .contains("channel_message_ids", [context.replyToChannelMessageId]).maybeSingle();
    if (error) throw error;
    replyTarget = data;
  }
  let replyParentText: string | null = null;
  if (replyTarget?.reply_to_message_id) {
    const { data: parent, error } = await supabase.from("messages")
      .select("body").eq("id", replyTarget.reply_to_message_id)
      .eq("conversation_id", conversationId).maybeSingle();
    if (error) throw error;
    replyParentText = parent?.body ?? null;
  }
  const replyContextText = [replyTarget?.body, replyParentText, replyTarget?.reply_to_text]
    .filter((value): value is string => Boolean(value?.trim())).join("\n");
  const { data: previousMessages, error: historyError } = await supabase.from("messages")
    .select("sender, body").eq("conversation_id", conversationId).in("sender", ["customer", "ai"])
    .order("created_at", { ascending: false }).limit(6);
  if (historyError) throw historyError;
  const history = (previousMessages ?? []).reverse().map((message) => ({
    role: message.sender === "ai" ? "bot" as const : "customer" as const,
    text: String(message.body ?? "").slice(0, 200),
  }));
  const { error: messageError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender: "customer",
    body: text,
    external_message_id: context.externalMessageId ?? null,
    channel_message_ids: context.channelMessageId ? [context.channelMessageId] : [],
    reply_to_message_id: replyTarget?.id ?? null,
    reply_to_text: replyTarget ? (replyTarget.unsent_at ? "Message was unsent" : replyTarget.body.slice(0, 180)) : null,
  });
  if (messageError?.code === "23505" && context.externalMessageId) {
    return { conversationId, reply: null, draft: null, duplicate: true };
  }
  if (messageError) throw messageError;

  const { error: updateError } = await supabase.from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_customer_message_at: new Date().toISOString(),
      seller_read_at: null,
      is_hidden: false,
      ...(existing?.status === "resolved" ? { status: "open" } : {}),
    }).eq("id", conversationId);
  if (updateError) throw updateError;

  let conversation = existing
    ? { ...existing, status: existing.status === "resolved" ? "open" : existing.status }
    : { status: "open", ai_mode: "auto", pending: {} };
  const aiMode = conversation.ai_mode as "auto" | "suggest" | "human";
  if (/^\s*(seller|\/seller)\s*$/i.test(text)) {
    const { error } = await supabase.from("conversations").update({ status: "needs_seller" }).eq("id", conversationId);
    if (error) throw error;
    const { error: missedError } = await supabase.from("missed_requests").insert({ conversation_id: conversationId, request_text: text });
    if (missedError) throw missedError;
    notifySellerSafely({ type: "needs_seller", conversationId, customerName, channel, dedupeKey: `needs_seller:${conversationId}` });
    const handoff = "Sige po, ipinasa ko na sa seller ang chat na ito. Magre-reply po siya rito kapag available.";
    return { conversationId, reply: aiMode === "human" ? null : labelAutoReply(handoff, aiMode), draft: null };
  }
  if (context.paymentProof) {
    const reply = await savePaymentProof(conversationId, customer.id, context.paymentProof, text, channel, customerName);
    return {
      conversationId,
      reply: aiMode === "human" ? null : labelAutoReply(reply, aiMode),
      draft: null,
    };
  }

  if (aiMode === "human") {
    return { conversationId, reply: null, draft: null };
  }

  const { data: productRows, error: productsError } = await supabase
    .from("products")
    .select("id, name, aliases, description, image_url, colors, material, fabric_details, fit_notes, size_guidance, restock_note, model_details, photos_are_actual, additional_images, video_url, price, active, discount_type, discount_value, discount_starts, discount_ends, variants(id, size, stock, price), promos(label, kind, min_qty, value, starts_at, ends_at, active)")
    .eq("active", true);
  if (productsError) throw productsError;
  const products = ((productRows ?? []) as unknown as ProductRow[]).map((row) => ({
    ...row,
    price: Number(row.price),
    discount_value: row.discount_value === null ? null : Number(row.discount_value),
    variants: (row.variants ?? []).map((variant) => ({ ...variant, stock: Number(variant.stock), price: variant.price === null ? null : Number(variant.price) })),
    promos: (row.promos ?? []).map((promo) => ({ ...promo, value: Number(promo.value) })),
  })) as BrainProduct[];

  const { data: settingsRow, error: settingsError } = await supabase
    .from("shop_settings")
    .select("shipping_rates, payment_instructions, policies, size_chart_url, greeting_text, shipping_text, faq_answers, bot_options")
    .eq("shop_id", "00000000-0000-4000-8000-000000000001")
    .maybeSingle();
  if (settingsError) throw settingsError;
  const settings = settingsRow ?? { shipping_rates: {}, payment_instructions: "", policies: "", size_chart_url: null, greeting_text: "", shipping_text: "", faq_answers: {}, bot_options: {} };
  let currentPending = keepRecentProducts(object(conversation.pending), object(conversation.pending)) as BrainPending;
  const legacyRecent = object(currentPending.last_product);
  if (!Array.isArray(currentPending.recent_products) && typeof legacyRecent.product_id === "string") {
    const legacyProduct = products.find((item) => item.id === legacyRecent.product_id);
    if (legacyProduct) currentPending = rememberProduct(currentPending, legacyProduct, {
      size: typeof legacyRecent.size === "string" ? legacyRecent.size : null,
      color: typeof legacyRecent.color === "string" ? legacyRecent.color : null,
    }) as BrainPending;
  }
  delete currentPending.last_product;
  const explicitProduct = products.find((item) => item.id === productId) ?? (() => {
    const match = resolveProduct(text, products);
    return match.status === "matched" ? match.product as BrainProduct : null;
  })();
  const repliedProductResolution = replyContextText ? resolveProduct(replyContextText, products) : null;
  const repliedProduct = repliedProductResolution?.status === "matched" ? repliedProductResolution.product as BrainProduct : null;
  const mentionedProduct = explicitProduct ?? repliedProduct;
  if (mentionedProduct) currentPending = rememberProduct(currentPending, mentionedProduct, {
    size: typeof legacyRecent.size === "string" ? legacyRecent.size : null,
    color: typeof legacyRecent.color === "string" ? legacyRecent.color : null,
  }) as BrainPending;
  if (mentionedProduct || legacyRecent.product_id) {
    const { error } = await supabase.from("conversations").update({ pending: currentPending }).eq("id", conversationId);
    if (error) throw error;
  }
  conversation = { ...conversation, pending: currentPending };
  const detailState = object(currentPending.order_customer_details);
  const provisionalOrder = object(detailState.order);
  const hasProvisionalOrder = typeof provisionalOrder.variant_id === "string";
  if (hasProvisionalOrder && isCancellationRequest(text)) {
    const remainingPending = { ...currentPending };
    delete remainingPending.order_customer_details;
    const { error } = await supabase.from("conversations").update({ pending: remainingPending }).eq("id", conversationId);
    if (error) throw error;
    const cancellation = "Noted po, kinansela ko ang reservation request. Wala pang stock na na-reserve o order na nailista.";
    return { conversationId, reply: aiMode === "auto" ? labelAutoReply(cancellation, aiMode) : null, draft: aiMode === "suggest" ? cancellation : null };
  }
  if (isCancellationRequest(text) &&
    (typeof detailState.order_id === "number" || currentPending.order_followup === "done")) {
    let orderId = typeof detailState.order_id === "number" ? detailState.order_id : Number(currentPending.order_id);
    if (!Number.isFinite(orderId)) {
      const { data: latestOrder, error: latestOrderError } = await supabase.from("orders")
        .select("id").eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (latestOrderError) throw latestOrderError;
      orderId = Number(latestOrder?.id ?? 0);
    }
    const options = object(settings.bot_options);
    const pageName = typeof options.facebook_page_name === "string" ? options.facebook_page_name.trim() : "";
    const pageUrl = typeof options.facebook_page_url === "string" && /^https:\/\//i.test(options.facebook_page_url) ? options.facebook_page_url.trim() : "";
    const contact = pageUrl ? " Maaari po kayong mag-message sa Facebook page na " + (pageName || "shop page") + ": " + pageUrl + "." : " Mag-reply po sa seller dito sa chat.";
    const cancellationReply = "Naka-confirm na po ang order #" + orderId + ", kaya hindi na ito makakansela ng bot. Para matulungan kayo ng seller, pakihintay po ang reply niya." + contact;
    const reply = aiMode === "auto" ? labelAutoReply(cancellationReply, aiMode) : null;
    return { conversationId, reply, draft: aiMode === "suggest" ? cancellationReply : null };
  }
  if (typeof detailState.order_id === "number" && isPaymentRequest(text)) {
    const options = object(settings.bot_options);
    const pageName = typeof options.facebook_page_name === "string" ? options.facebook_page_name.trim() : "";
    const pageUrl = typeof options.facebook_page_url === "string" && /^https:\/\//i.test(options.facebook_page_url) ? options.facebook_page_url.trim() : "";
    const paymentReply = paymentSafetyMessage({
      channel,
      orderId: detailState.order_id,
      orderReserved: true,
      sellerPresent: channel === "telegram"
        ? await sellerPresentForOrder(conversationId, detailState.order_id, aiMode)
        : false,
      facebookPageName: pageName,
      facebookPageUrl: pageUrl,
    });
    const reply = aiMode === "auto" ? labelAutoReply(paymentReply, aiMode) : null;
    return { conversationId, reply, draft: aiMode === "suggest" ? paymentReply : null };
  }
  if (typeof detailState.order_id === "number" && isOrderAcknowledgment(text)) {
    const savedDetails = object(detailState.values);
    const missing = missingCustomerDetails(savedDetails as OrderCustomerDetails);
    const prompt = customerDetailsPrompt(detailState.order_id, missing);
    const reply = aiMode === "auto" ? labelAutoReply(prompt, aiMode) : null;
    return { conversationId, reply, draft: aiMode === "suggest" ? prompt : null };
  }
  if (hasProvisionalOrder && (isOrderAcknowledgment(text) || isReservationRequest(text))) {
    const savedDetails = object(detailState.values) as OrderCustomerDetails;
    const missing = missingCustomerDetails(savedDetails);
    const prompt = missingDetailsPrompt(missing);
    return { conversationId, reply: aiMode === "auto" ? labelAutoReply(prompt, aiMode) : null, draft: aiMode === "suggest" ? prompt : null };
  }
  if (typeof detailState.order_id === "number" || hasProvisionalOrder) {
    const details = { ...object(detailState.values) } as OrderCustomerDetails;
    const parsedInput = parseOrderDetails(text, details);
    Object.assign(details, Object.fromEntries(
      Object.entries(parsedInput).filter(([, value]) => typeof value === "string" && value.trim()),
    ));
    if (Object.keys(parsedInput).length === 0) {
      const firstMissing = orderDetailFields.find(([key]) => !details[key]);
      if (firstMissing && text.trim()) {
        const maxLength = firstMissing[0] === "customer_full_name" ? 160
          : firstMissing[0] === "customer_address" ? 500
          : firstMissing[0] === "customer_mobile" ? 40 : 254;
        details[firstMissing[0]] = text.trim().slice(0, maxLength);
      }
    }
    const invalidMobile = Boolean(details.customer_mobile && !validCustomerMobile(details.customer_mobile));
    const invalidEmail = Boolean(details.customer_email && !validCustomerEmail(details.customer_email));
    const missing = missingCustomerDetails(details);
    if (missing.includes("customer_mobile") && details.customer_mobile) details.customer_mobile = "";
    if (missing.includes("customer_email") && details.customer_email) details.customer_email = "";
    if (missing.length) {
      const nextPending = {
        ...currentPending,
        order_customer_details: hasProvisionalOrder
          ? { order: provisionalOrder, values: details }
          : { order_id: detailState.order_id, values: details },
      };
      const { error } = await supabase.from("conversations").update({ pending: nextPending }).eq("id", conversationId);
      if (error) throw error;
      const prompt = missingDetailsPrompt(missing, typeof detailState.order_id === "number" ? detailState.order_id : undefined) +
        (invalidMobile ? " Mobile number po ay dapat 11 digits, nagsisimula sa 09, at digits lang." : "") +
        (invalidEmail ? " Email po ay dapat valid ang format, tulad ng name@example.com." : "");
      const reply = aiMode === "auto" ? labelAutoReply(prompt, aiMode) : null;
      return { conversationId, reply, draft: aiMode === "suggest" ? prompt : null };
    }

    let orderId = Number(detailState.order_id);
    if (hasProvisionalOrder) {
      const quantity = Number(provisionalOrder.quantity);
      const product = products.find((item) => item.id === provisionalOrder.product_id && item.active);
      const variant = product?.variants.find((item) => item.id === provisionalOrder.variant_id);
      if (!product || !variant || !Number.isInteger(quantity) || quantity <= 0) {
        const { error } = await supabase.from("conversations").update({ pending: { recent_products: currentPending.recent_products }, status: "needs_seller" }).eq("id", conversationId);
        if (error) throw error;
        const message = "Pasensya na po, hindi ko na ma-verify ang item para sa reservation. Ipa-check ko muna sa seller po.";
        const { error: missedError } = await supabase.from("missed_requests").insert({
          conversation_id: conversationId,
          request_text: "Reservation could not be completed because the catalog item is unavailable.",
        });
        if (missedError) throw missedError;
        notifySellerSafely({ type: "needs_seller", conversationId, customerName, channel, dedupeKey: `needs_seller:${conversationId}` });
        return { conversationId, reply: aiMode === "auto" ? labelAutoReply(message, aiMode) : null, draft: aiMode === "suggest" ? message : null };
      }
      const pricing = quote(product, quantity, new Date(), product.promos, variant.price);
      const shipping = Number(provisionalOrder.shipping);
      const total = Math.round((pricing.total + shipping + Number.EPSILON) * 100) / 100;
      if (Math.round(Number(provisionalOrder.total) * 100) !== Math.round(total * 100)) {
        const { error } = await supabase.from("conversations").update({ pending: { recent_products: currentPending.recent_products }, status: "needs_seller" }).eq("id", conversationId);
        if (error) throw error;
        const message = "Nagbago po ang quote habang kinukuha ang details. Ipa-confirm ko muna sa seller ang latest price bago mag-reserve.";
        const { error: missedError } = await supabase.from("missed_requests").insert({
          conversation_id: conversationId,
          request_text: "Reservation quote changed before customer details were completed.",
        });
        if (missedError) throw missedError;
        notifySellerSafely({ type: "needs_seller", conversationId, customerName, channel, dedupeKey: `needs_seller:${conversationId}` });
        return { conversationId, reply: aiMode === "auto" ? labelAutoReply(message, aiMode) : null, draft: aiMode === "suggest" ? message : null };
      }
      const { data: createdOrderId, error: createOrderError } = await supabase.rpc("create_order", {
        p_conversation_id: conversationId,
        p_items: [{
          variant_id: variant.id,
          qty: quantity,
          unit_price: pricing.unit,
          offer_label: pricing.label,
          color: typeof provisionalOrder.color === "string" ? provisionalOrder.color : null,
        }],
        p_shipping: shipping,
        p_total: total,
      });
      if (createOrderError?.message.includes("OUT_OF_STOCK")) {
        const { error } = await supabase.from("conversations").update({ pending: { recent_products: currentPending.recent_products }, status: "needs_seller" }).eq("id", conversationId);
        if (error) throw error;
        const message = "Pasensya na po, naubos na ang stock habang kinukuha ang details kaya hindi ko na-reserve. Ipa-check ko muna sa seller ang ibang available na option po.";
        const { error: missedError } = await supabase.from("missed_requests").insert({
          conversation_id: conversationId,
          request_text: "Reservation stock ran out before customer details were completed.",
        });
        if (missedError) throw missedError;
        notifySellerSafely({ type: "needs_seller", conversationId, customerName, channel, dedupeKey: `needs_seller:${conversationId}` });
        return { conversationId, reply: aiMode === "auto" ? labelAutoReply(message, aiMode) : null, draft: aiMode === "suggest" ? message : null };
      }
      if (createOrderError) throw createOrderError;
      orderId = Number(createdOrderId);
      notifySellerSafely({ type: "new_order", conversationId, orderId, amount: total, dedupeKey: `new_order:${orderId}` });
      const { error: reservationStateError } = await supabase.from("conversations")
        .update({ pending: { ...currentPending, order_customer_details: { order_id: orderId, values: details } } })
        .eq("id", conversationId);
      if (reservationStateError) throw reservationStateError;
    }

    const { error: orderDetailsError } = await supabase.from("orders").update({
      customer_full_name: details.customer_full_name,
      customer_address: details.customer_address,
      customer_mobile: details.customer_mobile,
      customer_email: details.customer_email,
      customer_notes: details.customer_notes ?? null,
    }).eq("id", orderId);
    if (orderDetailsError) throw orderDetailsError;
    const { error: conversationUpdateError } = await supabase.from("conversations")
      .update({ pending: { recent_products: currentPending.recent_products, order_followup: "done", order_id: orderId }, status: "needs_seller" }).eq("id", conversationId);
    if (conversationUpdateError) throw conversationUpdateError;
    notifySellerSafely({ type: "needs_seller", conversationId, customerName, channel, dedupeKey: `needs_seller:${conversationId}` });
    const options = object(settings.bot_options);
    const pageName = typeof options.facebook_page_name === "string" ? options.facebook_page_name.trim() : "";
    const pageUrl = typeof options.facebook_page_url === "string" && /^https:\/\//i.test(options.facebook_page_url) ? options.facebook_page_url.trim() : "";
    const completion = "Salamat po! Kumpleto na ang details ng order #" + orderId +
      ". Ire-review po muna ni seller ang details ninyo para ma-verify ang buyer at matiyak ang tamang delivery information. " +
      paymentSafetyMessage({
        channel,
        orderId,
        orderReserved: true,
        sellerPresent: channel === "telegram"
          ? await sellerPresentForOrder(conversationId, orderId, aiMode)
          : false,
        facebookPageName: pageName,
        facebookPageUrl: pageUrl,
      });
    const reply = aiMode === "auto" ? labelAutoReply(completion, aiMode) : null;
    return { conversationId, reply, draft: aiMode === "suggest" ? completion : null };
  }
  if (currentPending.order_followup === "done") {
    if (isOrderAcknowledgment(text))
      return { conversationId, reply: null, draft: null };
    const resetState = { recent_products: currentPending.recent_products };
    const { error } = await supabase.from("conversations").update({ pending: resetState }).eq("id", conversationId);
    if (error) throw error;
    conversation = { ...conversation, pending: resetState };
  }
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
    history,
    replyPromptText: replyTarget?.body ?? null,
    replyContextText: replyContextText || null,
    replyPriorText: replyParentText,
    channel,
    sellerPresent: channel === "telegram" && latestOrderRow
      ? await sellerPresentForOrder(conversationId, Number(latestOrderRow.id), aiMode)
      : false,
    contextProductId: productId ?? (existing?.context_product_id as string | null | undefined) ?? null,
    aiMode,
    status: conversation.status as "open" | "needs_seller" | "resolved",
    firstContact,
    pending: object(conversation.pending) as BrainPending,
    products,
    settings: {
      shipping_rates: object(settings.shipping_rates) as Record<string, number>,
      payment_instructions: settings.payment_instructions ?? "",
      policies: settings.policies ?? "",
      size_chart_url: settings.size_chart_url ?? null,
      greeting_text: settings.greeting_text ?? "",
      shipping_text: settings.shipping_text ?? "",
      faq_answers: object(settings.faq_answers) as Record<string, string>,
      bot_options: object(settings.bot_options) as NonNullable<Parameters<typeof runIncomingBrain>[0]["settings"]["bot_options"]>,
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
          const pricing = quote(product, quantity, new Date(), product.promos, variant.price);
          const rates = object(settings.shipping_rates) as Record<string, number>;
          const region = typeof order.region === "string" ? order.region : null;
          const freeMinimum = Number(object(settings.bot_options).free_shipping_minimum ?? 0);
          const configuredShipping = region ? rates[region] : undefined;
          const quotedShipping = Number(order.shipping);
          // Keep the delivery charge used in the quote the customer confirmed.
          // Recomputing free shipping here can silently change the total mid-flow.
          const shipping = order.shipping_known === true && Number.isFinite(quotedShipping)
            ? quotedShipping
            : typeof configuredShipping === "number" && freeMinimum > 0 && Number(order.subtotal) >= freeMinimum
              ? 0
              : configuredShipping;
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
              const orderDetailsPrompt = reservationDetailsPrompt(typeof order.region === "string");
              reply = "Sige po, noted ang request na i-reserve ang " + product.name + " (" + variant.size + ") x" + quantity +
                " sa total na " + formatPeso(total) + ". Wala pang stock na na-reserve; makukumpleto ito pagkatapos ma-verify ang details ninyo.\n\n" + orderDetailsPrompt;
              const nextPending = { ...pending };
              delete nextPending.order;
              pending = { ...nextPending, order_customer_details: { order: updatedOrder, values: {} } };
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
  const nextPending = keepRecentProducts(draft ? { ...pending, ai_draft: draft } : pending, currentPending);
  const status = needsSeller
    ? "needs_seller"
    : brain.clearSellerHandoff
      ? "open"
      : undefined;
  const { error: brainUpdateError } = await supabase.from("conversations")
    .update({ pending: nextPending, ...(status ? { status } : {}) })
    .eq("id", conversationId);
  if (brainUpdateError) throw brainUpdateError;
  if (status === "needs_seller") {
    notifySellerSafely({ type: "needs_seller", conversationId, customerName, channel, customerText: text, dedupeKey: `needs_seller:${conversationId}` });
  }
  if (missedRequest) {
    const { error } = await supabase.from("missed_requests").insert({
      conversation_id: conversationId,
      request_text: text,
    });
    if (error) throw error;
  }

  return { conversationId, reply, draft, imageUrl: reply ? brain.imageUrl ?? null : null, imageUrls: reply ? brain.imageUrls ?? [] : [], replyMarkup: reply ? brain.replyMarkup ?? null : null };
}

export async function saveAssistantReply(
  conversationId: string,
  body: string,
  imageUrls: string[] = [],
  deliveryStatus: "sent" | "pending" = "sent",
) {
  const { data: message, error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender: "ai",
    body,
    delivery_status: deliveryStatus,
    image_urls: imageUrls.filter((url) => /^https:\/\//i.test(url)).slice(0, 5),
  }).select("id").single();
  if (error) throw error;

  const { error: updateError } = await supabase.from("conversations")
    .update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
  if (updateError) throw updateError;
  return message.id as string;
}

export async function saveChannelMessageIds(messageId: string, channelMessageIds: string[]) {
  const { error } = await supabase.from("messages")
    .update({ channel_message_ids: channelMessageIds })
    .eq("id", messageId);
  if (error) throw error;
}
