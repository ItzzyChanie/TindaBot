"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchChannelStatus, type ChannelStatus } from "@/lib/channel-status";
import { ATTACHMENT_BUCKET, MAX_ATTACHMENT_BYTES, isAllowedAttachmentType, type MessageAttachment } from "@/supabase/functions/_shared/message-attachments";

type Customer = { id: string; channel: string; external_id: string; name: string | null };
type MissedRequest = { id: string; request_text: string; created_at: string };
type Conversation = {
  id: string;
  customer_id: string;
  status: "open" | "needs_seller" | "resolved";
  ai_mode: "auto" | "suggest" | "human";
  pending: { ai_draft?: string; [key: string]: unknown };
  last_message_at: string;
  last_customer_message_at: string | null;
  seller_read_at: string | null;
  is_hidden: boolean;
  created_at: string;
  customers: Customer | null;
};
type Message = {
  id: string;
  conversation_id: string;
  sender: "customer" | "ai" | "seller" | "system";
  body: string;
  image_urls?: string[];
  attachments?: MessageAttachment[];
  channel_message_ids?: string[];
  external_message_id?: string | null;
  reply_to_message_id?: string | null;
  reply_to_text?: string | null;
  edited_at?: string | null;
  unsent_at?: string | null;
  delivery_status?: "pending" | "sent" | "failed";
  failure_reason?: string | null;
  created_at: string;
  pending?: boolean;
};
type CustomerOrder = {
  id: number;
  customer_id: string;
  total: number;
  status: "awaiting_payment" | "paid" | "shipped";
  payment_proof: unknown[];
  created_at: string;
  order_items: {
    qty: number;
    unit_price: number;
    variants: { size: string; products: { name: string } | null } | null;
  }[];
};

const CONVERSATIONS_PER_PAGE = 30;
const MESSAGES_PER_PAGE = 100;

async function hydrateAttachments(rows: Message[]): Promise<Message[]> {
  const supabase = createSupabaseBrowserClient();
  const paths = rows.flatMap((message) => message.attachments ?? []).map((attachment) => attachment.path);
  if (!paths.length) return rows;
  const { data } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrls(paths, 60 * 60 * 24 * 90);
  const signedByPath = new Map<string, string>(
    ((data ?? []) as { path: string; signedUrl: string | null }[])
      .flatMap((item) => item.signedUrl ? [[item.path, item.signedUrl] as [string, string]] : []),
  );
  return rows.map((message) => ({
    ...message,
    attachments: (message.attachments ?? []).map((attachment) => ({
      ...attachment,
      signedUrl: signedByPath.get(attachment.path),
    })),
  }));
}

function customerDisplayName(customer: Customer | null | undefined) {
  if (customer?.name?.trim()) return customer.name.trim();
  if (customer?.channel === "instagram" || customer?.channel === "instagram_simulated") return "Instagram customer";
  if (customer?.channel === "messenger" || customer?.channel === "messenger_simulated") return "Messenger customer";
  if (customer?.channel === "telegram") return "Telegram customer";
  return "Web chat visitor";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date(value));
}

function manilaDateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).format(value);
}

function formatConversationTime(value: string) {
  const date = new Date(value);
  const time = new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  }).format(date);
  const today = new Date();
  if (manilaDateKey(date) === manilaDateKey(today)) return time;
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (manilaDateKey(date) === manilaDateKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(date);
}

function isSimulatedChannel(channel?: string) {
  return channel === "messenger_simulated" || channel === "instagram_simulated";
}

function channelLabel(channel: string | null | undefined) {
  if (channel === "web") return "Web chat";
  if (channel === "messenger") return "Messenger";
  if (channel === "instagram") return "Instagram";
  if (channel === "messenger_simulated") return "Messenger (Coming soon)";
  if (channel === "instagram_simulated") return "Instagram (Coming soon)";
  return channel ?? "Unknown channel";
}

function isMetaChannel(channel?: string | null) {
  return channel === "messenger" || channel === "instagram";
}

function isWithinReplyWindow(value: string | null | undefined, now: number) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && now - timestamp <= 24 * 60 * 60 * 1000;
}

export function InboxWorkspace() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [missedRequests, setMissedRequests] = useState<MissedRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [channelStatus, setChannelStatus] = useState<ChannelStatus | null>(null);
  const [channelStatusError, setChannelStatusError] = useState(false);
  const [now, setNow] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [needsSellerOnly, setNeedsSellerOnly] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [conversationPage, setConversationPage] = useState(0);
  const [conversationCount, setConversationCount] = useState(0);
  const [previews, setPreviews] = useState<Map<string, Message>>(new Map());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const selectedConversationRef = useRef<string | null>(null);
  const selectedCustomerRef = useRef<string | null>(null);
  const threadMessagesRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const preserveScrollHeightRef = useRef<number | null>(null);

  const refreshConversationList = useCallback(async () => {
    const { data, error: queryError, count } = await createSupabaseBrowserClient()
      .from("conversations")
      .select(
        "id, customer_id, status, ai_mode, pending, last_message_at, last_customer_message_at, seller_read_at, is_hidden, created_at, customers(id, channel, external_id, name)",
        { count: "exact" },
      )
      .eq("is_hidden", showHidden)
      .order("last_message_at", { ascending: false })
      .range(conversationPage * CONVERSATIONS_PER_PAGE, (conversationPage + 1) * CONVERSATIONS_PER_PAGE - 1);
    if (queryError) {
      setLiveError("Reconnecting... showing updates every 10 seconds.");
      return;
    }
    const rows = (data ?? []) as unknown as Conversation[];
    setConversationCount(count ?? rows.length);
    const { data: previewRows } = await createSupabaseBrowserClient()
      .rpc("get_inbox_previews", { p_conversation_ids: rows.map((row) => row.id) });
    setPreviews(new Map(((previewRows ?? []) as { conversation_id: string; body: string; sender: Message["sender"]; created_at: string }[])
      .map((row) => [row.conversation_id, { ...row, id: "preview-" + row.conversation_id, conversation_id: row.conversation_id, image_urls: [] }])));
    setConversations(rows);
    setSelectedSnapshot((current) => rows.find((row) => row.id === current?.id) ?? current);
  }, [conversationPage, showHidden]);

  const refreshOrders = useCallback(async () => {
    const customerId = selectedCustomerRef.current;
    if (!customerId) {
      setOrders([]);
      return;
    }
    const { data, error: queryError } = await createSupabaseBrowserClient()
      .from("orders")
      .select(
        "id, customer_id, total, status, payment_proof, created_at, order_items(qty, unit_price, variants(size, products(name)))",
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (!queryError) setOrders((data ?? []) as unknown as CustomerOrder[]);
  }, []);

  const refreshSelectedMessages = useCallback(async () => {
    const conversationId = selectedConversationRef.current;
    if (!conversationId) return;
    const { data, error: queryError } = await createSupabaseBrowserClient()
      .from("messages")
      .select("id, conversation_id, sender, body, image_urls, attachments, channel_message_ids, external_message_id, reply_to_message_id, reply_to_text, edited_at, unsent_at, created_at, delivery_status, failure_reason")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(MESSAGES_PER_PAGE);
    if (queryError || !data || selectedConversationRef.current !== conversationId) return;
    const latestMessages = await hydrateAttachments((data as Message[]).reverse());
    setMessages((current) => {
      const older = current.filter((message) => !latestMessages.some((next) =>
        next.id === message.id || (message.pending && next.sender === message.sender && next.body === message.body),
      ));
      return [...older, ...latestMessages].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }, []);

  const loadInbox = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error: conversationError, count } = await supabase
          .from("conversations")
          .select(
            "id, customer_id, status, ai_mode, pending, last_message_at, last_customer_message_at, seller_read_at, is_hidden, created_at, customers(id, channel, external_id, name)",
            { count: "exact" },
          )
          .eq("is_hidden", showHidden)
          .order("last_message_at", { ascending: false })
          .range(conversationPage * CONVERSATIONS_PER_PAGE, (conversationPage + 1) * CONVERSATIONS_PER_PAGE - 1);
        if (conversationError) throw conversationError;

        const rows = (data ?? []) as unknown as Conversation[];
        const { data: previewRows, error: previewError } = await supabase
          .rpc("get_inbox_previews", { p_conversation_ids: rows.map((row) => row.id) });
        if (previewError) throw previewError;
        const nextPreviews = new Map(((previewRows ?? []) as { conversation_id: string; body: string; sender: Message["sender"]; created_at: string }[])
          .map((row) => [row.conversation_id, { ...row, id: "preview-" + row.conversation_id, conversation_id: row.conversation_id, image_urls: [] }]));

        setConversations(rows);
        setConversationCount(count ?? rows.length);
        setPreviews(nextPreviews);
        const isNarrow = window.matchMedia("(max-width: 700px)").matches;
        const currentId = selectedConversationRef.current;
        const nextId = currentId ?? (isNarrow ? null : (rows[0]?.id ?? null));
        setSelectedId(nextId);
        setSelectedSnapshot(rows.find((row) => row.id === nextId) ?? null);
        setError("");
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Hindi ma-load ang inbox. Pakisubukan ulit po.",
        );
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [conversationPage, showHidden],
  );

  useEffect(() => {
    void loadInbox(true);
  }, [loadInbox]);

  useEffect(() => {
    const refreshVisibleInbox = () => {
      if (document.visibilityState !== "visible") return;
      void loadInbox(false);
      void refreshSelectedMessages();
    };
    const timer = window.setInterval(refreshVisibleInbox, 10_000);
    window.addEventListener("focus", refreshVisibleInbox);
    document.addEventListener("visibilitychange", refreshVisibleInbox);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisibleInbox);
      document.removeEventListener("visibilitychange", refreshVisibleInbox);
    };
  }, [loadInbox, refreshSelectedMessages]);

  useEffect(() => {
    void fetchChannelStatus().then(setChannelStatus).catch(() => setChannelStatusError(true));
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!mobileDetailsOpen && !profileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileDetailsOpen(false);
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileDetailsOpen, profileMenuOpen]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("seller-inbox-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => void refreshConversationList(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        (payload: {
          eventType: "INSERT" | "UPDATE" | "DELETE";
          new: Record<string, unknown>;
          old: Record<string, unknown>;
        }) => {
          const record = (
            payload.eventType === "DELETE" ? payload.old : payload.new
          ) as Record<string, unknown>;
          const messageId = typeof record.id === "string" ? record.id : null;
          const conversationId = typeof record.conversation_id === "string" ? record.conversation_id : null;
          if (payload.eventType === "DELETE") {
            if (messageId)
              setMessages((current) =>
                current.filter((message) => message.id !== messageId),
              );
            return;
          }
          if (!messageId || !conversationId) return;
          if (conversationId !== selectedConversationRef.current || typeof record.body !== "string") return;
          const message = record as unknown as Message;
          void hydrateAttachments([message]).then(([hydrated]) => {
            setMessages((current) => [
              ...current.filter((item) => item.id !== message.id && !(item.pending && item.sender === message.sender && item.body === message.body)), hydrated,
            ].sort((a, b) => a.created_at.localeCompare(b.created_at)));
            setPreviews((current) => new Map(current).set(conversationId, hydrated));
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => void refreshOrders(),
      )
      .subscribe((status: string) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          setLiveError("Reconnecting... showing updates every 10 seconds.");
        if (status === "SUBSCRIBED") {
          setLiveError("");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadInbox, refreshConversationList, refreshOrders]);

  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ??
    (selectedSnapshot?.id === selectedId ? selectedSnapshot : null);
  const selectedCustomerId = selected?.customer_id ?? null;

  selectedConversationRef.current = selectedId;
  selectedCustomerRef.current = selectedCustomerId;

  useLayoutEffect(() => {
    followLatestRef.current = true;
    preserveScrollHeightRef.current = null;
    const container = threadMessagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [selectedId]);

  useLayoutEffect(() => {
    const container = threadMessagesRef.current;
    if (!container) return;
    const previousHeight = preserveScrollHeightRef.current;
    if (previousHeight !== null) {
      container.scrollTop += container.scrollHeight - previousHeight;
      preserveScrollHeightRef.current = null;
      return;
    }
    if (followLatestRef.current) container.scrollTop = container.scrollHeight;
  }, [messages]);

  useEffect(() => {
    setMessages([]);
    setReplyTarget(null);
    setEditingMessageId(null);
    setOpenMessageMenuId(null);
    setOrders([]);
    setMissedRequests([]);
    setHasOlderMessages(false);
    if (!selectedId || !selectedCustomerId) return;
    let active = true;
    setLoadingOlder(false);
    setNameDraft(selected?.customers?.name ?? "");
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      const [messageResult, orderResult, missedResult] = await Promise.all([
        supabase.from("messages")
          .select("id, conversation_id, sender, body, image_urls, attachments, channel_message_ids, external_message_id, reply_to_message_id, reply_to_text, edited_at, unsent_at, created_at, delivery_status, failure_reason")
          .eq("conversation_id", selectedId)
          .order("created_at", { ascending: false })
          .limit(MESSAGES_PER_PAGE),
        supabase.from("orders")
          .select("id, customer_id, total, status, payment_proof, created_at, order_items(qty, unit_price, variants(size, products(name)))")
          .eq("customer_id", selectedCustomerId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("missed_requests")
          .select("id, request_text, created_at")
          .eq("conversation_id", selectedId)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      if (!active) return;
      if (messageResult.error || orderResult.error || missedResult.error) {
        setError(messageResult.error?.message ?? orderResult.error?.message ?? missedResult.error?.message ?? "Could not load this conversation.");
        return;
      }
      const loadedMessages = await hydrateAttachments(((messageResult.data ?? []) as Message[]).reverse());
      setMessages(loadedMessages);
      setHasOlderMessages(loadedMessages.length === MESSAGES_PER_PAGE);
      setOrders((orderResult.data ?? []) as unknown as CustomerOrder[]);
      setMissedRequests((missedResult.data ?? []) as MissedRequest[]);
      const latest = loadedMessages.at(-1);
      if (latest) setPreviews((current) => new Map(current).set(selectedId, latest));
    })();
    return () => { active = false; };
  }, [selectedId, selectedCustomerId, selected?.customers?.name]);

  async function loadOlderMessages() {
    const oldest = messages[0];
    if (!selectedId || !oldest || loadingOlder || !hasOlderMessages) return;
    setLoadingOlder(true);
    const { data, error: olderError } = await createSupabaseBrowserClient()
      .from("messages")
      .select("id, conversation_id, sender, body, image_urls, attachments, channel_message_ids, external_message_id, reply_to_message_id, reply_to_text, edited_at, unsent_at, created_at, delivery_status, failure_reason")
      .eq("conversation_id", selectedId)
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(MESSAGES_PER_PAGE);
    if (olderError) setError(olderError.message);
    else {
      const older = await hydrateAttachments(((data ?? []) as Message[]).reverse());
      if (older.length && threadMessagesRef.current) {
        preserveScrollHeightRef.current = threadMessagesRef.current.scrollHeight;
        followLatestRef.current = false;
      }
      setMessages((current) => [...older, ...current]);
      setHasOlderMessages(older.length === MESSAGES_PER_PAGE);
    }
    setLoadingOlder(false);
  }

  useEffect(() => {
    if (
      !selected ||
      selected.status !== "needs_seller" ||
      selected.seller_read_at
    )
      return;
    const readAt = new Date().toISOString();
    void (async () => {
      const { error: readError } = await createSupabaseBrowserClient()
        .from("conversations")
        .update({ seller_read_at: readAt })
        .eq("id", selected.id);
      if (readError)
        setError("Hindi ma-update ang unread status: " + readError.message);
      else
        setConversations((current) =>
          current.map((item) =>
            item.id === selected.id
              ? { ...item, seller_read_at: readAt }
              : item,
          ),
        );
    })();
  }, [selected]);
  const threadMessages = messages;
  const lastMessages = previews;
  const visibleConversations = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return conversations.filter((conversation) => {
      if (needsSellerOnly && conversation.status !== "needs_seller") return false;
      if (!normalized) return true;
      const latest = lastMessages.get(conversation.id)?.body ?? "";
      const customer = conversation.customers;
      return `${customer?.name ?? ""} ${customer?.external_id ?? ""} ${latest}`
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [conversations, lastMessages, needsSellerOnly, search]);

  async function changeMode(mode: Conversation["ai_mode"]) {
    if (!selected) return;
    setSavingMode(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase
        .from("conversations")
        .update({ ai_mode: mode })
        .eq("id", selected.id);
      if (updateError) throw updateError;
      setConversations((current) =>
        current.map((item) =>
          item.id === selected.id ? { ...item, ai_mode: mode } : item,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Hindi na-save ang mode. Pakisubukan ulit po.",
      );
    } finally {
      setSavingMode(false);
    }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selected ||
      isSimulatedChannel(selected.customers?.channel) ||
      replyDisabled ||
      (!draft.trim() && !attachment) ||
      sending
    )
      return;
    const text = draft.trim();
    if (text.length > 4000) {
      setError("Hanggang 4,000 characters lang po bawat reply.");
      return;
    }
    if (editingMessageId) {
      setSending(true);
      setError("");
      try {
        const { error: editError } = await createSupabaseBrowserClient().functions.invoke("seller-reply", {
          body: { conversationId: selected.id, action: "edit", messageId: editingMessageId, text },
        });
        if (editError) throw editError;
        setEditingMessageId(null);
        setDraft("");
        await refreshSelectedMessages();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not edit this message.");
      } finally {
        setSending(false);
      }
      return;
    }
    if (attachment && (attachment.size > MAX_ATTACHMENT_BYTES || !isAllowedAttachmentType(attachment.type))) {
      setError("Pumili po ng supported image o document na hanggang 25 MB.");
      return;
    }

    setSending(true);
    setError("");
    const pendingId = `pending-${crypto.randomUUID()}`;
    setMessages((current) => [...current, {
      id: pendingId,
      conversation_id: selected.id,
      sender: "seller",
      body: text,
      created_at: new Date().toISOString(),
      pending: true,
    }]);
    let uploadedAttachment: MessageAttachment | undefined;
    try {
      const supabase = createSupabaseBrowserClient();
      if (attachment) {
        const path = `conversations/${selected.id}/${crypto.randomUUID()}`;
        const { error: uploadError } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .upload(path, attachment, { contentType: attachment.type, upsert: false });
        if (uploadError) throw uploadError;
        uploadedAttachment = {
          path,
          name: attachment.name,
          mimeType: attachment.type,
          size: attachment.size,
        };
      }
      const { error: replyError } = await supabase.functions.invoke(
        "seller-reply",
        {
          body: {
            conversationId: selected.id,
            text,
            attachments: uploadedAttachment ? [uploadedAttachment] : [],
            replyToMessageId: replyTarget?.id ?? null,
          },
        },
      );
      if (replyError) throw replyError;
      setDraft("");
      setAttachment(null);
      setReplyTarget(null);
      await refreshSelectedMessages();
    } catch (cause) {
      setMessages((current) => current.filter((message) => message.id !== pendingId));
      await refreshSelectedMessages();
      if (uploadedAttachment) {
        const { data: saved } = await createSupabaseBrowserClient().from("messages")
          .select("id")
          .eq("conversation_id", selected.id)
          .contains("attachments", [{ path: uploadedAttachment.path }])
          .limit(1);
        if (saved?.length) {
          setDraft("");
          setAttachment(null);
        } else {
          await createSupabaseBrowserClient().storage.from(ATTACHMENT_BUCKET).remove([uploadedAttachment.path]);
        }
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Hindi naipadala ang reply. Pakisubukan ulit po.",
      );
    } finally {
      setSending(false);
    }
  }

  function startReply(message: Message) {
    setOpenMessageMenuId(null);
    setEditingMessageId(null);
    setDraft("");
    setAttachment(null);
    setReplyTarget(message);
    window.requestAnimationFrame(() => document.getElementById("seller-reply")?.focus());
  }

  function startEdit(message: Message) {
    setOpenMessageMenuId(null);
    setReplyTarget(null);
    setAttachment(null);
    setEditingMessageId(message.id);
    setDraft(message.body);
    window.requestAnimationFrame(() => document.getElementById("seller-reply")?.focus());
  }

  async function unsendMessage(message: Message) {
    if (!selected || sending) return;
    setSending(true);
    setOpenMessageMenuId(null);
    setError("");
    const { error: unsendError } = await createSupabaseBrowserClient().functions.invoke("seller-reply", {
      body: { conversationId: selected.id, action: "unsend", messageId: message.id },
    });
    if (unsendError) setError(unsendError.message || "Could not unsend this message.");
    else await refreshSelectedMessages();
    setSending(false);
  }

  async function sendDraft() {
    if (
      !selected?.pending.ai_draft ||
      isSimulatedChannel(selected.customers?.channel) ||
      replyDisabled ||
      sending
    )
      return;
    setSending(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: replyError } = await supabase.functions.invoke(
        "seller-reply",
        {
          body: {
            conversationId: selected.id,
            text: selected.pending.ai_draft,
            sendDraft: true,
          },
        },
      );
      if (replyError) throw replyError;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Hindi naipadala ang draft po.",
      );
    } finally {
      setSending(false);
    }
  }

  async function retryDelivery(message: Message) {
    if (!selected || retryingMessageId) return;
    setRetryingMessageId(message.id);
    setError("");
    const { error: retryError } = await createSupabaseBrowserClient().functions.invoke("seller-reply", {
      body: { conversationId: selected.id, retryMessageId: message.id },
    });
    if (retryError) setError("Hindi naipadala ulit ang reply. Pakitingnan ang reason sa message at ayusin ang channel setup kung kailangan.");
    else await refreshSelectedMessages();
    setRetryingMessageId(null);
  }

  async function discardDraft() {
    if (!selected?.pending.ai_draft) return;
    const pending = { ...selected.pending };
    delete pending.ai_draft;
    const { error: updateError } = await createSupabaseBrowserClient()
      .from("conversations")
      .update({ pending })
      .eq("id", selected.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setConversations((current) =>
      current.map((item) =>
        item.id === selected.id ? { ...item, pending } : item,
      ),
    );
  }

  async function markResolved() {
    if (!selected) return;
    const { error: updateError } = await createSupabaseBrowserClient()
      .from("conversations")
      .update({ status: "resolved", pending: {} })
      .eq("id", selected.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setConversations((current) =>
      current.map((item) =>
        item.id === selected.id
          ? { ...item, status: "resolved", pending: {} }
          : item,
      ),
    );
  }

  async function saveCustomerName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer || savingName) return;
    setSavingName(true);
    setError("");
    const name = nameDraft.trim().slice(0, 80) || null;
    const { error: updateError } = await createSupabaseBrowserClient()
      .from("customers")
      .update({ name })
      .eq("id", customer.id);
    if (updateError) {
      setError("Could not save customer name. Please try again.");
      setSavingName(false);
      return;
    }
    const updateName = (conversation: Conversation) => conversation.customer_id === customer.id
      ? { ...conversation, customers: conversation.customers ? { ...conversation.customers, name } : null }
      : conversation;
    setConversations((current) => current.map(updateName));
    setSelectedSnapshot((current) => current ? updateName(current) : null);
    setSavingName(false);
  }

  async function setHidden(hidden: boolean) {
    if (!selected) return;
    const { error: updateError } = await createSupabaseBrowserClient()
      .from("conversations")
      .update({ is_hidden: hidden })
      .eq("id", selected.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMobileDetailsOpen(false);
    setSelectedId(null);
    await refreshConversationList();
  }

  async function copyProfileValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setError(`${label} copied.`);
    } catch {
      setError(`Could not copy the ${label.toLowerCase()}.`);
    }
    setProfileMenuOpen(false);
  }

  async function deleteConversation() {
    if (
      !selected ||
      !window.confirm("Permanently delete this conversation and its messages?")
    )
      return;
    const { error: deleteError } = await createSupabaseBrowserClient()
      .from("conversations")
      .delete()
      .eq("id", selected.id);
    if (deleteError) {
      setError(
        "Hindi mabura ang conversation. Kung may order ito, itago na lang po: " +
          deleteError.message,
      );
      return;
    }
    setMobileDetailsOpen(false);
    setSelectedId(null);
    await refreshConversationList();
  }

  const customer = selected?.customers;
  const selectedChannel = customer?.channel;
  const selectedIsMeta = isMetaChannel(selectedChannel);
  const selectedMetaConfigured = selectedChannel === "messenger"
    ? channelStatus?.messenger === true
    : selectedChannel === "instagram"
      ? channelStatus?.instagram === true
      : true;
  const replyWindowOpen = !selectedIsMeta || isWithinReplyWindow(selected?.last_customer_message_at, now);
  const replyUnavailable = selectedIsMeta && (!selectedMetaConfigured || !replyWindowOpen || channelStatusError);
  const replyDisabled = isSimulatedChannel(selectedChannel) || replyUnavailable;
  const customerOrders = selected
    ? orders.filter((order) => order.customer_id === selected.customer_id)
    : [];

  return (
    <div className={`inbox-page${selectedId ? " has-selection" : ""}${mobileDetailsOpen ? " show-mobile-details" : ""}`}>
      <aside className="inbox-list-panel">
        <div className="inbox-list-heading">
          <div className="inbox-page-title">
            <p className="eyebrow">CUSTOMER SUPPORT</p>
            <h1>Inbox</h1>
            <p>Keep customer conversations moving.</p>
          </div>
          <span className="inbox-total">
            <strong>{conversationCount}</strong>
            <small>threads</small>
          </span>
        </div>
        {liveError && <p className="inbox-alert" role="status">{liveError}</p>}
        <div className="inbox-toolbar">
          <span className="inbox-filter-label">
            {showHidden ? "Hidden conversations" : needsSellerOnly ? "Needs seller" : "All conversations"}
          </span>
          {!showHidden && <button className="inbox-filter-button" onClick={() => setNeedsSellerOnly((value) => !value)}>
            {needsSellerOnly ? "Show all" : "Needs seller only"}
          </button>}
          <button
            className="inbox-filter-button"
            onClick={() => {
              setConversationPage(0);
              setSelectedSnapshot(null);
              setSelectedId(null);
              setShowHidden((value) => !value);
            }}
          >
            {showHidden ? "Show active" : "View hidden"}
          </button>
        </div>
        <label className="inbox-search">
          <span className="sr-only">Search conversations</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search this page"
          />
        </label>
        {loading ? (
          <p className="inbox-state">Loading conversations…</p>
        ) : error && conversations.length === 0 ? (
          <div className="inbox-state error-state">
            <p>{error}</p>
            <button
              className="text-button"
              onClick={() => void loadInbox(true)}
            >
              Try again
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <p className="inbox-state">Wala pang conversations po.</p>
        ) : visibleConversations.length === 0 ? (
          <p className="inbox-state">No conversations match your search.</p>
        ) : (
          <div className="conversation-list">
            {visibleConversations.map((conversation) => {
              const latest = lastMessages.get(conversation.id);
              const contact = conversation.customers;
              return (
                <button
                  key={conversation.id}
                  className={`conversation-card${selectedId === conversation.id ? " selected" : ""}${conversation.status === "needs_seller" && !conversation.seller_read_at ? " unread" : ""}`}
                  onClick={() => {
                    setMobileDetailsOpen(false);
                    setSelectedSnapshot(conversation);
                    setSelectedId(conversation.id);
                  }}
                >
                  <span className="conversation-avatar">
                    {customerDisplayName(contact)
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <span className="conversation-main">
                    <span className="conversation-title">
                      <strong>
                        {customerDisplayName(contact) ||
                          conversation.customer_id}
                      </strong>
                      {conversation.status === "needs_seller" && (
                        <span className="needs-badge">Needs you</span>
                      )}
                    </span>
                    <span className="conversation-preview">
                      {latest?.body ?? "No messages yet"}
                    </span>
                    <span className="channel-badge">
                      {channelLabel(contact?.channel)}
                    </span>
                  </span>
                  <time className="conversation-time" dateTime={conversation.last_message_at} title={formatTime(conversation.last_message_at)}>
                    {formatConversationTime(conversation.last_message_at)}
                  </time>
                </button>
              );
            })}
          </div>
        )}
        {conversationCount > CONVERSATIONS_PER_PAGE && (
          <nav className="inbox-pagination" aria-label="Conversation pages">
            <button className="text-button" disabled={conversationPage === 0 || loading} onClick={() => { setSelectedSnapshot(null); setSelectedId(null); setConversationPage((page) => Math.max(0, page - 1)); }}>Previous</button>
            <span>Page {conversationPage + 1} of {Math.ceil(conversationCount / CONVERSATIONS_PER_PAGE)}</span>
            <button className="text-button" disabled={(conversationPage + 1) * CONVERSATIONS_PER_PAGE >= conversationCount || loading} onClick={() => { setSelectedSnapshot(null); setSelectedId(null); setConversationPage((page) => page + 1); }}>Next</button>
          </nav>
        )}
      </aside>

      <section className="inbox-thread-panel" aria-label="Conversation thread">
        {selected ? (
          <>
            <header className="thread-header">
              <button
                className="back-to-inbox"
                onClick={() => { setMobileDetailsOpen(false); setSelectedId(null); }}
                aria-label="Back to conversation list"
              >
                ←
              </button>
              <span className="conversation-avatar">
                {customerDisplayName(customer)
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <div className="thread-contact">
                <strong>{customerDisplayName(customer)}</strong>
                <span>{channelLabel(customer?.channel)}</span>
              </div>
              <div className="thread-header-actions">
                {selected.status === "needs_seller" && (
                  <span className="needs-badge thread-needs">Needs you</span>
                )}
                {selected.status === "needs_seller" && (
                  <button
                    className="text-button mobile-action-button"
                    aria-label="Mark conversation handled"
                    title="Mark conversation handled"
                    onClick={() => void markResolved()}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
                    <span className="mobile-action-label">Mark handled</span>
                  </button>
                )}
                <button
                  className="text-button mobile-action-button"
                  aria-label={selected.is_hidden ? "Unhide conversation" : "Hide conversation"}
                  title={selected.is_hidden ? "Unhide conversation" : "Hide conversation"}
                  onClick={() => void setHidden(!selected.is_hidden)}
                >
                  {selected.is_hidden ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A11 11 0 0 1 12 5c5 0 9 5 9 7a9 9 0 0 1-2.1 3.2M6.2 6.2C3.9 7.7 3 10 3 12c0 2 4 7 9 7a10 10 0 0 0 3.2-.5" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="2.5" /></svg>
                  )}
                  <span className="mobile-action-label">{selected.is_hidden ? "Unhide" : "Hide"}</span>
                </button>
                <button
                  className="text-button mobile-action-button"
                  aria-label="Delete conversation"
                  title="Delete conversation"
                  onClick={() => void deleteConversation()}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                  <span className="mobile-action-label">Delete</span>
                </button>
                <button
                  className="text-button mobile-details-toggle"
                  type="button"
                  aria-label="Show customer details"
                  aria-expanded={mobileDetailsOpen}
                  title="Show customer details"
                  onClick={() => setMobileDetailsOpen(true)}
                >
                  ⋯
                </button>
              </div>
            </header>
            {error && (
              <p className="inbox-alert error-state" role="alert">
                {error}
              </p>
            )}
            {hasOlderMessages && (
              <button className="text-button load-older-messages" onClick={() => void loadOlderMessages()} disabled={loadingOlder}>
                {loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}
              </button>
            )}
            <div
              className="thread-messages"
              aria-live="polite"
              ref={threadMessagesRef}
              onScroll={(event) => {
                const container = event.currentTarget;
                followLatestRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
              }}
            >
              {threadMessages.length === 0 ? (
                <p className="thread-empty">Wala pang messages po.</p>
              ) : (
                threadMessages.map((message) => (
                  <article
                    key={message.id}
                    className={`message-row ${message.sender}`}
                  >
                    <div className="message-bubble">
                      <span className="message-sender">
                        {message.sender === "customer"
                          ? customerDisplayName(customer)
                          : message.sender === "ai"
                            ? "TindaBot"
                            : message.sender === "seller"
                              ? "You"
                              : "System"}
                      </span>
                      <div className="message-row-actions">
                        <button className="message-icon-button" type="button" onClick={() => startReply(message)} aria-label="Reply to message" title="Reply">
                          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>
                        </button>
                        {(["seller", "ai"].includes(message.sender)) && message.delivery_status === "sent" && !message.unsent_at && (
                          <div className="message-menu-wrap">
                            <button className="message-icon-button" type="button" onClick={() => setOpenMessageMenuId((current) => current === message.id ? null : message.id)} aria-label="More message actions" title="More">
                              <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
                            </button>
                            {openMessageMenuId === message.id && (
                              <div className="message-menu" role="menu">
                                {(() => {
                                  const channel = customer?.channel;
                                  const textOnly = !message.attachments?.length && !message.image_urls?.length;
                                  const canChange = channel === "web" || channel === "telegram";
                                  const telegramExpired = channel === "telegram" && now > 0 && now - Date.parse(message.created_at) > 48 * 60 * 60 * 1000;
                                  return <>
                                    <button type="button" role="menuitem" disabled={!canChange || !textOnly || sending || (channel === "telegram" && !message.channel_message_ids?.length)} title={!canChange ? "Meta does not support editing sent messages through this API" : !textOnly ? "Text-only messages can be edited" : channel === "telegram" && !message.channel_message_ids?.length ? "Telegram message ID is unavailable for this older reply" : undefined} onClick={() => startEdit(message)}>Edit</button>
                                    <button type="button" role="menuitem" disabled={!canChange || !textOnly || sending || telegramExpired || (channel === "telegram" && !message.channel_message_ids?.length)} title={!canChange ? "Meta does not support unsending sent messages through this API" : !textOnly ? "Text-only messages can be unsent" : telegramExpired ? "Telegram allows deletion within 48 hours" : channel === "telegram" && !message.channel_message_ids?.length ? "Telegram message ID is unavailable for this older reply" : undefined} onClick={() => void unsendMessage(message)}>Unsend for everyone</button>
                                    {!canChange && <small>Meta messages can’t be edited or unsent through TindaBot.</small>}
                                  </>;
                                })()}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {message.reply_to_text && <blockquote className="inbox-message-reply">{message.reply_to_text}</blockquote>}
                      <p>{message.unsent_at ? "This message was unsent for everyone." : message.body}</p>
                      {message.edited_at && !message.unsent_at && <small className="message-edited-label">Edited</small>}
                      {message.delivery_status === "pending" && <small className="message-delivery-status">Sending to channel…</small>}
                      {message.delivery_status === "failed" && <div className="message-delivery-status failed">
                        <small>Not delivered: {message.failure_reason === "outside_window" ? "24-hour reply window closed" : message.failure_reason === "token_rejected" ? "channel token rejected; check Settings" : "channel could not deliver"}</small>
                        <button className="text-button" onClick={() => void retryDelivery(message)} disabled={retryingMessageId === message.id}>{retryingMessageId === message.id ? "Retrying…" : "Retry"}</button>
                      </div>}
                      {!message.unsent_at && message.image_urls?.filter((url) => /^https:\/\//i.test(url)).map((url) => (
                        // eslint-disable-next-line @next/next/no-img-element -- Seller-uploaded chart images are served from Supabase Storage.
                        <img className="inbox-message-image" src={url} alt="Size chart" key={url} loading="lazy" />
                      ))}
                      {!message.unsent_at && message.attachments?.map((file) => file.signedUrl && /^https:\/\//i.test(file.signedUrl)
                        ? file.mimeType.startsWith("image/")
                          // eslint-disable-next-line @next/next/no-img-element -- Private attachments use short-lived signed URLs.
                          ? <img className="inbox-message-image" src={file.signedUrl} alt={file.name} key={file.path} loading="lazy" />
                          : <a className="inbox-message-attachment" href={file.signedUrl} target="_blank" rel="noreferrer" key={file.path}>{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</a>
                        : null)}
                      <time dateTime={message.created_at}>{message.pending ? "Sending…" : formatTime(message.created_at)}</time>
                    </div>
                  </article>
                ))
              )}
            </div>
            {selected.ai_mode === "suggest" && selected.pending.ai_draft && (
              <div className="panel suggestion-panel">
                <p className="eyebrow">AI DRAFT · REVIEW BEFORE SENDING</p>
                <p>{selected.pending.ai_draft}</p>
                <div className="reply-actions">
                  <button
                    className="button button-primary"
                    onClick={() => void sendDraft()}
                    disabled={replyDisabled || sending}
                  >
                    {sending ? "Sending…" : "Send draft"}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => void discardDraft()}
                    disabled={sending}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
            {isSimulatedChannel(customer?.channel) ? (
              <p className="simulated-note thread-simulated-note">
                Coming soon po ang channel na ito. Hindi pa available ang customer replies.
              </p>
            ) : selectedIsMeta && channelStatusError ? (
              <p className="channel-window-note" role="status">
                Hindi ma-verify ang channel setup ngayon. Refresh po muna bago mag-reply.
              </p>
            ) : selectedIsMeta && !selectedMetaConfigured ? (
              <p className="channel-window-note" role="status">
                Coming soon po ang {customer?.channel === "messenger" ? "Messenger" : "Instagram"} dahil hindi pa kumpleto ang channel setup.
              </p>
            ) : selectedIsMeta && !replyWindowOpen ? (
              <p className="channel-window-note" role="status">
                Closed na po ang 24-hour reply window. Magiging available ulit ang reply box kapag nag-message ulit ang customer.
              </p>
            ) : (
              <form className="reply-form" onSubmit={sendReply}>
                <label className="sr-only" htmlFor="seller-reply">
                  Write a reply
                </label>
                <input
                  ref={attachmentInputRef}
                  className="attachment-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    event.currentTarget.value = "";
                    if (!file) return;
                    if (file.size > MAX_ATTACHMENT_BYTES) {
                      setError("Max 25 MB lang po bawat file.");
                      return;
                    }
                    if (!isAllowedAttachmentType(file.type)) {
                      setError("Supported po ang JPG, PNG, WebP, GIF, PDF, TXT, CSV, DOC, DOCX, XLS, at XLSX.");
                      return;
                    }
                    setError("");
                    setAttachment(file);
                  }}
                  disabled={replyDisabled || sending}
                />
                <div className="reply-composer-row">
                  <button
                    className="reply-attachment-button"
                    type="button"
                    onClick={() => attachmentInputRef.current?.click()}
                    disabled={replyDisabled || sending}
                    aria-label="Attach an image or file"
                    title="Attach an image or file"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m21.4 11.1-8.5 8.5a5.7 5.7 0 0 1-8.1-8.1l9.2-9.2a3.8 3.8 0 0 1 5.4 5.4l-9.2 9.2a1.9 1.9 0 0 1-2.7-2.7l8.5-8.5" />
                    </svg>
                  </button>
                  <textarea
                    id="seller-reply"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    maxLength={4000}
                    disabled={replyDisabled}
                    placeholder={editingMessageId ? "Edit your message…" : "Write a reply…"}
                    rows={2}
                  />
                  <button
                    className="button button-primary reply-send-button"
                    type="submit"
                    disabled={replyDisabled || sending || (!draft.trim() && !attachment)}
                  >
                    {sending ? "Sending…" : editingMessageId ? "Save" : "Send"}
                  </button>
                </div>
                {(replyTarget || editingMessageId) && <div className="reply-context-bar">
                  <span><strong>{editingMessageId ? "Editing message" : "Replying to"}</strong>{!editingMessageId && ` ${replyTarget?.sender === "customer" ? customerDisplayName(customer) : replyTarget?.sender === "ai" ? "TindaBot" : "You"}: ${replyTarget?.unsent_at ? "Message was unsent" : replyTarget?.body || "Attachment"}`}</span>
                  <button type="button" onClick={() => { setReplyTarget(null); setEditingMessageId(null); setDraft(""); }} aria-label="Cancel reply or edit" title="Cancel">×</button>
                </div>}
                <div className="reply-attachment-row">
                  {attachment && <span className="reply-attachment-name"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>{attachment.name} · {(attachment.size / 1024 / 1024).toFixed(2)} MB <button className="reply-remove-attachment" type="button" onClick={() => setAttachment(null)} disabled={sending} aria-label="Remove attachment" title="Remove attachment">×</button></span>}
                </div>
                <div className="reply-actions">
                  <span>{draft.length}/4000</span>
                  {sending && <span role="status">Uploading and sending…</span>}
                </div>
              </form>
            )}
          </>
        ) : (
          <div className="thread-placeholder">
            <span className="placeholder-icon" aria-hidden="true">
              ▤
            </span>
            <h2>Select a conversation</h2>
            <p className="muted">
              Pumili po ng message sa inbox para makita ang conversation.
            </p>
          </div>
        )}
      </section>

      <aside className="inbox-details-panel">
        {selected && customer ? (
          <>
            <div className="details-heading">
              <p className="eyebrow">CUSTOMER PROFILE</p>
              <button className="mobile-details-close text-button" type="button" aria-label="Close customer profile" onClick={() => setMobileDetailsOpen(false)}>
                Close
              </button>
              <button className="details-more" type="button" aria-label="Customer profile actions" aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => !open)}>
                •••
              </button>
              {profileMenuOpen && (
                <div className="details-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void copyProfileValue(customer.id, "Customer ID")}>Copy customer ID</button>
                  <button type="button" role="menuitem" onClick={() => void copyProfileValue(selected.id, "Conversation ID")}>Copy conversation ID</button>
                  <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); void setHidden(!selected.is_hidden); }}>
                    {selected.is_hidden ? "Unhide conversation" : "Hide conversation"}
                  </button>
                </div>
              )}
            </div>
            <div className="customer-profile">
              <span className="customer-avatar">
                {customerDisplayName(customer)
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <h2>{customerDisplayName(customer)}</h2>
              <span className="channel-badge">
                {channelLabel(customer.channel)}
              </span>
              <form className="customer-rename-form" onSubmit={(event) => void saveCustomerName(event)}>
                <label htmlFor="customer-display-name">Display name</label>
                <input id="customer-display-name" value={nameDraft} maxLength={80} onChange={(event) => setNameDraft(event.target.value)} placeholder="Add a customer name" />
                <button className="text-button" type="submit" disabled={savingName}>{savingName ? "Saving…" : "Save name"}</button>
              </form>
            </div>
            {missedRequests.length > 0 && (
              <section className="customer-orders seller-followup-card">
                <p className="eyebrow">SELLER FOLLOW-UP</p>
                {missedRequests.map((request) => <p key={request.id}>{request.request_text}</p>)}
                {selected.status === "needs_seller" && <button className="text-button" onClick={() => void markResolved()}>Mark handled</button>}
              </section>
            )}
            <dl className="customer-details">
              <div>
                <dt>Customer ID</dt>
                <dd>{customer.external_id}</dd>
              </div>
              <div>
                <dt>Conversation</dt>
                <dd>{selected.id.slice(0, 8)}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>
                  {new Intl.DateTimeFormat("en-PH", {
                    dateStyle: "medium",
                  }).format(new Date(selected.created_at))}
                </dd>
              </div>
            </dl>
            <section className="customer-orders">
              <p className="eyebrow">ORDERS</p>
              {customerOrders.length === 0 ? (
                <p className="muted">No orders yet.</p>
              ) : (
                customerOrders.map((order) => (
                  <article className="customer-order-card" key={order.id}>
                    <div>
                      <strong>#{order.id}</strong>
                      <span className={"order-status " + order.status}>
                        {order.status.replace("_", " ")}
                      </span>
                    </div>
                    <p>
                      {order.order_items
                        .map(
                          (item) =>
                            item.qty +
                            " × " +
                            (item.variants?.products?.name ?? "Product") +
                            " (" +
                            (item.variants?.size ?? "Size") +
                            ")",
                        )
                        .join(", ")}
                    </p>
                    <strong>
                      ₱
                      {Number(order.total).toLocaleString("en-PH", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </strong>
                    {Array.isArray(order.payment_proof) &&
                      order.payment_proof.length > 0 && (
                        <span className="proof-received">
                          Payment proof received
                        </span>
                      )}
                  </article>
                ))
              )}
            </section>
            <label className="mode-label" htmlFor="ai-mode">
              Assistant mode
            </label>
            <select
              id="ai-mode"
              value={selected.ai_mode}
              disabled={savingMode}
              onChange={(event) =>
                void changeMode(event.target.value as Conversation["ai_mode"])
              }
            >
              <option value="auto">Auto</option>
              <option value="suggest">Suggest</option>
              <option value="human">Human</option>
            </select>
            <p className="mode-hint">
              {selected.ai_mode === "human"
                ? "Ikaw muna ang sasagot po."
                : selected.ai_mode === "suggest"
                  ? "Magmumungkahi ang assistant ng replies."
                  : "Awtomatikong sasagot ang assistant kapag available."}
            </p>
          </>
        ) : (
          <p className="muted details-empty">
            Customer details will appear here.
          </p>
        )}
      </aside>
    </div>
  );
}
