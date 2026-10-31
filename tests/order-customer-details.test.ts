import { describe, expect, it } from "vitest";
import { customerDetailsPrompt, isCancellationRequest, isOrderAcknowledgment, isPaymentRequest, parseOrderDetails, paymentSafetyMessage, sellerRepliedAfterOrder, validCustomerEmail, validCustomerMobile } from "../supabase/functions/_shared/order-customer-details";

describe("order customer details", () => {
  it("parses a complete labeled details block", () => {
    expect(parseOrderDetails([
      "Full name: Juan Dela Cruz",
      "Complete address: 123 Mabini Street, Cebu City",
      "Mobile number: +639171234567",
      "Email address: juan@example.com",
      "Optional delivery notes: Gate is beside the bakery",
    ].join("\n"))).toEqual({
      customer_full_name: "Juan Dela Cruz",
      customer_address: "123 Mabini Street, Cebu City",
      customer_mobile: "+639171234567",
      customer_email: "juan@example.com",
      customer_notes: "Gate is beside the bakery",
    });
  });

  it("prompts one missing field at a time after a partial response", () => {
    expect(customerDetailsPrompt(1042, ["customer_mobile", "customer_email"]))
      .toContain("mobile number");
  });

  it("validates email and recognizes polite closing replies", () => {
    expect(validCustomerEmail("buyer@example.com")).toBe(true);
    expect(validCustomerEmail("not-an-email")).toBe(false);
    expect(validCustomerMobile("+639171234567")).toBe(true);
    expect(validCustomerMobile("call me later")).toBe(false);
    for (const message of ["okay", "ok po", "okay, thank you", "thank you po", "fine po", "salamat po"]) {
      expect(isOrderAcknowledgment(message)).toBe(true);
    }
    expect(isOrderAcknowledgment("May update po sa order?")).toBe(false);
  });

  it("recognizes common order-cancellation wording", () => {
    expect(isCancellationRequest("Ayy ipa-cancel ko nalang po pala yung order ko")).toBe(true);
    expect(isCancellationRequest("Please cancel my order")).toBe(true);
    expect(isCancellationRequest("I don't want to continue my order")).toBe(true);
    expect(isCancellationRequest("Ayoko na palang ituloy")).toBe(true);
    expect(isCancellationRequest("Can I ask about my order?")).toBe(false);
  });

  it("recognizes payment and down-payment messages while collecting details", () => {
    for (const message of ["Pwede na po bang magbayad?", "Can I send a downpayment?", "May I pay now?", "GCash po?"]) {
      expect(isPaymentRequest(message)).toBe(true);
    }
  });

  it("gives web and Telegram buyers different payment safety instructions", () => {
    const web = paymentSafetyMessage({
      channel: "web",
      orderId: 1042,
      orderReserved: true,
      facebookPageName: "Jeff's Shop",
      facebookPageUrl: "https://facebook.com/jeffsshop",
    });
    expect(web).toContain("website chat/widget");
    expect(web).toContain("basic questions");
    expect(web).toContain("https://facebook.com/jeffsshop");
    expect(web).toContain("order #1042");
    expect(web).toContain("hindi po masasagot ng shop");

    const telegram = paymentSafetyMessage({ channel: "telegram", orderId: 1042, orderReserved: true });
    expect(telegram).toContain("habang wala pa si seller");
    expect(telegram).toContain("payment screenshot o proof dito rin sa Telegram");
    expect(telegram).not.toContain("website chat/widget");
    expect(telegram).toContain("hindi po masasagot ng shop");

    const sellerPresent = paymentSafetyMessage({ channel: "telegram", orderId: 1042, orderReserved: true, sellerPresent: true });
    expect(sellerPresent).toContain("nag-reply na po si seller");
    expect(sellerPresent).toContain("payment instructions na direktang ibinigay niya");
  });

  it("only accepts a Telegram payment proof after seller presence", () => {
    expect(sellerRepliedAfterOrder("2026-11-10T10:00:00Z", "2026-11-10T10:01:00Z")).toBe(true);
    expect(sellerRepliedAfterOrder("2026-11-10T10:00:00Z", "2026-11-10T09:59:00Z")).toBe(false);
    expect(sellerRepliedAfterOrder("2026-11-10T10:00:00Z", null)).toBe(false);
  });
});
