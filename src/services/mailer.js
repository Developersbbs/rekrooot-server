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
  if (!ENV.SMTP_PORT || Number.isNaN(ENV.SMTP_PORT)) missing.push("SMTP_PORT");
  if (ENV.NEWUSER_SMTP_USER && !ENV.NEWUSER_SMTP_PASS) missing.push("NEWUSER_SMTP_PASS");
  if (!ENV.NEWUSER_MAIL_FROM) missing.push("NEWUSER_MAIL_FROM");

  return missing;
}

function getForgotPasswordTransporter() {
  if (!ENV.SMTP_USER || !ENV.FROM_EMAIL) {
    throw new Error("SMTP is not configured for forgot password (missing: SMTP_USER or FROM_EMAIL)");
  }
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: ENV.SMTP_USER,
      pass: ENV.SMTP_PASS,
    },
  });
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

const ROLE_ID_TO_LABEL = {
  1: "Recruiter Admin",
  2: "Lead Recruiter",
  3: "Recruiter",
};

export async function sendInvitationEmail({
  to,
  inviteUrl,
  role,
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

  const roleLabel = ROLE_ID_TO_LABEL[role] || "User";
  const subject = "You're invited to Rekrooot";
  const text = `Dear ${roleLabel},\n\nYou have been invited to join Rekrooot as a ${roleLabel}.\n\nCreate your account here: ${inviteUrl}\n\nThis link will expire in 7 days.`;
  const html = `<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Create Account Email</title><style>body{font-family:Arial,sans-serif;margin:0;padding:20px;background-color:#f4f4f4}.container{background-color:#fff;padding:30px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1);max-width:600px;margin:0 auto}.header{text-align:center;margin-bottom:24px}.badge{display:inline-block;background:#fb8404;color:#fff;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;margin-bottom:12px}.button{margin:24px 0;text-align:center}.button a{background-color:#fb8404;color:#fff;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;display:inline-block}.footer{margin-top:24px;font-size:12px;color:#9ca3af;text-align:center}</style></head><body><div class='container'><div class='header'><div class='badge'>${roleLabel}</div><h1 style='color:#2f4858;margin:8px 0 0'>Welcome to Rekrooot!</h1></div><p>Dear <strong>${roleLabel}</strong>,</p><p>You have been invited to join the Rekrooot platform as a <strong>${roleLabel}</strong>. To get started, please create your account by clicking the button below:</p><div class='button'><a href='${inviteUrl}'>Create Your Account</a></div><p>This invitation link will expire in <strong>7 days</strong>. If you encounter any issues or have questions, feel free to reach out to our support team.</p><p>Best regards,<br><strong>The Rekrooot Team</strong></p><div class='footer'>Powered by Rekrooot Recruitment Platform</div></div></body></html>`;
  const info = await transporter.sendMail({
    from: ENV.NEWUSER_MAIL_FROM,
    to,
    subject,
    text,
    html,
  });

  return { messageId: info.messageId };
}

export async function sendPasswordResetEmailSMTP({ to, resetUrl }) {
  const transporter = getForgotPasswordTransporter();

  const fromAddress = ENV.FROM_NAME
    ? `"${ENV.FROM_NAME}" <${ENV.FROM_EMAIL}>`
    : ENV.FROM_EMAIL;

  const subject = "Reset your Rekrooot password";
  const text = `You requested a password reset for your Rekrooot account.\n\nClick the link below to set a new password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.\n\nBest regards,\nThe Rekrooot Team`;
  const html = `<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Password Reset</title><style>body{font-family:Arial,sans-serif;margin:0;padding:20px;background-color:#f4f4f4}.container{background-color:#fff;padding:30px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1);max-width:600px;margin:0 auto}.header{text-align:center;margin-bottom:24px}.button{margin:24px 0;text-align:center}.button a{background-color:#fb8404;color:#fff;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;display:inline-block}.footer{margin-top:24px;font-size:12px;color:#9ca3af;text-align:center}</style></head><body><div class='container'><div class='header'><h1 style='color:#2f4858'>Password Reset</h1></div><p>Hi,</p><p>We received a request to reset the password for your <strong>Rekrooot</strong> account associated with <strong>${to}</strong>.</p><p>Click the button below to set a new password. This link is valid for <strong>1 hour</strong>.</p><div class='button'><a href='${resetUrl}'>Reset Password</a></div><p>If you didn't request a password reset, you can safely ignore this email — your password will remain unchanged.</p><p>Best regards,<br><strong>The Rekrooot Team</strong></p><div class='footer'>Powered by Rekrooot Recruitment Platform</div></div></body></html>`;

  const info = await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    text,
    html,
  });

  return { messageId: info.messageId };
}

export async function sendInterviewerWelcomeEmail({ to, name, signupUrl }) {
  const transporter = getTransporter();
  if (!transporter) {
    const missing = getMissingSmtpKeys();
    throw new Error(
      missing.length
        ? `SMTP is not configured (missing: ${missing.join(", ")})`
        : "SMTP is not configured",
    );
  }

  const subject = "You've been added as an Interviewer on Rekrooot";
  const text = `Hi ${name},\n\nYou have been added as an interviewer on Rekrooot.\n\nPlease create your account using the link below:\n${signupUrl}\n\nBest regards,\nThe Rekrooot Team`;
  const html = `<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Interviewer Welcome</title><style>body{font-family:Arial,sans-serif;margin:0;padding:20px;background-color:#f4f4f4}.container{background-color:#fff;padding:30px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1);max-width:600px;margin:0 auto}.header{text-align:center;margin-bottom:24px}.header h1{color:#2f4858;margin:0}.badge{display:inline-block;background:#fb8404;color:#fff;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;margin-bottom:16px}.button{margin:24px 0;text-align:center}.button a{background-color:#fb8404;color:#fff;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;display:inline-block}.button a:hover{background-color:#2f4858}.footer{margin-top:24px;font-size:12px;color:#9ca3af;text-align:center}</style></head><body><div class='container'><div class='header'><div class='badge'>Interviewer Access</div><h1>Welcome to Rekrooot!</h1></div><p>Hi <strong>${name}</strong>,</p><p>You have been added as an <strong>Interviewer</strong> on the Rekrooot platform. To get started, please create your account by clicking the button below:</p><div class='button'><a href='${signupUrl}'>Create Your Account</a></div><p>Once your account is set up, you'll be able to view your scheduled interviews and candidate details from your personal dashboard.</p><p>If you have any questions, feel free to contact your administrator.</p><p>Best regards,<br><strong>The Rekrooot Team</strong></p><div class='footer'>Powered by Rekrooot Recruitment Platform</div></div></body></html>`;

  const info = await transporter.sendMail({
    from: ENV.NEWUSER_MAIL_FROM,
    to,
    subject,
    text,
    html,
  });

  return { messageId: info.messageId };
}
