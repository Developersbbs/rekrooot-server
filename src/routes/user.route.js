import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import { Team } from "../modals/team.model.js";
import { Job } from "../modals/job.model.js";
import { Candidate } from "../modals/candidate.model.js";
import { Client } from "../modals/client.model.js";
import { Interview } from "../modals/interview.model.js";
import Interviewer from "../modals/interviewer.model.js";
import { getAdminAuth } from "../config/firebaseAdmin.js";

const router = Router();

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

// GET /users/:id/public - Fetch basic user info (email) for scheduling
router.get("/:id/public", async (req, res, next) => {
    try {
        const { id } = req.params;
        let query = {};
        if (mongoose.Types.ObjectId.isValid(id)) {
            query = { _id: id };
        } else {
            return res.status(400).json({ message: "Invalid ID" });
        }

        const user = await User.findOne(query).select("email username");

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        return res.json({ user });
    } catch (err) {
        next(err);
    }
});

router.get("/", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { company_id } = req.query;
        let query = { is_active: true };

        if (req.user.role === 0) { // Super Admin
            if (company_id && mongoose.Types.ObjectId.isValid(company_id)) {
                query.company_id = company_id;
            }
        } else {
            // Non-super admin must be restricted to their own company
            if (!req.user.company_id) {
                return res.status(400).json({ message: "User is not associated with any company" });
            }
            query.company_id = req.user.company_id;
        }

        const users = await User.find(query)
            .populate("company_id", "name") // Populate company name
            .select("-password") // Exclude password if present
            .sort({ role: 1, username: 1 }); // Sort by role then name

        return res.json({ users });
    } catch (err) {
        next(err);
    }
});

router.get("/lead-recruiters", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { company_id } = req.query;

        let targetCompanyId = company_id;

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

router.get("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;
        let query = {};
        if (mongoose.Types.ObjectId.isValid(id)) {
            query = { _id: id };
        } else {
            query = { firebase_uid: id };
        }

        const user = await User.findOne(query)
            .populate("company_id", "name")
            .select("-password");

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Role-based access control
        // Super Admin can view any user
        // Others can only view users in their own company
        if (req.user.role !== 0) {
            if (!req.user.company_id || user.company_id?._id?.toString() !== req.user.company_id.toString()) {
                return res.status(403).json({ message: "Access denied" });
            }
        }

        return res.json({ user });
    } catch (err) {
        next(err);
    }
});

// Update user (e.g. migrate lead recruiter)
router.put("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Prevent updating sensitive fields via this route if necessary
        delete updates.password;
        delete updates.email;

        let query = { _id: id };
        if (!mongoose.Types.ObjectId.isValid(id)) {
            query = { firebase_uid: id };
        }

        const updatedUser = await User.findOneAndUpdate(query, updates, { new: true });

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        return res.json({ user: updatedUser });
    } catch (err) {
        next(err);
    }
});

// Delete user
router.delete("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;

        let query = { _id: id };
        if (!mongoose.Types.ObjectId.isValid(id)) {
            query = { firebase_uid: id };
        }

        const userToDelete = await User.findOne(query);
        if (!userToDelete) {
            return res.status(404).json({ message: "User not found" });
        }

        const userId = userToDelete._id;

        // Delete from Firebase Auth
        if (userToDelete.firebase_uid) {
            try {
                await getAdminAuth().deleteUser(userToDelete.firebase_uid);
            } catch (firebaseErr) {
                console.warn("User deleted from DB but failed to delete from Firebase Auth:", firebaseErr.message);
            }
        }

        // Cleanup in Teams
        // If the user was a team lead, delete the entire team
        await Team.deleteMany({ team_lead: userId });

        // Remove from members array in other teams
        await Team.updateMany(
            { members: userId },
            { $pull: { members: userId } }
        );

        // Cleanup created_by in other collections: jobs, candidates, clients, interviews, interviewers
        await Promise.all([
            Job.updateMany({ created_by: userId }, { $set: { created_by: null } }),
            Candidate.updateMany({ created_by: userId }, { $set: { created_by: null } }),
            Client.updateMany({ created_by: userId }, { $set: { created_by: null } }),
            Interview.updateMany({ created_by: userId }, { $set: { created_by: null } }),
            Interviewer.updateMany({ created_by: userId }, { $set: { created_by: null } })
        ]);

        await User.deleteOne({ _id: userId });

        return res.json({ message: "User deleted successfully" });
    } catch (err) {
        next(err);
    }
});

export default router;
