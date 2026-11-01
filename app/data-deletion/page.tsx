import Link from "next/link";

export const metadata = { title: "Data deletion | TindaBot demo" };

export default function DataDeletionPage() {
  return (
    <main className="public-legal-page">
      <Link className="legal-back-link" href="/shop">Back to the shop</Link>
      <p className="eyebrow">TINDABOT DEMO</p>
      <h1>Request data deletion</h1>
      <p>To ask the shop to delete your TindaBot demo data, message the seller from the same chat channel you used. In web chat, type <strong>SELLER</strong> and ask the seller directly.</p>
      <ol>
        <li>Say that you are requesting deletion of your TindaBot demo data.</li>
        <li>Tell the seller which channel you used and the approximate date of your chat. Your display name or username can help them find it.</li>
        <li>Do not send passwords, payment credentials, or extra identity documents in chat.</li>
      </ol>
      <p>The seller will locate and delete the related conversation and customer details from the shop&apos;s Supabase project. The demo does not currently provide an automatic deletion button or automatic 90-day cleanup.</p>
      <p>Meta, Instagram, and Telegram may keep separate copies under their own account controls. If you also want those copies removed, use the privacy or data controls in the service where you chatted.</p>
      <p>Read the <Link href="/privacy">privacy notice</Link> for the data collected and its use.</p>
    </main>
  );
}
