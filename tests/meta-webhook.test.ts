import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractMetaInboundMessages, verifyMetaSignature } from "../supabase/functions/_shared/meta-webhook-security";

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
      { channel: "messenger", accountId: "page-1", senderId: "customer-1", messageId: "m-1", text: "hello" },
    ]);
    expect(extractMetaInboundMessages({ object: "instagram", entry: [{ id: "ig-account", messaging: [{ sender: { id: "ig-customer" }, message: { mid: "ig-2", attachments: [{ type: "image" }] } }] }] })).toMatchObject([
      { channel: "instagram", senderId: "ig-customer", messageId: "ig-2", hasAttachments: true },
    ]);
  });
});
