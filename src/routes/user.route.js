import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";

const router = Router();

// Middleware to check if user is provisioned and get their data
async function attachUser(req, res, next) {
    try {
        const { uid } = req.auth;
        const user = await User.findOne({ firebase_uid: uid });
        if (!user) {
            return res.status(403).json({ message: "User not found" });
        }
        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
}

// GET users with role 2 (Lead Recruiter) for a company
router.get("/lead-recruiters", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { company_id } = req.query;

        let targetCompanyId = company_id;

        // If not super admin, must be for user's own company
        if (req.user.role !== 0) {
            targetCompanyId = req.user.company_id;
        }

        if (!targetCompanyId || !mongoose.Types.ObjectId.isValid(targetCompanyId)) {
            return res.status(400).json({ message: "Invalid or missing company_id" });
        }

        const leadRecruiters = await User.find({
            company_id: targetCompanyId,
            role: 2, // Lead Recruiter
            is_active: true
        }).select("username email firebase_uid");

        return res.json({ leadRecruiters });
    } catch (err) {
        next(err);
    }
});

export default router;
