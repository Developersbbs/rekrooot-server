import mongoose from "mongoose";

const interviewSchema = new mongoose.Schema(
    {
        interviewer_id: { type: mongoose.Schema.Types.ObjectId, ref: "Interviewer", required: true },
        candidate_name: { type: String, required: true },
        candidate_email: { type: String, required: true },
        candidate_phone: { type: String },
        date_time: { type: Date, required: true },
        status: { type: String, default: "scheduled" },
        company_id: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
        created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const Interview = mongoose.model("Interview", interviewSchema);
