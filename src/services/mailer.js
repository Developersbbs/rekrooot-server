import nodemailer from "nodemailer";
import { ENV } from "../config/env.js";

function hasSmtpConfig() {
  return Boolean(
    ENV.NEWUSER_SMTP_HOST &&
      ENV.NEWUSER_SMTP_PORT &&
      ENV.NEWUSER_MAIL_FROM &&
      (ENV.NEWUSER_SMTP_USER ? ENV.NEWUSER_SMTP_PASS : true),
  );
}

function getMissingSmtpKeys() {
  const missing = [];

  if (!ENV.NEWUSER_SMTP_HOST) missing.push("NEWUSER_SMTP_HOST");
  if (!ENV.NEWUSER_SMTP_PORT || Number.isNaN(ENV.NEWUSER_SMTP_PORT)) missing.push("NEWUSER_SMTP_PORT");
  if (ENV.NEWUSER_SMTP_USER && !ENV.NEWUSER_SMTP_PASS) missing.push("NEWUSER_SMTP_PASS");
  if (!ENV.NEWUSER_MAIL_FROM) missing.push("NEWUSER_MAIL_FROM");

  return missing;
}

let cachedTransporter = null;

function getTransporter() {
  if (!hasSmtpConfig()) return null;
  if (cachedTransporter) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: ENV.NEWUSER_SMTP_HOST,
    port: ENV.NEWUSER_SMTP_PORT,
    secure: ENV.NEWUSER_SMTP_SECURE,
    auth: ENV.NEWUSER_SMTP_USER
      ? {
          user: ENV.NEWUSER_SMTP_USER,
          pass: ENV.NEWUSER_SMTP_PASS,
        }
      : undefined,
  });

  return cachedTransporter;
}

export async function sendInvitationEmail({
  to,
  inviteUrl,
}) {
  const transporter = getTransporter();
  if (!transporter) {
    const missing = getMissingSmtpKeys();
    throw new Error(
      missing.length
        ? `SMTP is not configured (missing: ${missing.join(", ")})`
        : "SMTP is not configured",
    );
  }

  const subject = "You're invited to Rekrooot";
  const text = `You have been invited to join Rekrooot.\n\nCreate your account here: ${inviteUrl}\n\nThis link will expire soon.`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.4;">
      <h2>You're invited to Rekrooot</h2>
      <p>You have been invited to join Rekrooot.</p>
      <p>
        <a href="${inviteUrl}" target="_blank" rel="noreferrer">Create your account</a>
      </p>
      <p style="color:#666; font-size: 12px;">This link will expire soon.</p>
    </div>
  `;

  const info = await transporter.sendMail({
    from: ENV.NEWUSER_MAIL_FROM,
    to,
    subject,
    text,
    html,
  });

  return { messageId: info.messageId };
}
