export type OrderCustomerDetails = {
  customer_full_name?: string;
  customer_address?: string;
  customer_mobile?: string;
  customer_email?: string;
  customer_notes?: string;
};

export const orderDetailFields = [
  ["customer_full_name", "full name"],
  ["customer_address", "complete address"],
  ["customer_mobile", "mobile number"],
  ["customer_email", "email address"],
] as const;

export function parseOrderDetails(text: string): OrderCustomerDetails {
  const result: OrderCustomerDetails = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(full\s*name|name|complete\s*address|address|mobile(?:\s*number)?|phone(?:\s*number)?|contact\s*number|email(?:\s*address)?|(?:optional\s+)?delivery\s*notes?|additional\s*notes?)\s*[:：-]\s*(.*?)\s*$/i);
    if (!match) continue;
    const value = match[2].slice(0, 500).trim();
    const label = match[1].toLowerCase().replace(/\s+/g, " ");
    if (/^(full\s*name|name)$/.test(label)) result.customer_full_name = value.slice(0, 160);
    else if (/^(complete\s*address|address)$/.test(label)) result.customer_address = value;
    else if (/^(mobile|mobile number|phone|phone number|contact number)$/.test(label)) result.customer_mobile = value.slice(0, 40);
    else if (/^email/.test(label)) result.customer_email = value.slice(0, 254);
    else result.customer_notes = value;
  }
  return result;
}

export function customerDetailsPrompt(orderId: number, missing: string[]): string {
  if (missing.length === orderDetailFields.length) {
    return "Listed na po ang order #" + orderId + ". Para ma-coordinate ni seller ang payment at delivery, pakisend po ang details sa format na ito:\nFull name:\nComplete address:\nMobile number:\nEmail address:\nOptional delivery notes:";
  }
  const field = orderDetailFields.find(([key]) => key === missing[0]);
  return "Salamat po. Pakisend naman po ang " + (field?.[1] ?? "kulang na details") + " para sa order #" + orderId + ".";
}

export function validCustomerEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validCustomerMobile(mobile: string): boolean {
  const digits = mobile.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function isOrderAcknowledgment(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return /^(ok|okay|okey|fine|sure|thanks|thank you|salamat|sige|noted|got it|alright|all right)( po)?( thank you| thanks| salamat| po)?$/.test(normalized);
}

export function isCancellationRequest(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return /\b(cancel|cancelled|canceled|cancellation|ipa cancel|ipa kansel|kanselahin|kansel|kancel|don t want to continue|do not want to continue|change my mind|stop.*order|ayoko na.*ituloy|hindi na.*ituloy|wag na.*ituloy)\b/.test(normalized);
}

export function isPaymentRequest(text: string): boolean {
  return /\b(payment|pay|paid|paying|down payment|downpayment|deposit|gcash|maya|cash on delivery|cod|bank transfer|installment|credit card|debit card|magbayad|bayad|bayaran)\b/i.test(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(),
  );
}

export function paymentSafetyMessage(input: {
  channel: string;
  orderId?: number | null;
  orderReserved?: boolean;
  paymentAlreadyRecorded?: boolean;
  sellerPresent?: boolean;
  facebookPageName?: string;
  facebookPageUrl?: string;
}): string {
  const orderReference = input.orderId ? "order #" + input.orderId : "order ninyo";
  const facebookLink = input.channel === "web" &&
      input.facebookPageUrl && /^https:\/\//i.test(input.facebookPageUrl)
    ? " Facebook page: " + (input.facebookPageName?.trim() || "shop page") + " (" + input.facebookPageUrl.trim() + ")."
    : "";

  if (input.paymentAlreadyRecorded) {
    return "No po muna sa panibagong bayad o downpayment. Naka-record na po ang payment sa order #" +
      input.orderId + "; huwag na pong magpadala ulit at hintayin ang update ni seller." +
      (input.channel === "web" ? " Hindi payment channel ang website widget." : "");
  }

  if (input.channel === "telegram") {
    if (input.sellerPresent) {
      return "Opo, nag-reply na po si seller dito. Maaari na po kayong magbayad ayon lamang sa payment instructions na direktang ibinigay niya rito. Pagkatapos, ipadala ang screenshot o proof dito rin sa Telegram para ma-check niya. Huwag magpadala sa ibang account o sa instructions na hindi galing kay seller; hindi po masasagot ng shop ang maling transfer kung hindi susundin ang confirmed instructions.";
    }
    const orderStatus = input.orderReserved
      ? "Naka-lista na po ang " + orderReference + " at naka-reserve na ang item para sa inyo."
      : "Kailangan munang kumpirmahin ang order bago ito mailista at ma-reserve.";
    return "No po muna sa bayad o downpayment habang wala pa si seller sa chat. " + orderStatus +
      ". Kalma lang po at hintayin ang reply niya rito. Kapag nag-reply na si seller, saka po ninyo puwedeng ipadala ang payment screenshot o proof dito rin sa Telegram. Kung magpapadala bago makausap si seller o sa hindi niya kinumpirmang account, hindi po masasagot ng shop ang maling padala o anumang issue.";
  }

  return "No po muna, huwag magbayad o magpadala ng pera sa website chat/widget. Storefront lang po ito para sa basic questions at hindi ito tumatanggap o nagpoproseso ng payment. " +
    (input.orderReserved
      ? "Naka-lista at naka-reserve na po ang " + orderReference + "; kalma lang po at hintayin ang seller."
      : "Pakikumpirma muna ang order at ibigay ang details para mailista ito.") +
    " Para magbayad, mag-direct message po kay seller sa Facebook page at isama ang " + orderReference +
    ", pangalan, at ibang order details. Hintayin muna ang instructions niya bago magpadala." + facebookLink +
    " Kung magbabayad sa widget o sa account na hindi kinumpirma ni seller, hindi po masasagot ng shop ang maling transfer o anumang issue.";
}

export function sellerRepliedAfterOrder(
  orderCreatedAt: string,
  sellerRepliedAt: string | null | undefined,
): boolean {
  if (!sellerRepliedAt) return false;
  const orderTime = Date.parse(orderCreatedAt);
  const sellerTime = Date.parse(sellerRepliedAt);
  return Number.isFinite(orderTime) && Number.isFinite(sellerTime) && sellerTime >= orderTime;
}
