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
  testFailuresRemaining = 0;
}

/**
 * How many of the next delivery attempts should fail, under test only.
 *
 * Failure handling is the half of an email system that is never exercised by
 * accident: the happy path runs on every registration, and the retry path runs
 * only when somebody's provider is down. `Infinity` fails every attempt; a finite
 * count fails that many and then succeeds, which is how a *recovered* delivery is
 * tested rather than only a permanently broken one.
 *
 * Deliberately not driven by an environment variable — it must be impossible to
 * turn on in production, so it lives behind `config.isTest` and is reset by
 * `clearTestInbox()` in the shared test setup.
 */
let testFailuresRemaining = 0;

export function failNextDeliveries(count: number): void {
  if (!config.isTest) throw new Error('failNextDeliveries() is a test-only hook');
  testFailuresRemaining = count;
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
 * Hands one message to whichever transport is available, and **throws if it did
 * not go**.
 *
 * This is the one difference from the function it replaced, and the whole reason
 * the outbox can work. The previous `sendEmail()` logged a delivery failure and
 * returned normally, so its callers could not tell a sent message from a lost one
 * — which meant a dead provider silently cost a student their verification link,
 * with no record and nothing to retry. A queue whose worker cannot detect failure
 * is not a queue.
 *
 * Only `services/emailOutbox.ts` may call this. Everything else enqueues, so that
 * no user-facing request ever waits on SMTP.
 *
 *  - **test**     → captured in memory; fails on demand via `failNextDeliveries()`.
 *  - **SMTP set** → real delivery. Provider-agnostic, so any free tier (Brevo,
 *                   Resend, SendGrid, Gmail app password, Mailtrap) works purely
 *                   through env vars with no code change.
 *  - **no SMTP**  → written to the structured log, including any action link, and
 *                   reported as delivered. That is a real development transport,
 *                   not a stub: the token it prints is the same single-use token
 *                   the email would have carried. Treating it as *failed* would
 *                   fill the outbox with permanent failures on every developer
 *                   machine that has never configured a provider.
 */
export async function deliverEmail(message: OutboundEmail): Promise<void> {
  if (config.isTest) {
    if (testFailuresRemaining > 0) {
      testFailuresRemaining -= 1;
      throw new Error('Simulated SMTP failure');
    }
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

  // Deliberately not wrapped: the caller records the failure against the outbox
  // row, schedules a retry, and is the only place that decides when to give up.
  await tx.sendMail({ from: config.email.from, ...message });
  logger.info({ to: message.to, subject: message.subject }, 'Email sent');
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * The shared shell. `actionUrl` is optional because a notification email often has
 * nothing to click — "your results are out" is worth sending on its own, and a
 * button pointing at a page the reader has to sign in to is not always an
 * improvement.
 */
function layout(heading: string, body: string, actionUrl?: string, actionLabel?: string): string {
  const action =
    actionUrl && actionLabel
      ? `<a href="${actionUrl}" style="display:inline-block;background:#0052ff;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${actionLabel}</a>
    <p style="margin:24px 0 0;font-size:13px;color:#64748b">If the button doesn't work, paste this link into your browser:<br>
      <span style="word-break:break-all">${actionUrl}</span></p>`
      : '';

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f6fb;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:20px">${heading}</h1>
    <p style="margin:0 0 24px;line-height:1.6;color:#334155;white-space:pre-line">${body}</p>
    ${action}
  </div>
</body></html>`;
}

function withFooter(heading: string, body: string, footer: string, actionUrl?: string, actionLabel?: string): string {
  return layout(heading, body, actionUrl, actionLabel).replace(
    '</div>\n</body>',
    `<p style="margin:24px 0 0;font-size:13px;color:#64748b">${footer}</p>
  </div>
</body>`,
  );
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
    html: withFooter(
      'Verify your email address',
      `Welcome to AMIT Maths Olympiad! Confirm this address to activate your account. This link expires in ${config.auth.emailVerifyTtlHours} hours.`,
      "If you didn't request this, you can safely ignore this email.",
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
    html: withFooter(
      'Reset your password',
      `We received a request to reset your password. This link expires in ${config.auth.passwordResetTtlMinutes} minutes and can only be used once.`,
      "If you didn't request this, you can safely ignore this email — your password will not change.",
      url,
      'Choose a new password',
    ),
  };
}

/**
 * The email form of one notification.
 *
 * Same title and body as the in-app copy, on purpose: two wordings of the same
 * event is how a student ends up believing they are two events. `link` is a
 * *relative* app path from the notification, resolved against `publicAppUrl`
 * here — the notification never stores an absolute URL, so a change of domain
 * cannot leave old rows pointing at the wrong host.
 *
 * `manageable` decides the footer. A notification the student may switch off is
 * told so and where; a security or transactional one is told plainly that it is
 * not optional, which is more honest than an unsubscribe link that would refuse.
 */
export function buildNotificationEmail(input: {
  to: string;
  title: string;
  body: string;
  link?: string | null;
  actionLabel?: string;
  manageable: boolean;
}): OutboundEmail {
  const url = input.link ? `${config.publicAppUrl}${input.link}` : undefined;
  const label = url ? (input.actionLabel ?? 'Open AMIT Olympiad') : undefined;

  const footer = input.manageable
    ? `You are receiving this because email updates are on for your account. You can turn them off under Profile → Notification preferences.`
    : `This is a security and account message, so it is always sent and cannot be switched off.`;

  const textFooter = input.manageable
    ? `\n\n—\nTurn these emails off under Profile > Notification preferences.`
    : `\n\n—\nThis is a security and account message and is always sent.`;

  return {
    to: input.to,
    subject: input.title,
    text: `${input.body}${url ? `\n\n${url}` : ''}${textFooter}`,
    html: withFooter(input.title, input.body, footer, url, label),
  };
}
