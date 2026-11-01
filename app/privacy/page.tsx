import Link from "next/link";

export const metadata = { title: "Privacy | TindaBot demo" };

export default function PrivacyPage() {
  return (
    <main className="public-legal-page">
      <Link className="legal-back-link" href="/shop">Back to the shop</Link>
      <p className="eyebrow">TINDABOT DEMO</p>
      <h1>Privacy notice</h1>
      <p>Last updated: November 1, 2026</p>
      <p>This demo inbox helps a clothing seller answer questions and manage orders. The assistant uses fixed rules and shop catalog data; it does not send messages to an AI service.</p>

      <h2>What we collect</h2>
      <ul>
        <li>Messages, timestamps, and your chat channel (web chat, Telegram, Messenger, or Instagram).</li>
        <li>Your channel user ID and, when the channel provides it, your display name or username.</li>
        <li>If you place an order, the contact and delivery details you choose to provide. Telegram payment-proof uploads may also leave file reference details in the seller inbox.</li>
        <li>For web chat, a random session token is stored in your browser; the database stores its hash. Rate limiting also uses a hashed network identifier.</li>
      </ul>

      <h2>Why we use it</h2>
      <p>We use this information to reply to your questions, show the conversation to the seller, follow up on orders, and protect the demo from spam. Messages sent through Messenger, Instagram, or Telegram also pass through that service.</p>

      <h2>How long it is kept</h2>
      <p>The demo&apos;s retention target is 90 days for chat and related customer details. The current demo does not automatically delete expired records; the shop operator must remove them. Ask the seller to delete your data at any time using the instructions on our <Link href="/data-deletion">data deletion page</Link>.</p>

      <h2>Keep sensitive information out of chat</h2>
      <p>Please do not send passwords, card numbers, banking credentials, or other secrets. The bot does not take or process payments.</p>

      <p className="legal-note">This is a plain-language notice for a hackathon demo. It describes the current demo behavior and is not legal advice.</p>
      <Link href="/data-deletion">How to request data deletion</Link>
    </main>
  );
}
