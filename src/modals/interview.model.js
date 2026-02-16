import mongoose from "mongoose";

const interviewSchema = new mongoose.Schema(
    {
        interviewer_id: { type: mongoose.Schema.Types.ObjectId, ref: "Interviewer", required: true },
        candidate_id: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate" },
        candidate_name: { type: String, required: true },
        candidate_email: { type: String, required: true },
        candidate_phone: { type: String },
        date_time: { type: Date, required: true },
        status: { type: Number, default: 1 }, // 1: scheduled, 2: rescheduled, 3: cancelled
        company_id: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
        created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        meeting_link: { type: String },
        session_id: { type: String },
        presenter_id: { type: String },
        zsoid: { type: String },
    },
    { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const Interview = mongoose.model("Interview", interviewSchema);
