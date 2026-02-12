import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, attachUser } from "../middlewares/auth.middleware.js";
import { Candidate } from "../modals/candidate.model.js";
import { Job } from "../modals/job.model.js";

const router = Router();

router.get("/", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { company_id, job_id, email } = req.query;
        let query = {};

        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        } else if (company_id && company_id !== "all") {
            if (mongoose.Types.ObjectId.isValid(company_id)) {
                query.company_id = company_id;
            }
        }

        const { created_by } = req.query;
        if (created_by && mongoose.Types.ObjectId.isValid(created_by)) {
            query.created_by = created_by;
        }

        if (job_id && mongoose.Types.ObjectId.isValid(job_id)) {
            query.job_id = job_id;
        }

        if (email) {
            query.email = email.toLowerCase();
        }

        const candidates = await Candidate.find(query)
            .populate('job_id', 'title')
            .populate('client_id', 'name')
            .populate('vendor_id', 'name')
            .sort({ createdAt: -1 });

        return res.json({ candidates });
    } catch (err) {
        next(err);
    }
});

router.get("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;
        const query = { _id: id };

        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        }

        const candidate = await Candidate.findOne(query)
            .populate('job_id')
            .populate('client_id')
            .populate('vendor_id')
            .populate('company_id');

        if (!candidate) {
            return res.status(404).json({ message: "Candidate not found or unauthorized" });
        }

        return res.json({ candidate });
    } catch (err) {
        next(err);
    }
});

router.post("/", requireAuth, attachUser, async (req, res, next) => {
    try {
        const {
            job_id,
            client_id,
            vendor_id,
            full_name,
            email,
            primary_contact,
            secondary_contact,
            experience_years,
            location,
            status,
            profile_pic,
            resumes,
            supporting_documents,
            company_id
        } = req.body;

        const target_company_id = req.user.role === 0 ? company_id : req.user.company_id;

        if (!target_company_id) {
            return res.status(400).json({ message: "Company ID is required" });
        }

        const candidate = await Candidate.create({
            job_id,
            client_id,
            vendor_id,
            company_id: target_company_id,
            full_name,
            email,
            primary_contact,
            secondary_contact,
            experience_years,
            location,
            status,
            profile_pic,
            resumes,
            supporting_documents,
            created_by: req.user._id
        });

        if (job_id && mongoose.Types.ObjectId.isValid(job_id)) {
            await Job.findByIdAndUpdate(job_id, {
                $inc: { 'candidate_counts.applied': 1 }
            });
        }

        return res.status(201).json({ candidate });
    } catch (err) {
        next(err);
    }
});

router.put("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const query = { _id: id };

        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        }

        const candidate = await Candidate.findOneAndUpdate(query, updates, { new: true });
        if (!candidate) return res.status(404).json({ message: "Candidate not found or unauthorized" });

        return res.json({ candidate });
    } catch (err) {
        next(err);
    }
});

router.delete("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;
        const query = { _id: id };

        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        }

        const candidate = await Candidate.findOneAndDelete(query);
        if (!candidate) return res.status(404).json({ message: "Candidate not found or unauthorized" });

        // Decrease count from job
        if (candidate.job_id) {
            await Job.findByIdAndUpdate(candidate.job_id, {
                $inc: { 'candidate_counts.applied': -1 }
            });
        }

        return res.json({ message: "Candidate deleted successfully" });
    } catch (err) {
        next(err);
    }
});

export default router;
