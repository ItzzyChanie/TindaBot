"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      window.location.assign("/");
    } 
    catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Hindi nakapag-sign in. Pakisubukan ulit po.",
      );
    } 
    finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            t
          </span>
          <span>
            Tinda<span className="brand-accent">Bot</span>
          </span>
        </Link>
        <p className="eyebrow">SELLER WORKSPACE</p>
        <h1>Welcome back</h1>
        <p className="muted">Mag-sign in po para buksan ang inyong shop.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button button-primary login-submit"
            type="submit"
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="login-help">
          Need access? Ask your shop administrator to invite you.
        </p>
      </section>
    </main>
  );
}
