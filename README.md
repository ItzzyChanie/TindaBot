# TindaBot

TindaBot is a seller inbox and catalog for Filipino online clothing shops. Customers can ask about products through a chat widget or Telegram, while sellers manage conversations, stock, and orders in one place.

## Setup

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env.local` and fill in the public Supabase URL and publishable key (or legacy anon key).
3. Install dependencies with `npm install`.
4. Start the seller app with `npm run dev`.
5. Run checks with `npm run lint`, `npm run typecheck`, and `npm test`.
6. Install the Supabase CLI, then run `supabase link` when you are ready to connect a project. Edge Function environment values are documented in `.env.functions.example`.
7. Run `npm run seed` to push pending migrations and load the idempotent clothing fixtures into the linked project.

Seller sign-in uses Supabase Auth email and password. Create seller accounts from the Supabase Dashboard; the app has no public sign-up page. Set `ALLOWED_ORIGINS` in `.env.functions` to the seller app origins before using the reply function.

The message-understanding eval is rules-based and runs offline: `npm run eval:understand`. Add representative Taglish and English examples to `eval/messages.json`; the evaluator uses the same catalog phrase rules as Telegram. Intent and catalog matching use local rules first, and all price offers use `quote()`.

## Optional AI fallback (Gemini)

Rules remain the primary reply path. To enable Gemini only for messages the rules classify as unknown, set `AI_FALLBACK=on`, `GEMINI_API_KEY`, and `GEMINI_MODEL` in `.env.functions` and deploy the Edge Functions. Set `AI_FALLBACK=off` to disable it. Gemini does not supply prices or stock; those answers still come from the catalog and `quote()`. The Gemini free tier has daily limits; unavailable, failed, or rate-limited requests fall back to the existing rules reply.

This repository contains mock UI data only. Keep credentials in local environment files and never commit them. To enable the staged-secret commit check, run `git config core.hooksPath .githooks` once in this clone.

## Test-mode messaging channels

Messenger and Instagram Login receive messages in the shared seller inbox. Conversation badges show the channel name only. Settings reports whether each channel is configured; it never displays secret values. The `channel-status` function requires a seller JWT.

See [Meta test-mode setup](docs/meta-test-mode.md) for required variable names, Meta app setup, deployment commands, and a smoke test.

Public chat and storefront pages link to the [privacy notice](/privacy) and [data deletion instructions](/data-deletion).

## Chat privacy and retention

The chat widget and the assistant's first reply disclose that the assistant is automated and that chat messages are retained for 90 days. Do not send payment credentials or other sensitive information in chat. The `purge_expired_chat_data` database job removes conversations and related orders after 90 days without activity. The migration enables `pg_cron` and schedules the cleanup daily; confirm the `tindabot-purge-expired-chat-data` job is active in Supabase Cron after applying migrations.

Meta profile lookups are optional and disabled by default. Set `LOOKUP_META_PROFILES=true` in Supabase Edge Function secrets to request a display name when a customer has no saved name. Sellers can set a local display name in the inbox profile.
