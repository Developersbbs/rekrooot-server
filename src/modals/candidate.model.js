import mongoose from "mongoose";

const candidateSchema = new mongoose.Schema({
    job_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
        required: true
    },
    client_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client',
        required: true
    },
    vendor_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor'
    },
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    full_name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    primary_contact: String,
    secondary_contact: String,
    experience_years: {
        type: String,
    },
    location: String,

    profile_pic: String,
    resume_url: String,
    resumes: [{
        name: String,
        url: String
    }],
    supporting_documents: [{
        name: String,
        url: String
    }],
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    trash: {
        type: Boolean,
        default: false
    },
    interview_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Interview'
    },
    status: {
        type: Number,
        default: 0
    }, // 0: waiting, 1: scheduled, 2: rescheduled, 3: review, 4: interviewed, 5: cancelled
    result_document_url: String
}, {
    timestamps: true
});

export const Candidate = mongoose.model("Candidate", candidateSchema);
