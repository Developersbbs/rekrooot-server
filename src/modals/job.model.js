import mongoose from "mongoose";

const jobSchema = new mongoose.Schema({
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    client_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client',
        required: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    experience_required: {
        type: String,
        required: true
    },
    location: {
        type: String,
        required: true
    },
    category: {
        type: String,
        enum: ['Hybrid', 'Remote', 'Onsite'],
        default: 'Hybrid'
    },
    type: {
        type: String,
        enum: ['Full Time', 'Contract', 'Internship'],
        default: 'Full Time'
    },
    status: {
        type: String,
        enum: ['0', '1', '2', '3'], // 0: TRASH, 1: INACTIVE, 2: ONHOLD, 3: ACTIVE
        default: '3'
    },
    technologies: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Technology'
    }],
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    candidate_counts: {
        applied: { type: Number, default: 0 },
        waiting: { type: Number, default: 0 },
        scheduled: { type: Number, default: 0 },
        selected: { type: Number, default: 0 },
        rejected: { type: Number, default: 0 },
        no_show: { type: Number, default: 0 },
        cancelled: { type: Number, default: 0 },
        technical_issue: { type: Number, default: 0 },
        proxy: { type: Number, default: 0 }
    }
}, {
    timestamps: true
});

export const Job = mongoose.model("Job", jobSchema);
