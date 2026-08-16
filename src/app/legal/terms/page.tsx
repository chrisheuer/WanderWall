import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <main className="container" style={{ padding: "48px 24px", maxWidth: 720 }}>
      <h1>Terms of Service</h1>
      <p className="muted small">Working scaffold — replace with counsel-reviewed terms before launch.</p>

      <h2>Your content is yours</h2>
      <p>
        You keep all rights to the works you upload. By publishing a gallery you attest that you
        own the works or hold the rights to display them, and you grant us only the license needed
        to host and display them at your direction. Choosing a Creative Commons license for a work
        is your decision and is never applied by default.
      </p>

      <h2>Billing, plainly</h2>
      <ul style={{ lineHeight: 1.7 }}>
        <li>Hosting renews automatically (monthly or yearly) until you cancel.</li>
        <li>We email you 30 and 7 days before an annual renewal.</li>
        <li>Cancellation takes one click and applies at the end of the paid period.</li>
        <li>
          After hosting ends your gallery freezes: it is no longer public, but it is never deleted
          — you can export it or reactivate at any time.
        </li>
        <li>
          The download product includes a 3-day window after purchase to edit and re-export; after
          that the gallery is read-only here and your latest export remains downloadable.
        </li>
        <li>Crossing the 50-piece tier boundary upgrades your subscription with proration — creation is never charged twice.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Galleries must contain work you have the right to display. We may remove content that is
        unlawful or infringing after notice.
      </p>

      <h2>Donations</h2>
      <p>
        Visitor donations are voluntary payments to the gallery's creator, processed by Stripe.
      </p>
    </main>
  );
}
