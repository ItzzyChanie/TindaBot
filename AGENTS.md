You are my pair-programmer on TindaBot, a hackathon MVP (Build-Off: Business Edition, demo on 10 Nov 2026). Work in small steps, show a short plan before large changes, and run tests after each step.

PRODUCT
TindaBot helps starting Filipino online clothing sellers who sell through Facebook, Instagram and Telegram chats. Customers chat on Telegram or a web chat widget. The seller sees every conversation in one live inbox, manages a catalog (products, sizes, stock, discount, promo), and an AI assistant answers in Taglish using only the catalog. A public storefront shows live availability with an Ask about this button. Messenger and Instagram are SIMULATED in the UI and labelled coming soon. Do not build integrations for any other channel or marketplace.

STACK
Next.js (App Router) + TypeScript + Tailwind for the seller app and storefront. Supabase: Postgres, Auth, Realtime, Storage, Edge Functions (TypeScript/Deno). Telegram Bot API via webhook. AI through a provider wrapper (AI_PROVIDER=gemini or openai). Vercel for hosting. Vitest for tests. Windows and PowerShell.

NON-NEGOTIABLE RULES
1. There is no AI or external language service. The reply engine normalizes the message (lowercase, punctuation, common typos), matches product aliases, sizes, quantities (digits and Filipino number words) and intent keywords, then builds the reply from hard-coded Taglish templates filled with exact numbers from quote() and the database.
2. One price function, quote(), in a dependency-free TypeScript file used by chat, storefront, catalog preview and orders. The customer gets the single best offer (no stacking). Money is numeric(10,2) in the database; calculations round to 2 decimals once per line and are unit-tested.
3. Answer only from the catalog and shop settings. Anything the rules do not recognise, and every complaint, refund or custom request, escalates to the seller (needs_seller plus a missed_requests row) with a reply that lists what the bot can answer.
4. The assistant says it is automated and always lets the customer ask for the seller.
5. SECURITY (the repo is PUBLIC): never commit secrets, .env files or real customer data. Use blank .env.example files. Secrets live only in .env.local, .env.functions and Supabase secrets. The bot token and service-role key are used only inside Edge Functions. Verify the Telegram webhook secret header. Enable RLS on every table. Public access only through a view that exposes safe columns of active products. Rate limit public endpoints, cap message length, enforce a daily AI call cap, and escape all user text before rendering. Use mock data only.
6. Stock changes only through an atomic SQL function so the last item cannot be sold twice.
7. Every channel calls one function, handleIncoming(channel, externalId, text, context). Channels are thin adapters.
8. Do not add libraries, features or files that the current day does not need. Keep code readable with short comments.
9. Keep the reply engine in one module with an understand(message, context) function that returns {intent, product, size, quantity, location, confidence}. A language model can be plugged in there later without changing the rest of the app.
10. After each task run lint, type-check and tests, then summarize what changed, what I should test by hand, and any follow-ups. Commit with a clear message.

CONVENTIONS
Folders: app/ (Next.js), supabase/migrations, supabase/functions with _shared for shared code, eval/ for test messages, docs/. Code and names in English. Customer-facing text in Taglish with po. Money shown as ₱1,234.50.