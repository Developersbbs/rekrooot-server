import nodemailer from "nodemailer";
import { ENV } from "../config/env.js";

function hasSmtpConfig() {
  return Boolean(
    ENV.SMTP_HOST &&
      ENV.SMTP_PORT &&
      ENV.NEWUSER_MAIL_FROM &&
      (ENV.NEWUSER_SMTP_USER ? ENV.NEWUSER_SMTP_PASS : true),
  );
}

function getMissingSmtpKeys() {
  const missing = [];

  if (!ENV.SMTP_HOST) missing.push("NEWUSER_SMTP_HOST");
  if (!ENV.SMTP_PORT || Number.isNaN(ENV.NEWUSER_SMTP_PORT)) missing.push("NEWUSER_SMTP_PORT");
  if (ENV.NEWUSER_SMTP_USER && !ENV.NEWUSER_SMTP_PASS) missing.push("NEWUSER_SMTP_PASS");
  if (!ENV.NEWUSER_MAIL_FROM) missing.push("NEWUSER_MAIL_FROM");

  return missing;
}

let cachedTransporter = null;

function getTransporter() {
  if (!hasSmtpConfig()) return null;
  if (cachedTransporter) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: ENV.SMTP_HOST,
    port: ENV.SMTP_PORT,
    secure: ENV.SMTP_SECURE,
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
  const html = `<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Create Account Email</title><style>body{font-family:Arial,sans-serif;margin:0;padding:20px;background-color:#f4f4f4}.container{background-color:#fff;padding:20px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1)}.header{text-align:center}.button{margin:20px 0;text-align:center}.button a{background-color:#fb8404;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px}.button a:hover{background-color:#2f4858}</style></head><body><div class='container'><h1 class='header'>Welcome to Rekrooot!</h1><p>Dear User,</p><p>We're thrilled to have you on board. To get started, please create your account by clicking the button below:</p><div class='button'><a href='${inviteUrl}'>Create Your Account</a></div><p>If you encounter any issues or have questions, feel free to reach out to our support team.</p><p>Best regards,<br>The Rekrooot Team</p></div></body></html>`;
  const info = await transporter.sendMail({
    from: ENV.NEWUSER_MAIL_FROM,
    to,
    subject,
    text,
    html,
  });

  return { messageId: info.messageId };
}
