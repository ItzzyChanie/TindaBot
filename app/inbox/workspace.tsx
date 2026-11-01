"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchChannelStatus, type ChannelStatus } from "@/lib/channel-status";

type Customer = { channel: string; external_id: string; name: string | null };
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

function customerDisplayName(customer: Customer | null | undefined) {
  return customer?.name || (customer?.channel === "instagram" ? "Instagram customer" : customer?.external_id || "Customer");
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isSimulatedChannel(channel?: string) {
  return channel === "messenger_simulated" || channel === "instagram_simulated";
}

function channelLabel(channel: string | null | undefined, status: ChannelStatus | null, statusError: boolean) {
  if (channel === "web") return "Web chat";
  if (channel === "messenger")
    return `Messenger - ${statusError ? "Status unavailable" : status ? status.messenger ? "Test mode" : "Coming soon" : "Checking"}`;
  if (channel === "instagram")
    return `Instagram - ${statusError ? "Status unavailable" : status ? status.instagram ? "Test mode" : "Coming soon" : "Checking"}`;
  if (channel === "messenger_simulated")
    return "Messenger · Coming soon (simulated)";
  if (channel === "instagram_simulated")
    return "Instagram · Coming soon (simulated)";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [channelStatus, setChannelStatus] = useState<ChannelStatus | null>(null);
  const [channelStatusError, setChannelStatusError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [showHidden, setShowHidden] = useState(false);
  const [conversationPage, setConversationPage] = useState(0);
  const [conversationCount, setConversationCount] = useState(0);
  const [previews, setPreviews] = useState<Map<string, Message>>(new Map());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const selectedConversationRef = useRef<string | null>(null);
  const selectedCustomerRef = useRef<string | null>(null);

  const refreshConversationList = useCallback(async () => {
    const { data, error: queryError, count } = await createSupabaseBrowserClient()
      .from("conversations")
      .select(
        "id, customer_id, status, ai_mode, pending, last_message_at, last_customer_message_at, seller_read_at, is_hidden, created_at, customers(channel, external_id, name)",
        { count: "exact" },
      )
      .eq("is_hidden", showHidden)
      .order("last_message_at", { ascending: false })
      .range(conversationPage * CONVERSATIONS_PER_PAGE, (conversationPage + 1) * CONVERSATIONS_PER_PAGE - 1);
    if (queryError) {
      setLiveError("Live updates paused. Refresh to reconnect po.");
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

  const loadInbox = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error: conversationError, count } = await supabase
          .from("conversations")
          .select(
            "id, customer_id, status, ai_mode, pending, last_message_at, last_customer_message_at, seller_read_at, is_hidden, created_at, customers(channel, external_id, name)",
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
    void fetchChannelStatus().then(setChannelStatus).catch(() => setChannelStatusError(true));
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
          setMessages((current) => [
            ...current.filter((item) => item.id !== message.id && !(item.pending && item.sender === message.sender && item.body === message.body)), message,
          ].sort((a, b) => a.created_at.localeCompare(b.created_at)));
          setPreviews((current) => new Map(current).set(conversationId, message));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => void refreshOrders(),
      )
      .subscribe((status: string) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          setLiveError("Live updates paused. Refresh to reconnect po.");
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

  useEffect(() => {
    setMessages([]);
    setOrders([]);
    setHasOlderMessages(false);
    if (!selectedId || !selectedCustomerId) return;
    let active = true;
    setLoadingOlder(false);
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      const [messageResult, orderResult] = await Promise.all([
        supabase.from("messages")
          .select("id, conversation_id, sender, body, image_urls, created_at")
          .eq("conversation_id", selectedId)
          .order("created_at", { ascending: false })
          .limit(MESSAGES_PER_PAGE),
        supabase.from("orders")
          .select("id, customer_id, total, status, payment_proof, created_at, order_items(qty, unit_price, variants(size, products(name)))")
          .eq("customer_id", selectedCustomerId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (!active) return;
      if (messageResult.error || orderResult.error) {
        setError(messageResult.error?.message ?? orderResult.error?.message ?? "Could not load this conversation.");
        return;
      }
      const loadedMessages = ((messageResult.data ?? []) as Message[]).reverse();
      setMessages(loadedMessages);
      setHasOlderMessages(loadedMessages.length === MESSAGES_PER_PAGE);
      setOrders((orderResult.data ?? []) as unknown as CustomerOrder[]);
      const latest = loadedMessages.at(-1);
      if (latest) setPreviews((current) => new Map(current).set(selectedId, latest));
    })();
    return () => { active = false; };
  }, [selectedId, selectedCustomerId]);

  async function loadOlderMessages() {
    const oldest = messages[0];
    if (!selectedId || !oldest || loadingOlder || !hasOlderMessages) return;
    setLoadingOlder(true);
    const { data, error: olderError } = await createSupabaseBrowserClient()
      .from("messages")
      .select("id, conversation_id, sender, body, image_urls, created_at")
      .eq("conversation_id", selectedId)
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(MESSAGES_PER_PAGE);
    if (olderError) setError(olderError.message);
    else {
      const older = ((data ?? []) as Message[]).reverse();
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
    if (!normalized) return conversations;
    return conversations.filter((conversation) => {
      const latest = lastMessages.get(conversation.id)?.body ?? "";
      const customer = conversation.customers;
      return `${customer?.name ?? ""} ${customer?.external_id ?? ""} ${latest}`
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [conversations, lastMessages, search]);

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
      !draft.trim() ||
      sending
    )
      return;
    const text = draft.trim();
    if (text.length > 4000) {
      setError("Hanggang 4,000 characters lang po bawat reply.");
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
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: replyError } = await supabase.functions.invoke(
        "seller-reply",
        {
          body: { conversationId: selected.id, text },
        },
      );
      if (replyError) throw replyError;
      setDraft("");
    } catch (cause) {
      setMessages((current) => current.filter((message) => message.id !== pendingId));
      setError(
        cause instanceof Error
          ? cause.message
          : "Hindi naipadala ang reply. Pakisubukan ulit po.",
      );
    } finally {
      setSending(false);
    }
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
    setSelectedId(null);
    await refreshConversationList();
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
    <div className={`inbox-page${selectedId ? " has-selection" : ""}`}>
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
        <div className="inbox-toolbar">
          <span className="inbox-filter-label">
            {showHidden ? "Hidden conversations" : "All conversations"}
          </span>
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
        <div className="inbox-channel-status" aria-label="Messaging channel status">
          <span className={`channel-status-chip${channelStatus?.messenger ? " ready" : ""}`}>
            Messenger · {channelStatusError ? "Status unavailable" : channelStatus ? channelStatus.messenger ? "Test mode" : "Coming soon" : "Checking"}
          </span>
          <span className={`channel-status-chip${channelStatus?.instagram ? " ready" : ""}`}>
            Instagram · {channelStatusError ? "Status unavailable" : channelStatus ? channelStatus.instagram ? "Test mode" : "Coming soon" : "Checking"}
          </span>
        </div>
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
                      {channelLabel(contact?.channel, channelStatus, channelStatusError)}
                    </span>
                  </span>
                  <time className="conversation-time">
                    {formatTime(conversation.last_message_at)}
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
                onClick={() => setSelectedId(null)}
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
                <span>{channelLabel(customer?.channel, channelStatus, channelStatusError)}</span>
              </div>
              <div className="thread-header-actions">
                {selected.status === "needs_seller" && (
                  <span className="needs-badge thread-needs">Needs you</span>
                )}
                {selected.status === "needs_seller" && (
                  <button
                    className="text-button"
                    onClick={() => void markResolved()}
                  >
                    Mark resolved
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() => void setHidden(!selected.is_hidden)}
                >
                  {selected.is_hidden ? "Unhide" : "Hide"}
                </button>
                <button
                  className="text-button"
                  onClick={() => void deleteConversation()}
                >
                  Delete
                </button>
              </div>
            </header>
            {liveError && (
              <p className="inbox-alert" role="status">
                {liveError}
              </p>
            )}
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
            <div className="thread-messages" aria-live="polite">
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
                      <p>{message.body}</p>
                      {message.image_urls?.filter((url) => /^https:\/\//i.test(url)).map((url) => (
                        // eslint-disable-next-line @next/next/no-img-element -- Seller-uploaded chart images are served from Supabase Storage.
                        <img className="inbox-message-image" src={url} alt="Size chart" key={url} loading="lazy" />
                      ))}
                      <time>{message.pending ? "Sending…" : formatTime(message.created_at)}</time>
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
                <textarea
                  id="seller-reply"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={4000}
                  disabled={replyDisabled}
                  placeholder="Write a reply…"
                  rows={2}
                />
                <div className="reply-actions">
                  <span>{draft.length}/4000</span>
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={replyDisabled || sending || !draft.trim()}
                  >
                    {sending ? "Sending…" : "Send reply"}
                  </button>
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
              <span className="details-more" aria-hidden="true">
                •••
              </span>
            </div>
            <div className="customer-profile">
              <span className="customer-avatar">
                {customerDisplayName(customer)
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <h2>{customerDisplayName(customer)}</h2>
              <span className="channel-badge">
                {channelLabel(customer.channel, channelStatus, channelStatusError)}
              </span>
            </div>
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
