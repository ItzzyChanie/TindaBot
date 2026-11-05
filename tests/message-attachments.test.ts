import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES, validateAttachments } from "../supabase/functions/_shared/message-attachments";

const conversationId = "11111111-1111-4111-8111-111111111111";
const validAttachment = {
  path: `conversations/${conversationId}/22222222-2222-4222-8222-222222222222`,
  name: "catalog.pdf",
  mimeType: "application/pdf",
  size: 1024,
};

describe("message attachments", () => {
  it("accepts one supported attachment scoped to its conversation", () => {
    expect(validateAttachments([validAttachment], conversationId)).toEqual([validAttachment]);
    expect(validateAttachments([], conversationId)).toEqual([]);
  });

  it("rejects attachments for another conversation and unsupported types", () => {
    expect(validateAttachments([validAttachment], "33333333-3333-4333-8333-333333333333")).toBeNull();
    expect(validateAttachments([{ ...validAttachment, mimeType: "application/x-msdownload" }], conversationId)).toBeNull();
  });

  it("rejects files over 25 MiB and multiple files in one message", () => {
    expect(validateAttachments([{ ...validAttachment, size: MAX_ATTACHMENT_BYTES + 1 }], conversationId)).toBeNull();
    expect(validateAttachments([validAttachment, validAttachment], conversationId)).toBeNull();
  });
});
