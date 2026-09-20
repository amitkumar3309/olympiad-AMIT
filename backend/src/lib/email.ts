import nodemailer from 'nodemailer';
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

/**
 * How long one delivery may spend at each stage, and why these numbers rather than
 * nodemailer's.
 *
 * The defaults are 2 minutes to connect, 30 seconds for the greeting and **10 minutes**
 * on the socket. That last figure is not merely slow, it is *unsafe here*:
 * `services/emailOutbox.ts` makes a claimed row claimable again after 60 seconds, so a
 * send still hanging on nodemailer's default could be overtaken by a second drain
 * claiming the same row — and the student receives two verification links, of which
 * only the newest works, which is the churn recorded in `TROUBLESHOOTING.md`.
 *
 * The worst case below is 8 + 8 + 15 = 31 seconds, comfortably inside that 60-second
 * visibility timeout, so a hung provider fails and is retried rather than overlapping
 * itself. They are constants rather than environment variables deliberately: they are
 * not a tuning knob, they are the arithmetic that keeps the queue correct, and a
 * deployment that raised them would reintroduce the duplicate.
 */
const SMTP_TIMEOUTS = {
  connectionTimeout: 8_000,
  greetingTimeout: 8_000,
  socketTimeout: 15_000,
} as const;

/**
 * The transport configuration, in one place so nothing can verify a *different*
 * transport from the one production uses.
 *
 * `scripts/verify-email.ts` built its own `createTransport` call, which meant the
 * check an owner runs to prove SMTP works was exercising a connection with none of
 * the timeouts above. Exported so both go through the same options.
 */
export function smtpTransportOptions() {
  return {
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    secure: config.email.smtp.secure,
    auth: { user: config.email.smtp.user, pass: config.email.smtp.pass },
    ...SMTP_TIMEOUTS,
  };
}

/** What one delivery cost and who handled it. Checkpoint 5 of the timing trail. */
export interface DeliveryReceipt {
  /** Wall-clock ms inside the provider request itself — never the queue wait. */
  providerMs: number;
  /** `log` is the unconfigured-SMTP development transport, not a failure. */
  transport: 'smtp' | 'log' | 'test';
  /** The provider's own id when it gave one. Never a token, never a link. */
  messageId: string | null;
}

/**
 * One open transport, good for a batch of messages, closed by whoever opened it.
 *
 * **Only `services/emailOutbox.ts` may open one.** Everything else enqueues, so that
 * no user-facing request ever waits on SMTP.
 *
 * ## Why a session rather than a module-level transporter
 *
 * Without `pool: true` nodemailer opens a fresh TCP + STARTTLS + AUTH handshake for
 * every message — measured at roughly 300–600 ms against the documented Brevo relay.
 * A drain sending ten queued messages therefore paid that ten times.
 *
 * A *module-level* pool would be worse than either, though, and that is the trap worth
 * recording: a pooled socket cannot survive a container freeze, so the next drain on a
 * thawed container would reach for a dead connection and turn a 400 ms send into a
 * **failed** one — trading half a second for a 60-second-plus retry. Scoping the pool
 * to a single drain gets the batch saving with no socket that outlives the work it was
 * opened for. A single-message drain, which is the common case, costs exactly what it
 * did before.
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
export interface MailSession {
  /**
   * Hands one message to the transport and **throws if it did not go**.
   *
   * That is the whole reason the outbox can work. The `sendEmail()` this replaced
   * logged a delivery failure and returned normally, so its callers could not tell a
   * sent message from a lost one — a dead provider silently cost a student their
   * verification link, with no record and nothing to retry. A queue whose worker
   * cannot detect failure is not a queue.
   */
  deliver(message: OutboundEmail): Promise<DeliveryReceipt>;
  close(): Promise<void>;
}

function testSession(): MailSession {
  return {
    async deliver(message) {
      const startedAt = Date.now();
      if (testFailuresRemaining > 0) {
        testFailuresRemaining -= 1;
        throw new Error('Simulated SMTP failure');
      }
      sentInTest.push(message);
      return { providerMs: Date.now() - startedAt, transport: 'test', messageId: null };
    },
    async close() {
      /* nothing was opened */
    },
  };
}

function logSession(): MailSession {
  return {
    async deliver(message) {
      const startedAt = Date.now();
      logger.info(
        { to: message.to, subject: message.subject, body: message.text },
        'EMAIL NOT SENT (SMTP unconfigured) — copy the link below to continue the flow locally',
      );
      return { providerMs: Date.now() - startedAt, transport: 'log', messageId: null };
    },
    async close() {
      /* nothing was opened */
    },
  };
}

function smtpSession(): MailSession {
  // Deliberately unannotated: `createTransport` is overloaded, and letting it infer
  // keeps the pooled variant's own `SentMessageInfo` rather than widening it.
  const transporter = nodemailer.createTransport({
    ...smtpTransportOptions(),
    // Scoped to this session; see the note on `MailSession`.
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
  });

  return {
    async deliver(message) {
      const startedAt = Date.now();
      // Deliberately not wrapped: the caller records the failure against the outbox
      // row, schedules a retry, and is the only place that decides when to give up.
      const info = await transporter.sendMail({ from: config.email.from, ...message });
      const providerMs = Date.now() - startedAt;

      const messageId = typeof info.messageId === 'string' ? info.messageId : null;
      logger.info({ to: message.to, subject: message.subject, providerMs, messageId }, 'Email sent');
      return { providerMs, transport: 'smtp', messageId };
    },
    async close() {
      transporter.close();
    },
  };
}

/** Opens the transport that suits the environment. See `MailSession`. */
export function openMailSession(): MailSession {
  if (config.isTest) return testSession();
  if (!config.email.configured) return logSession();
  return smtpSession();
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Escapes text that is about to be interpolated into the HTML part.
 *
 * Not a hardening afterthought — it fixes a live rendering bug. `buildNotificationEmail`
 * puts a **staff-authored** title and body straight into the markup, so an announcement
 * reading "everyone scoring < 50 should revise" had its remaining sentence swallowed by
 * the browser as an unclosed tag. The same hole would let an administrator put arbitrary
 * markup, including a link of their own choosing, into a message that arrives under this
 * platform's name.
 *
 * Applied to every interpolation, including URLs we built ourselves: a verification token
 * is hex and an app path is ours, but "this value is safe today" is the assumption that
 * makes the *next* caller unsafe.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The brand colours, as literals, because an email cannot read a CSS variable. */
const BRAND = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  line: '#e2e8f0',
  page: '#f4f6fb',
  primary: '#0052ff',
} as const;

interface EmailLayout {
  heading: string;
  /** Plain text. Newlines survive via `white-space: pre-line`. */
  body: string;
  /** The line under the rule. Always present — every message says why it was sent. */
  footer: string;
  actionUrl?: string;
  actionLabel?: string;
  /**
   * The one line shown beside the subject in an inbox list, before anything is opened.
   * Without it, clients preview the first body text they find, which on a message like
   * this is the heading repeated.
   */
  preheader: string;
}

/**
 * The shared shell for every email this product sends.
 *
 * `actionUrl` is optional because a notification email often has nothing to click —
 * "your results are out" is worth sending on its own, and a button pointing at a page
 * the reader has to sign in to is not always an improvement.
 *
 * ## Why it looks like 2005 HTML
 *
 * Because email clients do. The outer `<table>` and the `<table>`-wrapped button are the
 * two places Outlook's Word rendering engine still refuses to centre or paint a `<div>`
 * correctly, and a CTA that renders as bare blue text in Outlook is a verification link a
 * proportion of students will not recognise as the button they were told to press. Every
 * style is inline for the same reason: `<style>` blocks are stripped by several clients.
 *
 * ## What it deliberately does not contain
 *
 * **No image of any kind**, so nothing is blocked by default, nothing waits on a network
 * fetch, and there is no logo to go missing — the wordmark is text. **No external
 * stylesheet or web font**; the stack degrades to whatever the device has. **No tracking
 * pixel, no click-wrapped redirect, no analytics query string**: this is transactional
 * mail to children, the link is single-use, and a redirect through a tracker would also
 * make the URL unreadable at exactly the moment a cautious parent wants to read it. The
 * whole document is about 3 KB.
 */
function layout(input: EmailLayout): string {
  const action =
    input.actionUrl && input.actionLabel
      ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
          <tr>
            <td align="center" bgcolor="${BRAND.primary}" style="border-radius:8px">
              <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(input.actionLabel)}</a>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 4px;font-size:13px;color:${BRAND.muted}">Or paste this link into your browser:</p>
        <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${escapeHtml(input.actionUrl)}" style="color:${BRAND.primary}">${escapeHtml(input.actionUrl)}</a></p>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page}">
    <tr>
      <td align="center" style="padding:24px 12px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
          <tr>
            <td style="padding:0 4px 16px">
              <span style="font-size:20px;font-weight:700;letter-spacing:0.12em;color:${BRAND.ink}">A.M.I.T</span>
              <span style="font-size:13px;letter-spacing:0.08em;color:${BRAND.muted}">&nbsp;MATHS OLYMPIAD</span>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid ${BRAND.line};border-radius:12px;padding:32px 28px">
              <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${BRAND.ink}">${escapeHtml(input.heading)}</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${BRAND.body};white-space:pre-line">${escapeHtml(input.body)}</p>
              ${action}
              <p style="margin:0;padding-top:20px;border-top:1px solid ${BRAND.line};font-size:13px;line-height:1.6;color:${BRAND.muted}">${escapeHtml(input.footer)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 4px 0;font-size:12px;line-height:1.6;color:${BRAND.muted}">
              Need help? Email <a href="mailto:${escapeHtml(config.support.email)}" style="color:${BRAND.muted}">${escapeHtml(config.support.email)}</a> or call ${escapeHtml(config.support.phone)}.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** The plain-text sign-off, so both parts of a message carry the same contact route. */
function textFooter(): string {
  return `\n\nNeed help? Email ${config.support.email} or call ${config.support.phone}.`;
}

/**
 * The message standing between registering and being able to use the account at all.
 *
 * Login requires a verified address, so this is not a courtesy — it is the only route
 * in. Everything in it is therefore about getting one link pressed: the expiry and the
 * single-use rule are stated **before** the button rather than in the footer, because
 * "I clicked it and it said already used" is the most common way this goes wrong, and
 * the preheader carries the instruction so it is legible from the inbox list without
 * opening anything.
 */
export function buildVerificationEmail(to: string, token: string): OutboundEmail {
  const url = `${config.publicAppUrl}/verify-email?token=${encodeURIComponent(token)}`;
  const hours = config.auth.emailVerifyTtlHours;

  return {
    to,
    subject: 'Verify your email to activate your AMIT Olympiad account',
    text:
      `Welcome to A.M.I.T Maths Olympiad.\n\n` +
      `Verify your email address to activate your account:\n${url}\n\n` +
      `This link works for ${hours} hours and can be used once. You will not be able to sign in until it is used.\n\n` +
      `If you didn't create this account, ignore this email — nothing further will happen.` +
      textFooter(),
    html: layout({
      preheader: `Confirm your email address to activate your account. The link works for ${hours} hours.`,
      heading: 'Verify your email address',
      body:
        `Welcome to A.M.I.T Maths Olympiad. Confirm this address to activate your account — you will not be able to sign in until you do.\n\n` +
        `This link works for ${hours} hours and can be used once.`,
      actionUrl: url,
      actionLabel: 'Verify my email',
      footer: "If you didn't create this account, you can safely ignore this email — nothing further will happen.",
    }),
  };
}

export function buildPasswordResetEmail(to: string, token: string): OutboundEmail {
  const url = `${config.publicAppUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const minutes = config.auth.passwordResetTtlMinutes;

  return {
    to,
    subject: 'Reset your AMIT Olympiad password',
    text:
      `We received a request to reset your A.M.I.T Maths Olympiad password.\n\n` +
      `Choose a new password here:\n${url}\n\n` +
      `This link works for ${minutes} minutes and can be used once.\n\n` +
      `If you didn't request this, ignore this email — your password will not change.` +
      textFooter(),
    html: layout({
      preheader: `Choose a new password. The link works for ${minutes} minutes.`,
      heading: 'Reset your password',
      body:
        `We received a request to reset your password.\n\n` +
        `This link works for ${minutes} minutes and can be used once.`,
      actionUrl: url,
      actionLabel: 'Choose a new password',
      footer:
        "If you didn't request this, you can safely ignore this email — your password will not change.",
    }),
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

  const textPreference = input.manageable
    ? `\n\n—\nTurn these emails off under Profile > Notification preferences.`
    : `\n\n—\nThis is a security and account message and is always sent.`;

  return {
    to: input.to,
    subject: input.title,
    text: `${input.body}${url ? `\n\n${url}` : ''}${textPreference}${textFooter()}`,
    html: layout({
      // The notice's own first line, which is what a reader is deciding on from the
      // inbox list — not a rewrite of the subject sitting next to it.
      preheader: input.body.split('\n')[0]?.slice(0, 140) ?? input.title,
      heading: input.title,
      body: input.body,
      ...(url && label ? { actionUrl: url, actionLabel: label } : {}),
      footer,
    }),
  };
}
