# TindaBot production smoke test

Run this checklist after applying migrations, deploying the app and Edge Functions, and setting production secrets. Use a test customer account; do not use real customer data.

- [ ] Sign in as the seller and confirm the account email and seller name in Settings.
- [ ] Open the mobile and tablet navigation; verify Overview and Insights are consecutive and each route opens.
- [ ] On Overview, check the date and greeting against Philippine time. Confirm the Needs you card matches the open escalation count.
- [ ] Open Insights. Verify bot answer share against a short known conversation, paid and shipped revenue against test orders, and the 2-minute-per-answer estimate label.
- [ ] Open a missed request and choose Add to catalog. Confirm the product name field is prefilled, then cancel without saving.
- [ ] Open the Messenger and Instagram sample threads. Confirm each is marked coming soon (simulated), is read-only, and offers no send action.
- [ ] Add a test product and size, confirm the storefront shows it, and verify a stock adjustment appears in Overview.
- [ ] Ask the chat widget a catalog question and a question outside the catalog. Confirm the first answer uses current shop data and the second is escalated.
- [ ] Send a Telegram test message. Confirm the reply is delivered and appears in Inbox; verify an incorrect webhook secret is rejected.
- [ ] Submit a test order and verify stock is reserved once. Mark it paid, then shipped, and confirm Insights includes its revenue exactly once.
- [ ] Edit and save the greeting, shipping text, and payment/order answers. Confirm a new customer conversation uses the updated text.
- [ ] Check that no secrets, environment files, or real customer data were added to the repository.

Messenger and Instagram rows are fixed mock transcripts in the database seed. They do not call Meta APIs. Remove or reset the demo rows after the smoke test if they should not appear in the production inbox.
