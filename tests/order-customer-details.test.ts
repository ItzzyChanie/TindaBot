import { describe, expect, it } from "vitest";
import { customerDetailsPrompt, isCancellationRequest, isOrderAcknowledgment, isPaymentRequest, isReservationRequest, missingCustomerDetails, parseOrderDetails, paymentSafetyMessage, reservationDetailsPrompt, sellerRepliedAfterOrder, validCustomerEmail, validCustomerMobile } from "../supabase/functions/_shared/order-customer-details";

describe("order customer details", () => {
  it("asks for reservation details without asking for the delivery area again", () => {
    const prompt = reservationDetailsPrompt(true);
    expect(prompt).toContain("Facebook name:");
    expect(prompt).toContain("Permanent Address:");
    expect(prompt).toContain("Mobile number:");
    expect(prompt).toContain("Email address:");
    expect(prompt).toContain("line-by-line");
    expect(prompt).toContain("Nakuha ko na po ang delivery area");
    expect(prompt).not.toContain("Anong area");
  });

  it.each(["reserve", "pwede magpa reserve?", "can I reserve it?"])(
    "recognizes a repeated reservation request while collecting details: %s",
    (text) => expect(isReservationRequest(text)).toBe(true),
  );

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

  it("parses a complete unlabeled four-line details block", () => {
    expect(parseOrderDetails([
      "Jefferson Palceso",
      "Hernandez st. Catmon, Malabon City",
      "09108227050",
      "jeffyt143@gmail.com",
    ].join("\n"))).toEqual({
      customer_full_name: "Jefferson Palceso",
      customer_address: "Hernandez st. Catmon, Malabon City",
      customer_mobile: "09108227050",
      customer_email: "jeffyt143@gmail.com",
    });
  });

  it("keeps details from three unlabeled lines and fills a missing address later", () => {
    const firstMessage = parseOrderDetails(["Sample Name", "0978455023", "sample@gmail.com"].join("\n"));
    expect(firstMessage).toEqual({
      customer_full_name: "Sample Name",
      customer_mobile: "0978455023",
      customer_email: "sample@gmail.com",
    });
    expect(missingCustomerDetails(firstMessage)).toEqual(["customer_address", "customer_mobile"]);

    const address = parseOrderDetails("sample address street", firstMessage);
    const combined = { ...firstMessage, ...address };
    expect(combined).toMatchObject({ customer_full_name: "Sample Name", customer_address: "sample address street", customer_email: "sample@gmail.com" });
    expect(missingCustomerDetails(combined)).toEqual(["customer_mobile"]);
  });

  it("stops asking once the one missing address has been supplied", () => {
    const firstMessage = parseOrderDetails(["Sample Name", "09123456789", "sample@gmail.com"].join("\n"));
    expect(missingCustomerDetails(firstMessage)).toEqual(["customer_address"]);

    const address = parseOrderDetails("sample address street", firstMessage);
    expect(missingCustomerDetails({ ...firstMessage, ...address })).toEqual([]);
  });

  it("parses a missing value in context without overwriting previously collected fields", () => {
    const saved = {
      customer_full_name: "Sample Name",
      customer_mobile: "09123456789",
      customer_email: "sample@gmail.com",
    };
    expect(parseOrderDetails("Permanent Address: 15 Sample Street", saved)).toEqual({ customer_address: "15 Sample Street" });
  });

  it("keeps an order incomplete until every required detail is valid", () => {
    expect(missingCustomerDetails({
      customer_full_name: "Jefferson Palceso",
      customer_address: "Hernandez st. Catmon, Malabon City",
    })).toEqual(["customer_mobile", "customer_email"]);
    expect(missingCustomerDetails({
      customer_full_name: "Jefferson Palceso",
      customer_address: "Hernandez st. Catmon, Malabon City",
      customer_mobile: "not a phone",
      customer_email: "not-an-email",
    })).toEqual(["customer_mobile", "customer_email"]);
  });

  it("prompts only for every missing field, with separate labeled lines", () => {
    const prompt = customerDetailsPrompt(1042, ["customer_mobile", "customer_email"]);
    expect(prompt).toContain("order #1042");
    expect(prompt).toContain("Isang detail bawat linya");
    expect(prompt).toContain("mobile number:");
    expect(prompt).toContain("email address:");
    expect(prompt).not.toContain("Facebook name:");
    expect(prompt).not.toContain("Permanent Address:");
  });

  it("validates email and recognizes polite closing replies", () => {
    expect(validCustomerEmail("buyer@example.com")).toBe(true);
    expect(validCustomerEmail("not-an-email")).toBe(false);
    expect(validCustomerEmail("buyer@domain")).toBe(false);
    expect(validCustomerEmail("@example.com")).toBe(false);
    expect(validCustomerMobile("09171234567")).toBe(true);
    expect(validCustomerMobile("0978455023")).toBe(false);
    expect(validCustomerMobile("+639171234567")).toBe(false);
    expect(validCustomerMobile("09 171234567")).toBe(false);
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
