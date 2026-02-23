import mongoose from "mongoose";

const interviewSchema = new mongoose.Schema(
    {
        interviewer_id: { type: mongoose.Schema.Types.ObjectId, ref: "Interviewer", required: true },
        candidate_id: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate" },
        date_time: { type: Date, required: true },
        status: { type: Number, default: 0 }, // 0: scheduled, 1: rescheduled, 2: interview_in_review, 3: selected, 4: rejected, 5: no_show, 6: cancelled, 7: proxy, 8: technical_issue
        company_id: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
        client_id: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
        job_id: { type: mongoose.Schema.Types.ObjectId, ref: "Job" },
        created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        meeting_link: { type: String },
        session_id: { type: String },
        presenter_id: { type: String },
        zsoid: { type: String },
    },
    { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const Interview = mongoose.model("Interview", interviewSchema);
