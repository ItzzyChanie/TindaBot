import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractMetaInboundMessages, metaCustomerDisplayName, metaSignatureSecretForObject, verifyMetaSignature } from "../supabase/functions/_shared/meta-webhook-security";

describe("Meta webhook security", () => {
  it("accepts the HMAC signature for the exact raw payload", async () => {
    const body = JSON.stringify({ object: "page", entry: [{ id: "page-1" }] });
    const signature = `sha256=${createHmac("sha256", "test-secret").update(body).digest("hex")}`;
    await expect(verifyMetaSignature(body, signature, "test-secret")).resolves.toBe(true);
    await expect(verifyMetaSignature(body + " ", signature, "test-secret")).resolves.toBe(false);
  });

  it("rejects missing, malformed, and mismatched signatures", async () => {
    await expect(verifyMetaSignature("{}", null, "test-secret")).resolves.toBe(false);
    await expect(verifyMetaSignature("{}", "sha1=bad", "test-secret")).resolves.toBe(false);
    await expect(verifyMetaSignature("{}", `sha256=${"0".repeat(64)}`, "test-secret")).resolves.toBe(false);
  });

  it("selects the Instagram Login app secret for Instagram webhook signatures", async () => {
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const instagramSecret = metaSignatureSecretForObject("instagram", "meta-secret", "instagram-secret");
    const messengerSecret = metaSignatureSecretForObject("page", "meta-secret", "instagram-secret");
    const signature = `sha256=${createHmac("sha256", "instagram-secret").update(body).digest("hex")}`;
    expect(instagramSecret).toBe("instagram-secret");
    expect(messengerSecret).toBe("meta-secret");
    await expect(verifyMetaSignature(body, signature, instagramSecret)).resolves.toBe(true);
    await expect(verifyMetaSignature(body, signature, messengerSecret)).resolves.toBe(false);
  });

  it("deduplicates message ids from mock Messenger and Instagram payloads", () => {
    const payload = {
      object: "page",
      entry: [{ id: "page-1", messaging: [
        { sender: { id: "customer-1" }, message: { mid: "m-1", text: "hello" } },
        { sender: { id: "customer-1" }, message: { mid: "m-1", text: "hello" } },
        { sender: { id: "page-1" }, message: { mid: "echo-1", text: "reply", is_echo: true } },
      ] }],
    };
    expect(extractMetaInboundMessages(payload)).toMatchObject([
      { channel: "messenger", accountId: "page-1", senderId: "customer-1", recipientId: null, messageId: "m-1", text: "hello", ignoredReason: null },
      { senderId: "customer-1", messageId: "m-1", ignoredReason: "duplicate_in_payload" },
      { senderId: "page-1", messageId: "echo-1", ignoredReason: "echo" },
    ]);
    const instagramPayload = {
      object: "instagram",
      entry: [{
        id: "17841400000000001",
        messaging: [{
          sender: { id: "17841400000000002" },
          recipient: { id: "17841400000000001" },
          timestamp: 1793560000000,
          message: { mid: "aWdf-test-message", text: "Hi po" },
        }],
      }],
    };
    expect(extractMetaInboundMessages(instagramPayload, "17841400000000001")).toMatchObject([
      {
        objectType: "instagram",
        fieldType: "messaging",
        eventType: "message",
        accountId: "17841400000000001",
        senderId: "17841400000000002",
        recipientId: "17841400000000001",
        messageId: "aWdf-test-message",
        text: "Hi po",
        ignoredReason: null,
      },
    ]);
    const mismatchPayload = structuredClone(instagramPayload);
    mismatchPayload.entry[0].messaging[0].recipient.id = "wrong-account";
    expect(extractMetaInboundMessages(mismatchPayload, "17841400000000001")[0].ignoredReason)
      .toBe("recipient_account_mismatch");
  });

  it("records postbacks and reactions as ignored events", () => {
    const payload = {
      object: "instagram",
      entry: [{ id: "ig-business", messaging: [
        { sender: { id: "ig-customer" }, recipient: { id: "ig-business" }, postback: { title: "Shop" } },
        { sender: { id: "ig-customer" }, recipient: { id: "ig-business" }, reaction: { action: "react" } },
      ] }],
    };
    expect(extractMetaInboundMessages(payload, "ig-business")).toMatchObject([
      { eventType: "postback", ignoredReason: "unsupported_event_type" },
      { eventType: "reaction", ignoredReason: "unsupported_event_type" },
    ]);
  });

  it("formats Messenger and Instagram profile names with safe fallbacks", () => {
    expect(metaCustomerDisplayName("messenger", { first_name: "Ana", last_name: "Santos" })).toBe("Ana Santos");
    expect(metaCustomerDisplayName("instagram", { name: "Ana Santos", username: "ana" })).toBe("Ana Santos");
    expect(metaCustomerDisplayName("instagram", { username: "ana" })).toBe("@ana");
    expect(metaCustomerDisplayName("messenger", {})).toBeUndefined();
  });
});
