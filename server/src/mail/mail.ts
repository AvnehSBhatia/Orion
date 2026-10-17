import nodemailer from "nodemailer";
import { config } from "@/config";

export type Mail = { to: string; subject: string; text: string; html: string };

/** What actually sends: nodemailer's SMTP transport in the app, a fake in tests. */
export type MailTransport = { sendMail(m: Mail & { from: string }): Promise<unknown> };

/** sent: the SMTP server took it. not_configured: no SMTP_URL. failed: the send threw (logged). */
export type MailResult = "sent" | "not_configured" | "failed";

const g = globalThis as typeof globalThis & { __orionMail?: { url: string; transport: MailTransport }; __orionMailOverride?: MailTransport | null };

function transport(): MailTransport | null {
  if (g.__orionMailOverride !== undefined) return g.__orionMailOverride;
  const url = config.smtpUrl;
  if (!url) return null;
  // One transport per URL (survives dev hot reloads; a changed URL gets a new one).
  if (g.__orionMail?.url !== url) g.__orionMail = { url, transport: nodemailer.createTransport(url) };
  return g.__orionMail.transport;
}

/** Tests: send through a fake. null acts as "not configured"; undefined goes back to SMTP_URL. */
export function setMailTransport(t: MailTransport | null | undefined): void {
  g.__orionMailOverride = t;
}

/** Email can go out: SMTP_URL is set (or a test transport is in place). */
export const mailOn = (): boolean => transport() !== null;

/**
 * Sends one email. Never throws: a failed send is logged and reported, so the caller can fall back to showing the
 * link. Without SMTP_URL it only logs; in development the body (with its link) is logged too, never in production.
 */
export async function sendMail(m: Mail): Promise<MailResult> {
  const t = transport();
  if (!t) {
    if (process.env.NODE_ENV === "production") console.warn(`[mail] email is not configured (SMTP_URL), not sending "${m.subject}"`);
    else if (!process.env.VITEST) console.info(`[mail] email is not configured (SMTP_URL). Would send "${m.subject}" to ${m.to}:\n${m.text}`);
    return "not_configured";
  }
  try {
    await t.sendMail({ from: config.mailFrom, ...m });
    return "sent";
  } catch (err) {
    // The error text can echo the recipient, never the body, so it is safe to log.
    console.error(`[mail] sending "${m.subject}" failed:`, err instanceof Error ? err.message : err);
    return "failed";
  }
}
