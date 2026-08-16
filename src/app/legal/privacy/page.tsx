import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <main className="container" style={{ padding: "48px 24px", maxWidth: 720 }}>
      <h1>Privacy Policy</h1>
      <p className="muted small">Working scaffold — replace with counsel-reviewed policy before launch.</p>

      <h2>What we collect</h2>
      <ul style={{ lineHeight: 1.7 }}>
        <li>
          <strong>Creators:</strong> your email (for sign-in and receipts) and what you upload.
          Payment details go to Stripe; we never see card numbers.
        </li>
        <li>
          <strong>Visitors:</strong> first-party analytics only — a visit count, an anonymized
          daily-rotating hash for uniques, and time-on-page. No third-party trackers, no ad tech,
          no cross-site anything.
        </li>
      </ul>

      <h2>Photos and metadata</h2>
      <p>
        We strip GPS location from every image we serve. Full EXIF metadata from your originals is
        retained privately for you alone.
      </p>

      <h2>Email</h2>
      <p>
        We send transactional email only: sign-in links, receipts, renewal reminders, export
        links, and featuring decisions. No marketing lists.
      </p>
    </main>
  );
}
