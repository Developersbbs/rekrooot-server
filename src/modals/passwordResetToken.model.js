import mongoose from "mongoose";

const passwordResetTokenSchema = new mongoose.Schema(
  {
    email: { type: String, required: true },
    token: { type: String, required: true, unique: true },
    expires_at: { type: Date, required: true },
    used: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: "created_at" } },
);

passwordResetTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetToken = mongoose.model("PasswordResetToken", passwordResetTokenSchema);
