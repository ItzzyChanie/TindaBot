export const ATTACHMENT_BUCKET = "inbox-attachments";
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type MessageAttachment = {
  path: string;
  name: string;
  mimeType: string;
  size: number;
  signedUrl?: string;
};

export function isAllowedAttachmentType(value: string): boolean {
  return (ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(value);
}

export function validateAttachments(
  value: unknown,
  conversationId: string,
): MessageAttachment[] | null {
  if (!Array.isArray(value) || value.length > 1) return null;
  const attachments: MessageAttachment[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const item = candidate as Record<string, unknown>;
    if (
      typeof item.path !== "string" ||
      !item.path.startsWith(`conversations/${conversationId}/`) ||
      !/^conversations\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(item.path) ||
      typeof item.name !== "string" ||
      !item.name.trim() || item.name.length > 180 ||
      typeof item.mimeType !== "string" ||
      !isAllowedAttachmentType(item.mimeType) ||
      typeof item.size !== "number" ||
      !Number.isInteger(item.size) || item.size < 1 ||
      item.size > MAX_ATTACHMENT_BYTES
    ) return null;
    attachments.push({
      path: item.path,
      name: item.name.trim(),
      mimeType: item.mimeType,
      size: item.size,
    });
  }
  return attachments;
}
