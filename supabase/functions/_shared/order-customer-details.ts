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
