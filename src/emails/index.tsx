import * as React from "react";
import { CtaLink, EmailShell, P } from "./components";

function cents(amount?: number): string {
  return amount == null ? "" : `$${(amount / 100).toFixed(2)}`;
}

export function RenewalReminderEmail(props: {
  galleryTitle: string;
  renewsAt?: string;
  amountCents?: number;
  manageUrl: string;
}) {
  return (
    <EmailShell
      preview={`"${props.galleryTitle}" renews ${props.renewsAt ?? "soon"}`}
      heading="Your gallery renews soon"
    >
      <P>
        Hosting for “{props.galleryTitle}” renews on {props.renewsAt ?? "its renewal date"}
        {props.amountCents ? <> for {cents(props.amountCents)}</> : null}. No action is needed to
        keep it live.
      </P>
      <P>
        If you’d rather not renew, cancel any time with one click — your gallery stays up until the
        end of the period you’ve paid for, and you can always export it.
      </P>
      <CtaLink href={props.manageUrl}>Manage or cancel</CtaLink>
    </EmailShell>
  );
}

export function DunningEmail(props: {
  galleryTitle: string;
  manageUrl: string;
}) {
  return (
    <EmailShell
      preview={`Payment issue for "${props.galleryTitle}"`}
      heading="We couldn't process your renewal"
    >
      <P>
        A renewal payment for “{props.galleryTitle}” didn’t go through. We’ll retry automatically a
        few times. If payment keeps failing, hosting will pause — your gallery is never deleted, and
        you can export it or reactivate whenever you like.
      </P>
      <CtaLink href={props.manageUrl}>Update payment method</CtaLink>
    </EmailShell>
  );
}

export function FrozenNoticeEmail(props: {
  galleryTitle: string;
  manageUrl: string;
}) {
  return (
    <EmailShell
      preview={`"${props.galleryTitle}" hosting is paused`}
      heading="Your gallery hosting is paused"
    >
      <P>
        Hosting for “{props.galleryTitle}” has ended, so the public page is paused. Everything you
        made is safe: reactivate hosting to bring it back instantly, or export a static copy that is
        yours to keep and host anywhere.
      </P>
      <CtaLink href={props.manageUrl}>Reactivate or export</CtaLink>
    </EmailShell>
  );
}

export function ExportReadyEmail(props: {
  galleryTitle: string;
  downloadUrl: string;
}) {
  return (
    <EmailShell
      preview={`Your export of "${props.galleryTitle}" is ready`}
      heading="Your gallery export is ready"
    >
      <P>
        The static build of “{props.galleryTitle}” is ready. The zip contains everything the gallery
        needs — it runs on any static host with no server, and it belongs to you.
      </P>
      <CtaLink href={props.downloadUrl}>Download your gallery</CtaLink>
    </EmailShell>
  );
}

export function DonationReceiptEmail(props: {
  galleryTitle: string;
  amountCents: number;
  donorName?: string;
}) {
  return (
    <EmailShell
      preview={`New donation for "${props.galleryTitle}"`}
      heading="You received a donation"
    >
      <P>
        {props.donorName ? props.donorName : "A visitor"} donated {cents(props.amountCents)} after
        walking through “{props.galleryTitle}”.
      </P>
    </EmailShell>
  );
}

export function FeaturedDecisionEmail(props: {
  galleryTitle: string;
  approved: boolean;
  featuredUrl: string;
}) {
  return (
    <EmailShell
      preview={`Featuring decision for "${props.galleryTitle}"`}
      heading={props.approved ? "Your gallery is featured" : "About your featuring submission"}
    >
      {props.approved ? (
        <>
          <P>
            “{props.galleryTitle}” is now featured on our curated index. Thank you for sharing it.
          </P>
          <CtaLink href={props.featuredUrl}>See the featured page</CtaLink>
        </>
      ) : (
        <P>
          Thanks for submitting “{props.galleryTitle}” for featuring. We’re not able to include it
          right now, but it remains live for your visitors, and you’re welcome to submit again
          later.
        </P>
      )}
    </EmailShell>
  );
}

export function PurchaseReceiptEmail(props: {
  description: string;
  amountCents: number;
  studioUrl: string;
}) {
  return (
    <EmailShell preview="Your Wanderwall receipt" heading="Thanks for your purchase">
      <P>
        {props.description} — {cents(props.amountCents)}.
      </P>
      <CtaLink href={props.studioUrl}>Open Studio</CtaLink>
    </EmailShell>
  );
}
