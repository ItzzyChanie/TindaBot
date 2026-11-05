export type OrderCustomerDetails = {
  customer_full_name?: string;
  customer_address?: string;
  customer_mobile?: string;
  customer_email?: string;
  customer_notes?: string;
};

export const orderDetailFields = [
  ["customer_full_name", "Facebook name"],
  ["customer_address", "Permanent Address"],
  ["customer_mobile", "mobile number"],
  ["customer_email", "email address"],
] as const;

export function parseOrderDetails(text: string, existing: OrderCustomerDetails = {}): OrderCustomerDetails {
  const result: OrderCustomerDetails = {};
  const unlabelled: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^\s*(facebook\s*name|fb\s*name|full\s*name|name|permanent\s*address|complete\s*address|address|mobile(?:\s*number)?|phone(?:\s*number)?|contact\s*number|email(?:\s*address)?|(?:optional\s+)?delivery\s*notes?|additional\s*notes?)\s*[:：-]\s*(.*?)\s*$/i);
    if (!match) {
      if (line.includes("@")) result.customer_email = line.slice(0, 254);
      else if (/^[+\d\s().-]+$/.test(line) && /\d/.test(line)) result.customer_mobile = line.slice(0, 40);
      else unlabelled.push(line);
      continue;
    }
    const value = match[2].slice(0, 500).trim();
    const label = match[1].toLowerCase().replace(/\s+/g, " ");
    if (/^(facebook name|fb name|full name|name)$/.test(label)) result.customer_full_name = value.slice(0, 160);
    else if (/^(permanent address|complete address|address)$/.test(label)) result.customer_address = value;
    else if (/^(mobile|mobile number|phone|phone number|contact number)$/.test(label)) result.customer_mobile = value.slice(0, 40);
    else if (/^email/.test(label)) result.customer_email = value.slice(0, 254);
    else result.customer_notes = value;
  }
  if (!existing.customer_full_name && !result.customer_full_name && unlabelled.length) {
    result.customer_full_name = unlabelled.shift()?.slice(0, 160);
  }
  if (!existing.customer_address && !result.customer_address && unlabelled.length) {
    result.customer_address = unlabelled.shift()?.slice(0, 500);
  }
  if (unlabelled.length) {
    result.customer_notes = [result.customer_notes, ...unlabelled].filter(Boolean).join(" ").slice(0, 500);
  }
  return result;
}

export function customerDetailsPrompt(orderId: number, missing: string[]): string {
  return missingDetailsPrompt(missing, orderId);
}

export function missingDetailsPrompt(missing: string[], orderId?: number): string {
  const fields = orderDetailFields.filter(([key]) => missing.includes(key));
  const context = typeof orderId === "number" ? "para sa order #" + orderId : "para ma-reserve ang order";
  return "Pakisend po ang kulang na details " + context + ". Isang detail bawat linya; ilagay ang value pagkatapos ng label:\n" +
    fields.map(([, label]) => label + ":").join("\n");
}

export function reservationDetailsPrompt(includeArea: boolean): string {
  return (includeArea ? "Nakuha ko na po ang delivery area ninyo. " : "") +
    "Para ma-reserve ang order, pakisend po ang details nang line-by-line, isang detail bawat linya. Kopyahin ang format na ito at ilagay ang value pagkatapos ng label:\nFacebook name:\nPermanent Address:\nMobile number:\nEmail address:\nOptional delivery notes:";
}

export function validCustomerEmail(email: string): boolean {
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email);
}

export function validCustomerMobile(mobile: string): boolean {
  return /^09\d{9}$/.test(mobile);
}

export function missingCustomerDetails(details: OrderCustomerDetails): string[] {
  const missing = orderDetailFields
    .filter(([key]) => !String(details[key] ?? "").trim())
    .map(([key]) => key);
  if (!missing.includes("customer_mobile") && !validCustomerMobile(String(details.customer_mobile))) {
    missing.push("customer_mobile");
  }
  if (!missing.includes("customer_email") && !validCustomerEmail(String(details.customer_email))) {
    missing.push("customer_email");
  }
  return missing;
}

export function isOrderAcknowledgment(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return /^(ok|okay|okey|fine|sure|thanks|thank you|salamat|sige|noted|got it|alright|all right)( po)?( thank you| thanks| salamat| po)?$/.test(normalized);
}

export function isReservationRequest(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:(?:pwede|puwede|can|could)\s+(?:(?:i|we|ko)\s+)?)?(?:(?:magpa|pa|ipa|i)\s+)?(?:reserve|reservation)(?:\s+(?:po|please|ito|iyan|nito|this|it))?$/.test(normalized);
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
