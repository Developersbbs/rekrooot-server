import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    contact: { type: String },

    firebase_uid: { type: String, required: true, unique: true },

    company_id: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    team_id: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },
    lead_recruiter_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    recruiter_region: { type: String },

    role: { type: Number, required: true },
    is_active: { type: Boolean, default: true },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

export const User = mongoose.model("User", userSchema);