import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { SITE } from "@/lib/site";
import { LOGO_PNG_BASE64 } from "./logo-png";
import type { EmailDetail } from "./templates";

/**
 * Sending e-mail over SMTP. The details live only in server environment variables:
 *   SMTP_HOST, SMTP_PORT (587 or 465), SMTP_USER, SMTP_PASSWORD, SMTP_FROM ("Vize Başvuru Portalı <address@domain>")
 *   EMAIL_DETAIL: "full" (default) or "summary" — see templates.ts. "summary" on the live site.
 * If values are missing no e-mail is sent; in-app notifications are created in every case.
 */

export type SmtpConfig = { host: string; port: number; user: string; password: string; from: string };

export function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT?.trim() || "587");
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !user || !password || !from || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port, user, password, from };
}

export function isEmailConfigured(): boolean {
  return smtpConfig() !== null;
}

export function emailDetail(): EmailDetail {
  return process.env.EMAIL_DETAIL?.trim().toLocaleLowerCase("tr-TR") === "summary" ? "summary" : "full";
}

let cached: { key: string; transporter: Transporter } | null = null;

function transporter(config: SmtpConfig): Transporter {
  const key = `${config.host}:${config.port}:${config.user}`;
  if (cached?.key === key) return cached.transporter;
  const created = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 is direct TLS; STARTTLS is mandatory on other ports (no unencrypted sending).
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  cached = { key, transporter: created };
  return created;
}

/** Content id of the logo embedded in the e-mail ("cid:logo" in the HTML). Since it is embedded it shows even if the site is not live. */
export const EMAIL_LOGO_CID = "logo";

/**
 * The sender is written with a display name ("Vize Başvuru Portalı <noreply@example.com>"). If SMTP_FROM was entered as an
 * address only, the company name is added: a sender without a name lowers trust with some e-mail providers. A name, if given, is left alone.
 */
export function senderAddress(from: string, name: string): string | { name: string; address: string } {
  return from.includes("<") ? from : { name, address: from };
}

export async function sendEmail(to: string, message: { subject: string; text: string; html: string }): Promise<void> {
  const config = smtpConfig();
  if (!config) throw new Error("smtp_not_configured");
  await transporter(config).sendMail({
    from: senderAddress(config.from, SITE.companyName),
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: [{ filename: "logo.png", content: Buffer.from(LOGO_PNG_BASE64, "base64"), cid: EMAIL_LOGO_CID, contentType: "image/png" }],
  });
}
