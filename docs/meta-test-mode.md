# Meta test-mode channels

TindaBot uses one Meta webhook for Messenger and Instagram Login. Both channels call the existing deterministic `handleIncoming` reply flow; there is no AI service.

## Secret variable names

Add the following variable names to the ignored `.env.functions` file and to Supabase Edge Function secrets. Do not put values in README, docs, commits, or support messages.

- `META_VERIFY_TOKEN`
- `META_APP_SECRET`
- `MESSENGER_PAGE_TOKEN`
- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_ACCOUNT_ID`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `ALLOWED_ORIGINS`

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Never expose the service role key in the browser.

## Meta Developer setup

1. Configure the webhook callback as `https://<project-ref>.supabase.co/functions/v1/meta-webhook` and use the same `META_VERIFY_TOKEN` in Meta and Supabase.
2. Subscribe the Page webhook to `messages` and the Instagram account webhook to `messages` (plus postbacks/reactions if enabled in the app dashboard).
3. For Messenger, store the Page access token as `MESSENGER_PAGE_TOKEN`.
4. For Instagram Login, store its access token as `INSTAGRAM_ACCESS_TOKEN` and the professional account ID as `INSTAGRAM_ACCOUNT_ID`. Grant `instagram_business_basic` and `instagram_business_manage_messages`.
5. Add the people who will test to the Meta app roles and Instagram account roles required by the test-mode app.
6. Set `ALLOWED_ORIGINS` to the seller app's local and deployed origins so authenticated browser functions can accept requests.

The code uses Graph API v26.0. Messenger sends use `POST https://graph.facebook.com/v26.0/me/messages`; Instagram Login sends use `POST https://graph.instagram.com/v26.0/{INSTAGRAM_ACCOUNT_ID}/messages`. The webhook is `https://<project-ref>.supabase.co/functions/v1/meta-webhook`.

## Deploy

From PowerShell in the repository root:

```powershell
supabase db push
supabase functions deploy meta-webhook --no-verify-jwt
supabase functions deploy channel-status
supabase functions deploy seller-reply
```

`channel-status` reports booleans only. Settings shows each channel as configured, test mode, coming soon, or status unavailable without returning secret values.

## Smoke test

1. Confirm Settings shows Messenger and Instagram as configured · Test mode.
2. Send a text DM from an app-role test account to the connected Page and Instagram professional account.
3. Confirm the inbox creates a real `messenger` or `instagram` conversation, displays the customer's name/username when Meta provides it, and labels the channel Test mode.
4. Check a rules-based catalog/shop reply, then try a seller reply inside the 24-hour window.
5. Confirm the reply box is disabled after the window closes. Ask the customer to message again to reopen it.

Meta test-mode accounts must satisfy Meta's app/account role requirements. The customer must start the conversation before the Send API can reply. TindaBot blocks replies after 24 hours.
