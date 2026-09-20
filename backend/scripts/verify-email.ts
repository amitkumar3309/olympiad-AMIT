/**
 * Checks that SMTP is configured correctly, without touching the database or
 * registering a student.
 *
 *   npm run verify:email                 -> config + connection check only
 *   npm run verify:email you@example.com -> also sends one real test email
 *
 * Sending is opt-in via an explicit recipient so this can never mail someone by
 * accident. Secrets are masked in all output.
 */
import nodemailer from 'nodemailer';
import { config } from '../src/config';
import { smtpTransportOptions } from '../src/lib/email';

function mask(value: string | undefined): string {
  if (!value) return '(not set)';
  if (value.length <= 6) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}${'*'.repeat(Math.min(12, value.length - 6))}${value.slice(-3)}`;
}

async function main(): Promise<void> {
  const recipient = process.argv[2];

  console.log('\n--- SMTP configuration ---');
  console.log(`  SMTP_HOST   : ${config.email.smtp.host ?? '(not set)'}`);
  console.log(`  SMTP_PORT   : ${config.email.smtp.port ?? '(not set)'}`);
  console.log(`  SMTP_USER   : ${config.email.smtp.user ?? '(not set)'}`);
  console.log(`  SMTP_PASS   : ${mask(config.email.smtp.pass)}`);
  console.log(`  SMTP_SECURE : ${config.email.smtp.secure}`);
  console.log(`  EMAIL_FROM  : ${config.email.from}`);
  console.log(`  FRONTEND_URL: ${config.publicAppUrl}   <- emailed links are built from this`);

  if (!config.email.configured) {
    console.log('\nRESULT: SMTP is NOT configured.');
    console.log('Emails will be written to the server log instead of being sent.');
    console.log('Add SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS to backend/.env.');
    process.exitCode = 1;
    return;
  }

  // The same options the running app uses, imported rather than repeated. This script
  // used to build its own transporter, which meant the check an owner runs to prove
  // SMTP works was exercising a connection with none of the app's timeouts — so it
  // could pass against a provider the app would give up on.
  const transporter = nodemailer.createTransport(smtpTransportOptions());

  console.log('\n--- Connection check ---');
  const connectStartedAt = Date.now();
  try {
    await transporter.verify();
    console.log(`  Connected and authenticated successfully in ${Date.now() - connectStartedAt} ms.`);
    console.log('  (That is the fixed cost of one delivery: DNS, TCP, STARTTLS and AUTH.)');
  } catch (err) {
    console.log(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    console.log('\nCommon causes:');
    console.log('  - Wrong SMTP_PASS (the key is shown only once; generate a new one if unsure)');
    console.log('  - SMTP_USER is not the SMTP login (it usually ends in @smtp-brevo.com,');
    console.log('    and is NOT the same as your sender address)');
    console.log('  - SMTP_SECURE=true with port 587 (use false for 587, true only for 465)');
    process.exitCode = 1;
    return;
  }

  if (!recipient) {
    console.log('\nRESULT: configuration looks good.');
    console.log('To send one real test email, re-run with an address you can read:');
    console.log('  npm run verify:email you@example.com');
    return;
  }

  console.log(`\n--- Sending a test email to ${recipient} ---`);
  const sendStartedAt = Date.now();
  try {
    const info = await transporter.sendMail({
      from: config.email.from,
      to: recipient,
      subject: 'AMIT Olympiad — SMTP test',
      text:
        'This is a test email from your AMIT Olympiad backend.\n\n' +
        'If you can read this, verification and password-reset emails will reach students.',
    });
    console.log(`  Accepted by the provider in ${Date.now() - sendStartedAt} ms. Message id: ${info.messageId}`);
    console.log('\nRESULT: sent. Check the inbox (and the spam folder) for that address.');
    console.log('If that figure is small but students still wait, the delay is at the provider or');
    console.log('the recipient mailbox, not in this application — /admin/email-deliveries shows');
    console.log('the same split for real sends (providerMs versus queuedForMs).');
    console.log('If it never arrives, the usual cause is that EMAIL_FROM is not an address');
    console.log('you authorised in your provider dashboard.');
  } catch (err) {
    console.log(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    console.log('\nIf this mentions the sender, the address in EMAIL_FROM has not been');
    console.log('authorised with your provider yet.');
    process.exitCode = 1;
  }
}

void main();
