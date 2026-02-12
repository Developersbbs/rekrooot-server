import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, attachUser } from "../middlewares/auth.middleware.js";
import { Job } from "../modals/job.model.js";
import { Technology } from "../modals/technology.model.js";

const router = Router();

// GET all jobs (filtered by company)
router.get("/", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { company_id } = req.query;
        let query = {};

        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        } else if (company_id && company_id !== "all") {
            if (mongoose.Types.ObjectId.isValid(company_id)) {
                query.company_id = company_id;
            }
        }

        const jobs = await Job.find(query)
            .populate('client_id', 'name')
            .populate('technologies', 'name')
            .sort({ createdAt: -1 });

        return res.json({ jobs });
    } catch (err) {
        next(err);
    }
});

// GET single job
router.get("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;
        const query = { _id: id };

        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        }

        const job = await Job.findOne(query)
            .populate('client_id', 'name')
            .populate('technologies', 'name');
        if (!job) return res.status(404).json({ message: "Job not found" });

        return res.json({ job });
    } catch (err) {
        next(err);
    }
});

// POST create job
router.post("/", requireAuth, attachUser, async (req, res, next) => {
    try {
        const {
            client_id,
            title,
            description,
            experience_required,
            location,
            category,
            type,
            status,
            required_skills,
            company_id
        } = req.body;

        if (!title || !client_id) {
            return res.status(400).json({ message: "Title and Client ID are required" });
        }

        const target_company_id = req.user.role === 0 ? company_id : req.user.company_id;

        if (!target_company_id) {
            return res.status(400).json({ message: "Company ID is required" });
        }

        const validSkills = Array.isArray(required_skills) ? required_skills : [];
        const technologyIds = [];

        if (validSkills.length > 0) {
            for (const skillName of validSkills) {
                if (typeof skillName === 'string' && skillName.trim()) {
                    const normalizedName = skillName.trim();
                    // Upsert technology
                    const tech = await Technology.findOneAndUpdate(
                        { name: normalizedName },
                        { $setOnInsert: { name: normalizedName } },
                        { upsert: true, new: true, setDefaultsOnInsert: true }
                    );
                    technologyIds.push(tech._id);
                }
            }
        }

        const job = await Job.create({
            company_id: target_company_id,
            client_id,
            title,
            description,
            experience_required,
            location,
            category,
            type,
            status,
            technologies: technologyIds,
            created_by: req.user._id
        });

        return res.status(201).json({ job });
    } catch (err) {
        next(err);
    }
});

// PUT update job
router.put("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const query = { _id: id };

        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        }

        const job = await Job.findOneAndUpdate(query, updates, { new: true });
        if (!job) return res.status(404).json({ message: "Job not found or unauthorized" });

        return res.json({ job });
    } catch (err) {
        next(err);
    }
});

// DELETE job
router.delete("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;
        const query = { _id: id };

        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        }

        const result = await Job.findOneAndDelete(query);
        if (!result) return res.status(404).json({ message: "Job not found or unauthorized" });

        return res.json({ message: "Job deleted successfully" });
    } catch (err) {
        next(err);
    }
});

export default router;
