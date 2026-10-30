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

type Customer = { channel: string; external_id: string; name: string | null };
type Conversation = {
  id: string;
  customer_id: string;
  status: "open" | "needs_seller" | "resolved";
  ai_mode: "auto" | "suggest" | "human";
  pending: { ai_draft?: string; [key: string]: unknown };
  last_message_at: string;
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
  created_at: string;
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isSimulatedChannel(channel?: string) {
  return channel === "messenger_simulated" || channel === "instagram_simulated";
}

function channelLabel(channel?: string | null) {
  if (channel === "web") return "Web chat";
  if (channel === "messenger_simulated")
    return "Messenger · Coming soon (simulated)";
  if (channel === "instagram_simulated")
    return "Instagram · Coming soon (simulated)";
  return channel ?? "Unknown channel";
}

export function InboxWorkspace() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const customerIdsRef = useRef<string[]>([]);

  const refreshConversationList = useCallback(async () => {
    const { data, error: queryError } = await createSupabaseBrowserClient()
      .from("conversations")
      .select(
        "id, customer_id, status, ai_mode, pending, last_message_at, seller_read_at, is_hidden, created_at, customers(channel, external_id, name)",
      )
      .eq("is_hidden", showHidden)
      .order("last_message_at", { ascending: false });
    if (queryError) {
      setLiveError("Live updates paused. Refresh to reconnect po.");
      return;
    }
    const rows = (data ?? []) as unknown as Conversation[];
    customerIdsRef.current = [...new Set(rows.map((row) => row.customer_id))];
    setConversations(rows);
    setSelectedId((current) =>
      rows.some((row) => row.id === current) ? current : null,
    );
  }, [showHidden]);

  const refreshOrders = useCallback(async () => {
    const customerIds = customerIdsRef.current;
    if (!customerIds.length) {
      setOrders([]);
      return;
    }
    const { data, error: queryError } = await createSupabaseBrowserClient()
      .from("orders")
      .select(
        "id, customer_id, total, status, payment_proof, created_at, order_items(qty, unit_price, variants(size, products(name)))",
      )
      .in("customer_id", customerIds)
      .order("created_at", { ascending: false });
    if (!queryError) setOrders((data ?? []) as unknown as CustomerOrder[]);
  }, []);

  const loadInbox = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error: conversationError } = await supabase
          .from("conversations")
          .select(
            "id, customer_id, status, ai_mode, pending, last_message_at, seller_read_at, is_hidden, created_at, customers(channel, external_id, name)",
          )
          .eq("is_hidden", showHidden)
          .order("last_message_at", { ascending: false });
        if (conversationError) throw conversationError;

        const rows = (data ?? []) as unknown as Conversation[];
        customerIdsRef.current = [
          ...new Set(rows.map((row) => row.customer_id)),
        ];
        const ids = rows.map((row) => row.id);
        const customerIds = [...new Set(rows.map((row) => row.customer_id))];
        const [messageResult, orderResult] = await Promise.all([
          ids.length
            ? supabase
                .from("messages")
                .select("id, conversation_id, sender, body, created_at")
                .in("conversation_id", ids)
                .order("created_at", { ascending: true })
            : Promise.resolve({ data: [], error: null }),
          customerIds.length
            ? supabase
                .from("orders")
                .select(
                  "id, customer_id, total, status, payment_proof, created_at, order_items(qty, unit_price, variants(size, products(name)))",
                )
                .in("customer_id", customerIds)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (messageResult.error) throw messageResult.error;
        if (orderResult.error) throw orderResult.error;
        const nextMessages = (messageResult.data ?? []) as Message[];
        const nextOrders = (orderResult.data ??
          []) as unknown as CustomerOrder[];

        setConversations(rows);
        setMessages(nextMessages);
        setOrders(nextOrders);
        const isNarrow = window.matchMedia("(max-width: 700px)").matches;
        setSelectedId((current) =>
          rows.some((row) => row.id === current)
            ? current
            : isNarrow
              ? null
              : (rows[0]?.id ?? null),
        );
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
    [showHidden],
  );

  useEffect(() => {
    void loadInbox(true);
  }, [loadInbox]);

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
          if (payload.eventType === "DELETE") {
            if (messageId)
              setMessages((current) =>
                current.filter((message) => message.id !== messageId),
              );
            return;
          }
          if (!messageId) return;
          void (async () => {
            const { data } = await createSupabaseBrowserClient()
              .from("messages")
              .select("id, conversation_id, sender, body, created_at")
              .eq("id", messageId)
              .maybeSingle();
            if (data) {
              const message = data as Message;
              setMessages((current) =>
                [
                  ...current.filter((item) => item.id !== message.id),
                  message,
                ].sort((a, b) => a.created_at.localeCompare(b.created_at)),
              );
            }
            void refreshConversationList();
          })();
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
    null;

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
  const threadMessages = useMemo(
    () => messages.filter((message) => message.conversation_id === selectedId),
    [messages, selectedId],
  );
  const lastMessages = useMemo(() => {
    const latest = new Map<string, Message>();
    for (const message of messages)
      latest.set(message.conversation_id, message);
    return latest;
  }, [messages]);
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
            <strong>{conversations.length}</strong>
            <small>threads</small>
          </span>
        </div>
        <div className="inbox-toolbar">
          <span className="inbox-filter-label">
            {showHidden ? "Hidden conversations" : "All conversations"}
          </span>
          <button
            className="inbox-filter-button"
            onClick={() => setShowHidden((value) => !value)}
          >
            {showHidden ? "Show active" : "View hidden"}
          </button>
        </div>
        <label className="inbox-search">
          <span className="sr-only">Search conversations</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people or messages"
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
                  onClick={() => setSelectedId(conversation.id)}
                >
                  <span className="conversation-avatar">
                    {(contact?.name ?? contact?.external_id ?? "?")
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <span className="conversation-main">
                    <span className="conversation-title">
                      <strong>
                        {contact?.name ||
                          contact?.external_id ||
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
                  <time className="conversation-time">
                    {formatTime(conversation.last_message_at)}
                  </time>
                </button>
              );
            })}
          </div>
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
                {(customer?.name ?? customer?.external_id ?? "?")
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <div className="thread-contact">
                <strong>{customer?.name || customer?.external_id}</strong>
                <span>{channelLabel(customer?.channel)}</span>
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
                          ? customer?.name || "Customer"
                          : message.sender === "ai"
                            ? "TindaBot"
                            : message.sender === "seller"
                              ? "You"
                              : "System"}
                      </span>
                      <p>{message.body}</p>
                      <time>{formatTime(message.created_at)}</time>
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
                    disabled={sending}
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
                Coming soon (simulated) po ito. This sample thread is read-only
                and sends no message to Messenger or Instagram.
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
                  placeholder="Write a reply…"
                  rows={2}
                />
                <div className="reply-actions">
                  <span>{draft.length}/4000</span>
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={sending || !draft.trim()}
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
                {(customer.name ?? customer.external_id)
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <h2>{customer.name || "Customer"}</h2>
              <span className="channel-badge">
                {channelLabel(customer.channel)}
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
