import { Router } from "express";
import crypto from "crypto";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import { PasswordResetToken } from "../modals/passwordResetToken.model.js";
import { getAdminAuth } from "../config/firebaseAdmin.js";
import { sendPasswordResetEmailSMTP } from "../services/mailer.js";
import { ENV } from "../config/env.js";

const router = Router();

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { uid, email } = req.auth;

    const user = await User.findOne({ firebase_uid: uid })
      .populate('company_id', 'name');

    if (!user) {
      return res.status(403).json({ message: "User is not provisioned in app database" });
    }

    return res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.post("/check-email", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "Account not found" });
    }

    return res.json({ exists: true });
  } catch (err) {
    next(err);
  }
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Return success to avoid leaking which emails are registered
      return res.json({ message: "If that email is registered, a reset link has been sent." });
    }

    // Invalidate any existing unused tokens for this email
    await PasswordResetToken.deleteMany({ email, used: false });

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await PasswordResetToken.create({ email, token, expires_at: expiresAt });

    const resetUrl = `${ENV.FRONTEND_BASE_URL}/reset-password?token=${token}`;
    await sendPasswordResetEmailSMTP({ to: email, resetUrl });

    return res.json({ message: "If that email is registered, a reset link has been sent." });
  } catch (err) {
    next(err);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ message: "Token and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const resetToken = await PasswordResetToken.findOne({ token, used: false });
    if (!resetToken) {
      return res.status(400).json({ message: "Invalid or expired reset link" });
    }
    if (resetToken.expires_at < new Date()) {
      return res.status(400).json({ message: "Reset link has expired. Please request a new one." });
    }

    const user = await User.findOne({ email: resetToken.email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await getAdminAuth().updateUser(user.firebase_uid, { password: newPassword });

    resetToken.used = true;
    await resetToken.save();

    return res.json({ message: "Password updated successfully" });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const { uid } = req.auth;

    await getAdminAuth().revokeRefreshTokens(uid);

    return res.status(200).json({ message: "Logged out" });
  } catch (err) {
    next(err);
  }
});

export default router;