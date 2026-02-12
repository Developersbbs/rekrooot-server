import mongoose from "mongoose";

const { Schema } = mongoose;

const interviewerSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    contact: {
      type: String,
      trim: true,
    },
    logo: {
      type: String,
      trim: true,
    },
    zoho_meet_uid: {
      type: String,
      trim: true,
    },
    skills: {
      type: [String],
      default: [],
    },
    technologies: [
      {
        type: Schema.Types.ObjectId,
        ref: "Technology",
      },
    ],
    company_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

interviewerSchema.index({ email: 1 }, { unique: false });

const Interviewer = mongoose.models.Interviewer || mongoose.model("Interviewer", interviewerSchema);

export default Interviewer;
