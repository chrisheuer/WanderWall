import { createElement } from "react";
import { sendEmail } from "@/lib/email";
import * as templates from "@/emails";

/**
 * Generic queued Resend dispatch. Templates are referenced by name so job
 * payloads stay JSON-serializable in Postgres.
 */

export interface SendEmailJobData {
  to: string;
  subject: string;
  template: keyof typeof templates;
  props: Record<string, unknown>;
}

export async function runSendEmailJob(data: SendEmailJobData): Promise<void> {
  const Template = templates[data.template];
  if (!Template) throw new Error(`unknown email template: ${data.template}`);
  await sendEmail({
    to: data.to,
    subject: data.subject,
    react: createElement(Template as never, data.props as never),
  });
}
