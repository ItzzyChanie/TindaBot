# Day 8 test plan

## Setup

1. Apply the Day 8 migration with `supabase db push`.
2. Set the Supabase function secret `ALLOWED_ORIGINS` to a comma-separated list of exact browser origins, for example `http://localhost:3000,https://your-app.example` (no trailing slash).
3. Deploy `widget-session`, `widget-message`, `seller-reply`, and `telegram-webhook`. The two widget functions must have JWT verification disabled in `supabase/config.toml`; they validate the hashed session token themselves.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and the publishable/anon key in `.env.local`, start the app, and open `/chat` in a private browser window.
5. Use mock products and settings only. Do not put real customer data in this test.

## Web chat

- Confirm the assistant notice, all six quick-reply chips, the character counter, and the mobile layout appear.
- Send a free-text product question and each quick reply. Check that the deterministic rules reply with catalog/settings data and that unknown questions use the standard escalation text with supported topics.
- Reload `/chat`; the session and conversation should persist from localStorage. Confirm messages are not duplicated while the page polls every two seconds.
- Open the same conversation in the seller inbox. Confirm it has a **Web chat** badge. Send a seller reply; it should appear on the next widget poll and must not call the Telegram API.
- Select **Talk to the seller**. Confirm the assistant acknowledges the handoff, then stays quiet for acknowledgment-only customer replies while the seller can reply in the inbox.
- Send more than 500 characters and confirm the UI prevents it. Exercise server limits with repeated requests and confirm a clear rate-limit error.
- Clear the widget token from localStorage and reload to confirm a new session is created. Try a request from an origin not in `ALLOWED_ORIGINS`; it should be rejected.

## Telegram regression

- Send `/start` in Auto mode. Confirm the welcome identifies the automated assistant and explains `/seller` and `/assistant`.
- Ask a catalog price/size question and one unsupported question. Confirm exact catalog/settings answers and that the unsupported answer uses the same escalation wording/topics as web chat.
- Send `/seller`, then an acknowledgment such as `ok`; confirm the assistant does not reply to the acknowledgment. Ask a new supported question and confirm the assistant can still answer it.
- In Human mode, send `/start` and a regular message; confirm the assistant does not send an automatic reply.
- Reply from the seller inbox to a Telegram conversation and confirm Telegram delivery still works.
