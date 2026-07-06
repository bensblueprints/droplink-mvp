// BYO-SMTP mailer. Never throws — callers get { ok, error } and log it.
// If SMTP_HOST isn't configured this no-ops gracefully (used by admin UI to show a warning banner).
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

function smtpConfigured(env = process.env) {
  return !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

function buildTransport(env = process.env) {
  if (!nodemailer || !smtpConfigured(env)) return null;
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: Number(env.SMTP_PORT) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
  });
}

async function sendTransferEmail({ to, subject, text, html }, env = process.env) {
  if (!smtpConfigured(env)) {
    return { ok: false, error: 'SMTP not configured — set SMTP_HOST/SMTP_USER/SMTP_PASS to enable emailing links.' };
  }
  try {
    const transport = buildTransport(env);
    await transport.sendMail({
      from: env.SMTP_FROM || env.SMTP_USER,
      to,
      subject,
      text,
      html
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

module.exports = { sendTransferEmail, smtpConfigured };
