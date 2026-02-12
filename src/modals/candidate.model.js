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
    status: {
        type: String,
        enum: ['0', '1', '2', '3', '4', '5'],
        default: '0'
    },
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
    }
}, {
    timestamps: true
});

export const Candidate = mongoose.model("Candidate", candidateSchema);
