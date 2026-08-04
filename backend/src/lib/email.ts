import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';
import { logger } from './logger';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Emails captured instead of sent, when running under test. Lets tests assert
 * on the real generated link without any network or SMTP dependency.
 */
const sentInTest: OutboundEmail[] = [];

export function getTestInbox(): readonly OutboundEmail[] {
  return sentInTest;
}

export function clearTestInbox(): void {
  sentInTest.length = 0;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!config.email.configured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.secure,
      auth: { user: config.email.smtp.user, pass: config.email.smtp.pass },
    });
  }
  return transporter;
}

/**
 * Sends an email through whichever transport is available:
 *
 *  - **test**    → captured in memory for assertions.
 *  - **SMTP set**→ real delivery. Provider-agnostic, so any free tier
 *                  (Brevo, Resend, Gmail app password, Mailtrap) works purely
 *                  through env vars, with no code change.
 *  - **no SMTP** → written to the structured log, including the action link, so
 *                  local development works before any provider is configured.
 *
 * The log fallback is a real development transport, not a stub of the auth
 * flow: the token it prints is the same single-use token the email would carry.
 *
 * Delivery failures are logged and swallowed. Callers are auth routes where a
 * dead mail provider must not turn into a 500 or leak whether an address exists.
 */
export async function sendEmail(message: OutboundEmail): Promise<void> {
  if (config.isTest) {
    sentInTest.push(message);
    return;
  }

  const tx = getTransporter();
  if (!tx) {
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      'EMAIL NOT SENT (SMTP unconfigured) — copy the link below to continue the flow locally',
    );
    return;
  }

  try {
    await tx.sendMail({ from: config.email.from, ...message });
    logger.info({ to: message.to, subject: message.subject }, 'Email sent');
  } catch (err) {
    logger.error({ err, to: message.to, subject: message.subject }, 'Email delivery failed');
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function layout(heading: string, body: string, actionUrl: string, actionLabel: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f6fb;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:20px">${heading}</h1>
    <p style="margin:0 0 24px;line-height:1.6;color:#334155">${body}</p>
    <a href="${actionUrl}" style="display:inline-block;background:#0052ff;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${actionLabel}</a>
    <p style="margin:24px 0 0;font-size:13px;color:#64748b">If the button doesn't work, paste this link into your browser:<br>
      <span style="word-break:break-all">${actionUrl}</span></p>
    <p style="margin:24px 0 0;font-size:13px;color:#64748b">If you didn't request this, you can safely ignore this email.</p>
  </div>
</body></html>`;
}

export function buildVerificationEmail(to: string, token: string): OutboundEmail {
  const url = `${config.publicAppUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Verify your AMIT Olympiad email address',
    text:
      `Welcome to AMIT Maths Olympiad!\n\n` +
      `Verify your email address to activate your account:\n${url}\n\n` +
      `This link expires in ${config.auth.emailVerifyTtlHours} hours.`,
    html: layout(
      'Verify your email address',
      `Welcome to AMIT Maths Olympiad! Confirm this address to activate your account. This link expires in ${config.auth.emailVerifyTtlHours} hours.`,
      url,
      'Verify my email',
    ),
  };
}

export function buildPasswordResetEmail(to: string, token: string): OutboundEmail {
  const url = `${config.publicAppUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Reset your AMIT Olympiad password',
    text:
      `We received a request to reset your AMIT Olympiad password.\n\n` +
      `Choose a new password here:\n${url}\n\n` +
      `This link expires in ${config.auth.passwordResetTtlMinutes} minutes and can only be used once.\n` +
      `If you didn't request this, ignore this email — your password will not change.`,
    html: layout(
      'Reset your password',
      `We received a request to reset your password. This link expires in ${config.auth.passwordResetTtlMinutes} minutes and can only be used once.`,
      url,
      'Choose a new password',
    ),
  };
}
