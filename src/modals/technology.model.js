import mongoose from "mongoose";

const technologySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } },
);

technologySchema.index({ name: 1 }, { unique: true });

export const Technology = mongoose.model("Technology", technologySchema);
