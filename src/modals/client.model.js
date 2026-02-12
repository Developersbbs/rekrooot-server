import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, trim: true, lowercase: true },
        contact: { type: String, trim: true },
        logo: { type: String, trim: true },

        company_id: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },

        created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    },
    { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const Client = mongoose.model("Client", clientSchema);
