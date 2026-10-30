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

const tokenKey = "tindabot-widget-session-v1";
const quickReplies = [
  { label: "Presyo", text: "Magkano po ito?" },
  { label: "Size at stock", text: "Anong sizes ang available?" },
  { label: "Shipping", text: "Magkano shipping sa Metro Manila?" },
  { label: "Paano magbayad", text: "Paano magbayad?" },
  { label: "Order status", text: "Nasaan na order ko?" },
  { label: "Talk to the seller", text: "SELLER" },
];

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

export default function ChatPage() {
  const [token, setToken] = useState("");
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const tokenRef = useRef("");
  const initRef = useRef<Promise<string> | null>(null);
  const cursorRef = useRef<string | null>(null);
  const seenRef = useRef(new Set<string>());
  const requestBusyRef = useRef(false);

  const getToken = useCallback((): Promise<string> => {
    if (tokenRef.current) return Promise.resolve(tokenRef.current);
    if (initRef.current) return initRef.current;
    initRef.current = (async () => {
      const cached = localStorage.getItem(tokenKey);
      if (cached) return cached;
      const result = await widgetRequest("widget-session", {});
      if (!result.token) throw new Error("Could not start chat. Please refresh the page.");
      localStorage.setItem(tokenKey, result.token);
      return result.token;
    })();
    return initRef.current;
  }, []);

  const requestMessages = useCallback(async (sessionToken: string, text?: string) => {
    if (requestBusyRef.current) return;
    requestBusyRef.current = true;
    if (text) setSending(true);
    try {
      const result = await widgetRequest("widget-message", {
        token: sessionToken,
        ...(text ? { text } : {}),
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
        localStorage.removeItem(tokenKey);
        tokenRef.current = "";
        initRef.current = null;
      }
      setError(message);
    } finally {
      requestBusyRef.current = false;
      setSending(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let interval: number | undefined;
    void getToken().then((sessionToken) => {
      if (cancelled) return;
      tokenRef.current = sessionToken;
      setToken(sessionToken);
      setLoading(false);
      void requestMessages(sessionToken);
      interval = window.setInterval(() => void requestMessages(sessionToken), 2000);
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Could not start chat.");
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [getToken, requestMessages]);

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
    <main className="widget-page">
      <section className="widget-card" aria-label="TindaBot web chat">
        <header className="widget-header">
          <span className="brand-mark" aria-hidden="true">t</span>
          <div>
            <strong>TindaBot shop assistant</strong>
            <span>Web chat</span>
          </div>
        </header>
        <p className="widget-notice">Automated assistant po ito ng shop. Maaari po kayong magtanong tungkol sa catalog, presyo, sizes at stock, shipping, bayad, at order status. I-type ang SELLER para makausap ang seller.</p>
        {error && <p className="widget-error" role="alert">{error}</p>}
        <div className="widget-messages" aria-live="polite" aria-busy={sending}>
          {loading ? <p className="widget-state">Inihahanda ang chat…</p> : messages.length === 0 ? <p className="widget-state">Kumusta po! Pumili ng quick question o mag-type ng tanong.</p> : messages.map((message) => (
            <article className={`widget-message ${message.sender}`} key={message.id}>
              <span>{message.sender === "customer" ? "You" : message.sender === "seller" ? "Seller" : "Assistant"}</span>
              <p>{message.body}</p>
              <time>{new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(new Date(message.created_at))}</time>
            </article>
          ))}
          {sending && <p className="widget-typing" role="status">Assistant is typing…</p>}
        </div>
        <div className="widget-quick-replies" aria-label="Quick questions">
          {quickReplies.map((item) => (
            <button key={item.label} type="button" disabled={loading || sending || !token} onClick={() => void send(item.text)}>
              {item.label}
            </button>
          ))}
        </div>
        <form className="widget-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="widget-message">Your message</label>
          <textarea
            id="widget-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 500))}
            placeholder="Isulat ang tanong ninyo po…"
            maxLength={500}
            rows={2}
            disabled={loading}
          />
          <div><span>{[...draft].length}/500</span><button className="button button-primary" disabled={loading || sending || !draft.trim()}>Send</button></div>
        </form>
        <p className="widget-session-note">{token ? "Secure web chat session" : "Starting secure chat…"}</p>
      </section>
    </main>
  );
}
