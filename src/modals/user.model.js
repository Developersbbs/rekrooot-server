import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    contact: { type: String },

    // Firebase UID as stable identifier (maps to DBDESIGN uid objectid concept)
    firebase_uid: { type: String, required: true, unique: true },

    company_id: { type: mongoose.Schema.Types.ObjectId, ref: "company", default: null },
    team_id: { type: mongoose.Schema.Types.ObjectId, ref: "teams", default: null },

    role: { type: Number, required: true }, // 0..3 based on doc
    is_active: { type: Boolean, default: true },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

export const User = mongoose.model("users", userSchema);