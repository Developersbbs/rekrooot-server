import mongoose from "mongoose";

const teamSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        company_id: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
        team_lead: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        is_active: { type: Boolean, default: true },
    },
    { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const Team = mongoose.model("Team", teamSchema);