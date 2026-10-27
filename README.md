# TindaBot

TindaBot is a seller inbox and catalog for Filipino online clothing shops. Customers can ask about products through a chat widget or Telegram, while sellers manage conversations, stock, and orders in one place.

## Setup

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env.local` and fill in the public Supabase URL and publishable key (or legacy anon key).
3. Install dependencies with `npm install`.
4. Start the seller app with `npm run dev`.
5. Run checks with `npm run lint`, `npm run typecheck`, and `npm test`.
6. Install the Supabase CLI, then run `supabase link` when you are ready to connect a project. Edge Function environment values are documented in `.env.functions.example`.

Seller sign-in uses Supabase Auth email and password. Create seller accounts from the Supabase Dashboard; the app has no public sign-up page. Set `ALLOWED_ORIGINS` in `.env.functions` to the seller app origins before using the reply function.

This repository contains mock UI data only. Keep credentials in local environment files and never commit them. To enable the staged-secret commit check, run `git config core.hooksPath .githooks` once in this clone.
