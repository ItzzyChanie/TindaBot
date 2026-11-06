import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SHOP_ID = "00000000-0000-4000-8000-000000000001";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type DeliveryStatus = "sent" | "suppressed_quiet_hours" | "suppressed_prefs" | "rate_limited" | "failed";
type NotificationSettings = {
  bell_enabled: boolean;
  telegram_enabled: boolean;
  telegram_chat_id: string | null;
  preview_customer_text: boolean;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  timezone: string;
  event_prefs: Record<string, { bell?: boolean; telegram?: boolean }>;
  group_window_minutes: number;
};

export type SellerNotificationEvent = {
  type: "needs_seller" | "new_order" | "payment_proof" | "reply_failed" |
    "delivery_failed" | "window_closing" | "messenger_window" | "low_stock" | "out_of_stock" | string;
  conversationId?: string | null;
  orderId?: number | null;
  customerName?: string | null;
  channel?: string | null;
  productName?: string | null;
  size?: string | null;
  quantity?: number | null;
  amount?: number | null;
  reason?: string | null;
  customerText?: string | null;
  dedupeKey?: string;
};

export type NotifySellerResult = {
  ok: boolean;
  notificationId: string | null;
  isNew: boolean;
  bell: DeliveryStatus | "not_applicable";
  telegram: DeliveryStatus | "not_applicable";
  error?: string;
};

export type ScheduledNotificationResult = {
  ok: boolean;
  attempted: number;
  sent: number;
  suppressed: number;
  failed: number;
  summary: DeliveryStatus | "not_applicable";
  error?: string;
};

function clean(value: unknown, limit = 100): string {
  return String(value ?? "")
    .replace(/[\r\n\u0000-\u001f\u007f]/g, " ")
    .replace(/\b\+?\d[\d ().-]{7,}\d\b/g, "[redacted]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[redacted]")
    .replace(/\b(address|street|st\.?|barangay|brgy\.?|purok|block|blk\.?|lot|unit|apartment|apt\.?|zip code)\b\s*[:#-]?\s*[^,;]*/gi, "[address removed]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\s+/g, " ").trim().slice(0, limit);
}

function customerLabel(event: SellerNotificationEvent): string {
  const name = clean(event.customerName || "Customer", 50);
  const channel = clean(event.channel || "chat", 30);
  return `${name} (${channel})`;
}

function titleAndBody(event: SellerNotificationEvent, settings: NotificationSettings) {
  const customer = customerLabel(event);
  let title: string;
  let body: string;
  switch (event.type) {
    case "needs_seller":
      title = `Needs you: ${customer}`;
      body = "A customer needs a reply.";
      if (settings.preview_customer_text && event.customerText) {
        body += ` Message: ${clean(event.customerText, 80)}`;
      }
      break;
    case "new_order":
      title = `New order #${Number(event.orderId) || "?"}, ${clean(event.amount ?? "0", 24)} pesos`;
      body = "A new order was created.";
      break;
    case "payment_proof":
      title = `Payment proof received for order #${Number(event.orderId) || "?"}`;
      body = "Please review the payment proof.";
      break;
    case "reply_failed":
    case "delivery_failed":
      title = `Reply not delivered to ${clean(event.customerName || "customer", 50)}`;
      body = `Reason: ${clean(event.reason || "Delivery failed", 100)}`;
      break;
    case "messenger_window":
    case "window_closing":
      title = `Messenger window closes in 2 hours for ${clean(event.customerName || "customer", 50)}`;
      body = "Reply before the messaging window closes.";
      break;
    case "low_stock":
    case "out_of_stock": {
      const product = clean(event.productName || "Product", 60);
      const size = clean(event.size || "", 30);
      const left = Math.max(0, Number(event.quantity) || 0);
      title = event.type === "out_of_stock"
        ? `Out of stock: ${product}${size ? ` ${size}` : ""}`
        : `Low stock: ${product}${size ? ` ${size}` : ""} has ${left} left`;
      body = "Check the catalog stock.";
      break;
    }
    default:
      title = "Seller notification";
      body = "Please check the seller inbox.";
  }
  return { title: clean(title, 160), body: clean(body, 240) };
}

function notificationLink(event: SellerNotificationEvent): string | null {
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  if (!appUrl) return null;
  if (event.orderId) return `${appUrl}/orders?order=${encodeURIComponent(String(event.orderId))}`;
  if (event.conversationId) return `${appUrl}/inbox?conversation=${encodeURIComponent(event.conversationId)}`;
  return null;
}

function inQuietHours(settings: NotificationSettings, now = new Date()): boolean {
  if (!settings.quiet_hours_enabled) return false;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: settings.timezone || "Asia/Manila",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const current = Number(parts.find((part) => part.type === "hour")?.value) * 60 +
      Number(parts.find((part) => part.type === "minute")?.value);
    const [startHour, startMinute] = settings.quiet_start.split(":").map(Number);
    const [endHour, endMinute] = settings.quiet_end.split(":").map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    return start === end ? true : start < end ? current >= start && current < end : current >= start || current < end;
  } catch {
    return false;
  }
}

async function loadSettings(client: SupabaseClient): Promise<NotificationSettings> {
  const { data, error } = await client.from("notification_settings").select("*").eq("shop_id", SHOP_ID).single();
  if (error || !data) throw error ?? new Error("Notification settings are missing");
  return data as NotificationSettings;
}

async function recordDelivery(
  client: SupabaseClient,
  notificationId: string,
  channel: "bell" | "telegram",
  status: DeliveryStatus,
  errorReason: string | null = null,
): Promise<void> {
  const { error } = await client.from("notification_deliveries").insert({
    notification_id: notificationId, channel, status, error_reason: errorReason,
  });
  if (error) throw error;
}

async function telegramSend(chatId: string, text: string): Promise<{ ok: true } | { ok: false; reason: string; permanent: boolean }> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return { ok: false, reason: "Telegram is not configured", permanent: false };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const result = await response.json().catch(() => ({})) as { description?: string; error_code?: number };
    if (response.ok) return { ok: true };
    const description = clean(result.description || "Telegram rejected the alert", 120);
    const permanent = /blocked|chat not found|deactivated|can't initiate|cannot initiate|kicked/i.test(description);
    return { ok: false, reason: description, permanent };
  } catch {
    return { ok: false, reason: "Telegram connection failed", permanent: false };
  }
}

async function createPausedNotification(client: SupabaseClient, settings: NotificationSettings, reason: string) {
  await client.from("notification_settings").update({ telegram_enabled: false }).eq("shop_id", SHOP_ID);
  const { data, error } = await client.rpc("upsert_notification", {
    p_type: "telegram_paused", p_severity: "attention", p_title: "Telegram alerts paused",
    p_body: "Telegram could not deliver alerts. Reconnect Telegram in notification settings.",
    p_link: `${(Deno.env.get("APP_URL") ?? "").replace(/\/$/, "")}/settings/notifications`,
    p_conversation_id: null, p_order_id: null, p_dedupe_key: "telegram_paused",
    p_group_window_minutes: settings.group_window_minutes,
  });
  const notificationId = data?.[0]?.notification_id;
  if (!error && notificationId) {
    await recordDelivery(client, notificationId, "bell", "sent", null);
    console.warn("[notify] Telegram alerts paused", { reason });
  }
}

function safeError(error: unknown): string {
  return clean(error instanceof Error ? error.message : "Notification processing failed", 160);
}

/**
 * Best-effort seller alerts. This function is safe to call from the bot's main
 * flow: every error is captured in the result and never escapes to its caller.
 */
export async function notifySeller(
  event: SellerNotificationEvent,
  client: SupabaseClient = supabase,
): Promise<NotifySellerResult> {
  const result: NotifySellerResult = {
    ok: false, notificationId: null, isNew: false,
    bell: "not_applicable", telegram: "not_applicable",
  };
  try {
    const settings = await loadSettings(client);
    const preferences = settings.event_prefs?.[event.type] ?? { bell: true, telegram: true };
    const { title, body } = titleAndBody(event, settings);
    const link = notificationLink(event);
    if (!link) throw new Error("APP_URL or notification target is missing");
    const subject = event.conversationId ? `conversation:${event.conversationId}` : `order:${event.orderId ?? "none"}`;
    const dedupeKey = event.dedupeKey || `${event.type}:${subject}`;
    const { data, error } = await client.rpc("upsert_notification", {
      p_type: event.type,
      p_severity: event.type === "needs_seller" ? "urgent" : event.type === "low_stock" ? "info" : "attention",
      p_title: title, p_body: body, p_link: link,
      p_conversation_id: event.conversationId ?? null, p_order_id: event.orderId ?? null,
      p_dedupe_key: dedupeKey, p_group_window_minutes: settings.group_window_minutes,
    });
    if (error) throw error;
    result.notificationId = data?.[0]?.notification_id ?? null;
    result.isNew = data?.[0]?.is_new === true;
    if (!result.notificationId) throw new Error("Notification was not saved");

    result.bell = settings.bell_enabled && preferences.bell !== false ? "sent" : "suppressed_prefs";
    try {
      await recordDelivery(client, result.notificationId, "bell", result.bell,
        result.bell === "sent" ? null : settings.bell_enabled ? "Event bell preference is off" : "Bell notifications are disabled");
    } catch (error) {
      console.error("[notify] Could not record bell delivery", safeError(error));
    }

    if (!result.isNew) {
      result.telegram = "suppressed_prefs";
      try { await recordDelivery(client, result.notificationId, "telegram", result.telegram, "Grouped repeat events do not send Telegram alerts"); }
      catch (error) { console.error("[notify] Could not record Telegram delivery", safeError(error)); }
      result.ok = true;
      return result;
    }

    if (!settings.telegram_enabled || !settings.telegram_chat_id || preferences.telegram === false) {
      result.telegram = "suppressed_prefs";
      const reason = !settings.telegram_enabled ? "Telegram alerts are disabled" : !settings.telegram_chat_id ? "Telegram chat is not linked" : "Event Telegram preference is off";
      await recordDelivery(client, result.notificationId, "telegram", result.telegram, reason);
      result.ok = true;
      return result;
    }
    if (inQuietHours(settings)) {
      result.telegram = "suppressed_quiet_hours";
      await recordDelivery(client, result.notificationId, "telegram", result.telegram, "Quiet hours are active");
      result.ok = true;
      return result;
    }
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await client.from("notification_deliveries")
      .select("id", { count: "exact", head: true }).eq("channel", "telegram").eq("status", "sent")
      .gte("created_at", hourAgo);
    if (countError) throw countError;
    if ((count ?? 0) >= 20) {
      result.telegram = "rate_limited";
      await recordDelivery(client, result.notificationId, "telegram", result.telegram, "Hourly Telegram alert cap reached");
      result.ok = true;
      return result;
    }

    const telegramText = `${title}\n${body}\n${link}`;
    const delivery = await telegramSend(settings.telegram_chat_id, telegramText);
    if (delivery.ok) {
      result.telegram = "sent";
      await recordDelivery(client, result.notificationId, "telegram", "sent");
    } else {
      result.telegram = "failed";
      await recordDelivery(client, result.notificationId, "telegram", "failed", delivery.reason);
      if (delivery.permanent) await createPausedNotification(client, settings, delivery.reason);
    }
    result.ok = true;
    return result;
  } catch (error) {
    result.error = safeError(error);
    console.error("[notify] Seller notification failed", result.error);
    return result;
  }
}

/** Called by a scheduled Edge Function after quiet hours to send one digest. */
export async function sendQuietHoursSummary(client: SupabaseClient = supabase): Promise<NotifySellerResult> {
  const result: NotifySellerResult = {
    ok: false, notificationId: null, isNew: false,
    bell: "not_applicable", telegram: "not_applicable",
  };
  try {
    const settings = await loadSettings(client);
    if (!settings.telegram_enabled || !settings.telegram_chat_id || inQuietHours(settings)) {
      result.ok = true;
      result.telegram = "suppressed_prefs";
      return result;
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: suppressed, error } = await client.from("notification_deliveries")
      .select("notification_id, notifications!inner(id,type,title,group_count,created_at)")
      .eq("channel", "telegram").eq("status", "suppressed_quiet_hours").gte("created_at", since);
    if (error) throw error;
    const unique = new Map<string, { type: string; title: string; group_count: number }>();
    for (const row of suppressed ?? []) {
      const notification = Array.isArray(row.notifications) ? row.notifications[0] : row.notifications;
      if (notification) unique.set(row.notification_id, notification as { type: string; title: string; group_count: number });
    }
    const ids = [...unique.keys()];
    if (!ids.length) { result.ok = true; result.telegram = "suppressed_prefs"; return result; }
    const { data: alreadySent, error: sentError } = await client.from("notification_deliveries")
      .select("notification_id").eq("channel", "telegram").eq("status", "sent").in("notification_id", ids);
    if (sentError) throw sentError;
    const sentIds = new Set((alreadySent ?? []).map((row) => row.notification_id));
    const pending = [...unique.entries()].filter(([id]) => !sentIds.has(id));
    if (!pending.length) { result.ok = true; result.telegram = "suppressed_prefs"; return result; }
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await client.from("notification_deliveries")
      .select("id", { count: "exact", head: true }).eq("channel", "telegram").eq("status", "sent")
      .gte("created_at", hourAgo);
    if (countError) throw countError;
    if ((count ?? 0) >= 20) {
      result.telegram = "rate_limited";
      for (const [id] of pending) await recordDelivery(client, id, "telegram", "rate_limited", "Hourly Telegram alert cap reached");
      return result;
    }
    const needsYou = pending.filter(([, value]) => value.type === "needs_seller")
      .reduce((total, [, value]) => total + value.group_count, 0);
    const orders = pending.filter(([, value]) => value.type === "new_order")
      .reduce((total, [, value]) => total + value.group_count, 0);
    const lowStock = pending.filter(([, value]) => value.type === "low_stock").length;
    const windows = pending.filter(([, value]) => value.type === "window_closing").length;
    const otherAlerts = pending.filter(([, value]) => !["needs_seller", "new_order", "low_stock", "window_closing"].includes(value.type)).length;
    const parts = [`${needsYou} need you`, `${orders} new order${orders === 1 ? "" : "s"}`];
    if (lowStock) parts.push(`${lowStock} low-stock alert${lowStock === 1 ? "" : "s"}`);
    if (windows) parts.push(`${windows} Messenger window${windows === 1 ? "" : "s"}`);
    if (otherAlerts) parts.push(`${otherAlerts} other alert${otherAlerts === 1 ? "" : "s"}`);
    const summary = `While you were away: ${parts.join(", ")}. ${Deno.env.get("APP_URL")?.replace(/\/$/, "") ?? ""}/inbox`;
    const delivery = await telegramSend(settings.telegram_chat_id, summary);
    if (!delivery.ok) {
      result.telegram = "failed";
      for (const [id] of pending) await recordDelivery(client, id, "telegram", "failed", delivery.reason);
      if (delivery.permanent) await createPausedNotification(client, settings, delivery.reason);
      result.error = delivery.reason;
      return result;
    }
    for (const [id] of pending) await recordDelivery(client, id, "telegram", "sent");
    result.ok = true;
    result.telegram = "sent";
    result.notificationId = pending[0][0];
    return result;
  } catch (error) {
    result.error = safeError(error);
    console.error("[notify] Quiet-hours summary failed", result.error);
    return result;
  }
}

/** Delivers database-created low-stock and window-closing alerts from a scheduled Edge Function. */
export async function runScheduledNotifications(
  client: SupabaseClient = supabase,
): Promise<ScheduledNotificationResult> {
  const result: ScheduledNotificationResult = {
    ok: false, attempted: 0, sent: 0, suppressed: 0, failed: 0, summary: "not_applicable",
  };
  try {
    const settings = await loadSettings(client);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: notifications, error } = await client.from("notifications")
      .select("id, type, title, body, link, conversation_id, order_id, resolved_at, created_at")
      .in("type", ["low_stock", "window_closing"])
      .is("resolved_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw error;

    for (const notification of notifications ?? []) {
      const { data: previous, error: previousError } = await client.from("notification_deliveries")
        .select("status").eq("notification_id", notification.id).eq("channel", "telegram")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (previousError) throw previousError;
      if (previous && previous.status !== "rate_limited") continue;

      result.attempted += 1;
      const preferences = settings.event_prefs?.[notification.type] ?? { telegram: true };
      let status: DeliveryStatus;
      let reason: string | null = null;
      if (!settings.telegram_enabled || !settings.telegram_chat_id || preferences.telegram === false) {
        status = "suppressed_prefs";
        reason = !settings.telegram_enabled ? "Telegram alerts are disabled" : !settings.telegram_chat_id ? "Telegram chat is not linked" : "Event Telegram preference is off";
      } else if (inQuietHours(settings) || (settings.quiet_hours_enabled && inQuietHours(settings, new Date(notification.created_at)))) {
        status = "suppressed_quiet_hours";
        reason = "Quiet hours are active";
      } else if (!Deno.env.get("APP_URL")) {
        status = "failed";
        reason = "APP_URL is not configured";
      } else {
        const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count, error: countError } = await client.from("notification_deliveries")
          .select("id", { count: "exact", head: true }).eq("channel", "telegram").eq("status", "sent")
          .gte("created_at", hourAgo);
        if (countError) throw countError;
        if ((count ?? 0) >= 20) {
          status = "rate_limited";
          reason = "Hourly Telegram alert cap reached";
        } else {
          const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
          const link = typeof notification.link === "string" && notification.link.startsWith("/")
            ? `${appUrl}${notification.link}`
            : notification.link;
          const delivery = await telegramSend(settings.telegram_chat_id, `${clean(notification.title, 160)}\n${clean(notification.body, 240)}${link ? `\n${link}` : ""}`);
          status = delivery.ok ? "sent" : "failed";
          reason = delivery.ok ? null : delivery.reason;
          if (!delivery.ok && delivery.permanent) {
            await createPausedNotification(client, settings, delivery.reason);
            settings.telegram_enabled = false;
          }
        }
      }
      try {
        await recordDelivery(client, notification.id, "telegram", status, reason);
      } catch (deliveryError) {
        console.error("[notify] Could not record scheduled Telegram delivery", safeError(deliveryError));
        result.failed += 1;
        continue;
      }
      if (status === "sent") result.sent += 1;
      else if (status === "failed") result.failed += 1;
      else result.suppressed += 1;
    }

    const summary = await sendQuietHoursSummary(client);
    result.summary = summary.telegram;
    result.ok = summary.ok && result.failed === 0;
    if (!summary.ok) result.error = summary.error;
    return result;
  } catch (error) {
    result.error = safeError(error);
    console.error("[notify] Scheduled notification check failed", result.error);
    return result;
  }
}
