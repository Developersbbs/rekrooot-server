import mongoose from "mongoose";

const invitationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    token: { type: String, required: true, unique: true },

    company_id: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    team_id: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },
    lead_recruiter_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    region: { type: String, default: null },
    role: { type: Number, required: true },
    sent_button:{type:Boolean, default:false},

    invited_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    expires_at: { type: Date, required: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

invitationSchema.index({ email: 1, company_id: 1 }, { name: "invitation_email_company_idx" });
invitationSchema.index({ expires_at: 1 }, { name: "invitation_expires_at_idx" });

export const Invitation = mongoose.model("Invitation", invitationSchema);