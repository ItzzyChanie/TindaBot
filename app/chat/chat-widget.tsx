"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

type WidgetMessage = {
  id: string;
  sender: "customer" | "ai" | "seller";
  body: string;
  created_at: string;
};
type WidgetResponse = { token?: string; messages?: WidgetMessage[]; cursor?: string | null; error?: string };
type ChatWidgetProps = {
  productId?: string | null;
  sessionId?: string | null;
  onClose?: () => void;
};

const tokenKey = "tindabot-widget-session-v1";
const quickReplies = [
  { label: "Presyo", text: "Magkano po ito?" },
  { label: "Size at stock", text: "Anong sizes ang available?" },
  { label: "Shipping", text: "Magkano shipping sa Metro Manila?" },
  { label: "Paano magbayad", text: "Paano magbayad?" },
  { label: "Order status", text: "Nasaan na order ko?" },
  { label: "Talk to the seller", text: "SELLER" },
];

function renderMessageBody(body: string) {
  return body.split(/(https:\/\/\S+)/g).map((part, index) => {
    if (!part.startsWith("https://")) return part;
    const url = part.replace(/[),.!?]+$/, "");
    const suffix = part.slice(url.length);
    return (
      <span key={index}>
        <a href={url} target="_blank" rel="noreferrer">{url}</a>{suffix}
      </span>
    );
  });
}

async function widgetRequest(path: string, body: Record<string, unknown>): Promise<WidgetResponse> {
  const { url, supabaseKey } = getSupabasePublicEnv();
  const response = await fetch(`${url}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as WidgetResponse;
  if (!response.ok) throw new Error(result.error ?? "Chat request failed. Please try again.");
  return result;
}

export function ChatWidget({ productId: initialProductId, sessionId: initialSessionId, onClose }: ChatWidgetProps) {
  const [token, setToken] = useState("");
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const tokenRef = useRef("");
  const storageKeyRef = useRef(tokenKey);
  const initRef = useRef<Promise<string> | null>(null);
  const cursorRef = useRef<string | null>(null);
  const seenRef = useRef(new Set<string>());
  const requestBusyRef = useRef(false);
  const queuedMessagesRef = useRef<string[]>([]);
  const productIdRef = useRef<string | null>(initialProductId ?? null);

  const getToken = useCallback((): Promise<string> => {
    if (tokenRef.current) return Promise.resolve(tokenRef.current);
    if (initRef.current) return initRef.current;
    initRef.current = (async () => {
      const cached = localStorage.getItem(storageKeyRef.current);
      if (cached) return cached;
      const result = await widgetRequest("widget-session", { product_id: productIdRef.current });
      if (!result.token) throw new Error("Could not start chat. Please refresh the page.");
      localStorage.setItem(storageKeyRef.current, result.token);
      return result.token;
    })();
    return initRef.current;
  }, []);

  const requestMessages = useCallback(async (sessionToken: string, text?: string) => {
    if (text) {
      queuedMessagesRef.current.push(text);
      setSending(true);
    }
    if (requestBusyRef.current) return;
    requestBusyRef.current = true;
    try {
      const nextText = queuedMessagesRef.current.shift();
      const result = await widgetRequest("widget-message", {
        token: sessionToken,
        product_id: productIdRef.current,
        ...(nextText ? { text: nextText } : {}),
        cursor: cursorRef.current,
      });
      const fresh = (result.messages ?? []).filter((message) => !seenRef.current.has(message.id));
      for (const message of fresh) seenRef.current.add(message.id);
      if (fresh.length) setMessages((current) => [...current, ...fresh]);
      if (result.cursor) cursorRef.current = result.cursor;
      setError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Chat is unavailable. Please try again.";
      if (/session expired|invalid chat session/i.test(message)) {
        localStorage.removeItem(storageKeyRef.current);
        tokenRef.current = "";
        initRef.current = null;
      }
      setError(message);
    } finally {
      requestBusyRef.current = false;
      if (queuedMessagesRef.current.length) {
        void requestMessages(sessionToken);
      } else {
        setSending(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let interval: number | undefined;
    let visibilityListener: (() => void) | undefined;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("product");
    const productId = initialProductId !== undefined ? initialProductId : fromUrl;
    productIdRef.current = productId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)
      ? productId
      : null;

    let sessionId = initialSessionId ?? params.get("session");
    if (!sessionId && params.get("new") === "1") {
      sessionId = crypto.randomUUID();
      params.delete("new");
      params.set("session", sessionId);
      window.history.replaceState(window.history.state, "", `/chat?${params.toString()}`);
    }
    storageKeyRef.current = sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)
      ? `${tokenKey}:${sessionId}`
      : tokenKey;

    void getToken().then((sessionToken) => {
      if (cancelled) return;
      tokenRef.current = sessionToken;
      setToken(sessionToken);
      setLoading(false);
      void requestMessages(sessionToken);
      interval = window.setInterval(() => {
        if (!document.hidden) void requestMessages(sessionToken);
      }, 2000);
      visibilityListener = () => {
        if (!document.hidden) void requestMessages(sessionToken);
      };
      document.addEventListener("visibilitychange", visibilityListener);
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Could not start chat.");
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      if (interval !== undefined) window.clearInterval(interval);
      if (visibilityListener) document.removeEventListener("visibilitychange", visibilityListener);
    };
  }, [getToken, initialProductId, initialSessionId, requestMessages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !token || sending || [...trimmed].length > 500) return;
    await requestMessages(token, trimmed);
    setDraft("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <section className="widget-card" aria-label="TindaBot web chat">
      <header className="widget-header">
        <span className="brand-mark" aria-hidden="true">t</span>
        <div><strong>TindaBot shop assistant</strong><span>Web chat</span></div>
        {onClose && <button className="widget-close" type="button" onClick={onClose} aria-label="Close chat">×</button>}
      </header>
      <p className="widget-notice">Automated assistant po ito ng shop. Maaari po kayong magtanong tungkol sa catalog, presyo, sizes at stock, shipping, bayad, at order status. I-type ang SELLER para makausap ang seller. Chat messages are retained for 90 days po.</p>
      {error && <p className="widget-error" role="alert">{error}</p>}
      <div className="widget-messages" aria-live="polite" aria-busy={sending}>
        {loading ? <p className="widget-state">Inihahanda ang chat…</p> : messages.length === 0 ? <p className="widget-state">Kumusta po! Pumili ng quick question o mag-type ng tanong.</p> : messages.map((message) => (
          <article className={`widget-message ${message.sender}`} key={message.id}>
            <span>{message.sender === "customer" ? "You" : message.sender === "seller" ? "Seller" : "Assistant"}</span>
            <p>{renderMessageBody(message.body)}</p>
            <time>{new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(new Date(message.created_at))}</time>
          </article>
        ))}
        {sending && <p className="widget-typing" role="status">Sending your message…</p>}
      </div>
      <div className="widget-quick-replies" aria-label="Quick questions">
        {quickReplies.map((item) => <button key={item.label} type="button" disabled={loading || sending || !token} onClick={() => void send(item.text)}>{item.label}</button>)}
      </div>
      <form className="widget-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="widget-message">Your message</label>
        <textarea id="widget-message" value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 500))} placeholder="Isulat ang tanong ninyo po…" maxLength={500} rows={2} disabled={loading} />
        <div><span>{[...draft].length}/500</span><button className="button button-primary" disabled={loading || sending || !draft.trim()}>Send</button></div>
      </form>
      <p className="widget-session-note">{token ? "Secure web chat session" : "Starting secure chat…"}</p>
    </section>
  );
}
