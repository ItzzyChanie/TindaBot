"use client";

import {
  useCallback,
  useEffect,
  useMemo,
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
  last_message_at: string;
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function InboxWorkspace() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");

  const loadInbox = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: conversationError } = await supabase
        .from("conversations")
        .select(
          "id, customer_id, status, ai_mode, last_message_at, created_at, customers(channel, external_id, name)",
        )
        .order("last_message_at", { ascending: false });
      if (conversationError) throw conversationError;

      const rows = (data ?? []) as unknown as Conversation[];
      const ids = rows.map((row) => row.id);
      let nextMessages: Message[] = [];
      if (ids.length) {
        const { data: messageData, error: messageError } = await supabase
          .from("messages")
          .select("id, conversation_id, sender, body, created_at")
          .in("conversation_id", ids)
          .order("created_at", { ascending: true });
        if (messageError) throw messageError;
        nextMessages = (messageData ?? []) as Message[];
      }

      setConversations(rows);
      setMessages(nextMessages);
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
  }, []);

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
        () => {
          void loadInbox();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        () => {
          void loadInbox();
        },
      )
      .subscribe((status: string) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          setLiveError("Live updates paused. Refresh to reconnect po.");
        if (status === "SUBSCRIBED") {
          setLiveError("");
          void loadInbox();
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadInbox]);

  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ??
    null;
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
    if (!selected || !draft.trim() || sending) return;
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
      await loadInbox();
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

  const customer = selected?.customers;

  return (
    <div className={`inbox-page${selectedId ? " has-selection" : ""}`}>
      <aside className="inbox-list-panel">
        <div className="inbox-list-heading">
          <div>
            <p className="eyebrow">CUSTOMER MESSAGES</p>
            <h1>Inbox</h1>
          </div>
          <span className="inbox-total">{conversations.length}</span>
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
        ) : (
          <div className="conversation-list">
            {conversations.map((conversation) => {
              const latest = lastMessages.get(conversation.id);
              const contact = conversation.customers;
              return (
                <button
                  key={conversation.id}
                  className={`conversation-card${selectedId === conversation.id ? " selected" : ""}`}
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
                      {contact?.channel ?? "unknown"}
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
                <span>{customer?.channel ?? "Unknown channel"}</span>
              </div>
              {selected.status === "needs_seller" && (
                <span className="needs-badge thread-needs">Needs you</span>
              )}
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
            <p className="eyebrow">CUSTOMER</p>
            <div className="customer-profile">
              <span className="customer-avatar">
                {(customer.name ?? customer.external_id)
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <h2>{customer.name || "Customer"}</h2>
              <span className="channel-badge">{customer.channel}</span>
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
