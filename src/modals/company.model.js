import mongoose from "mongoose";

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    recruiter_admin_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, sparse: true },
    subscription_status: { type: Boolean, default: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

companySchema.index({ name: 1 }, { unique: true });

export const Company = mongoose.model("Company", companySchema);
