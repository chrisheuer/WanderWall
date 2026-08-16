import { Resend } from "resend";
import type { ReactElement } from "react";
import { env } from "@/lib/env";

/** All transactional email goes through Resend with React Email templates. */

let client: Resend | null = null;

function resend(): Resend {
  if (!client) client = new Resend(env().RESEND_API_KEY);
  return client;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  react: ReactElement;
}): Promise<void> {
  if (!env().RESEND_API_KEY) {
    console.warn(`[email] RESEND_API_KEY unset; skipping "${opts.subject}" to ${opts.to}`);
    return;
  }
  const { error } = await resend().emails.send({
    from: env().EMAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    react: opts.react,
  });
  if (error) throw new Error(`resend send failed: ${error.message}`);
}
