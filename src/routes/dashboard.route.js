import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import { Company } from "../modals/company.model.js";
import Interviewer from "../modals/interviewer.model.js";
import { Invitation } from "../modals/invitation.model.js";
import { Interview } from "../modals/interview.model.js";

const router = Router();

async function requireSuperAdmin(req, res, next) {
    try {
        const { uid } = req.auth;
        const user = await User.findOne({ firebase_uid: uid });
        if (!user || user.role !== 0) {
            return res.status(403).json({ message: "Access denied" });
        }
        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
}

router.get("/stats", requireAuth, requireSuperAdmin, async (req, res, next) => {
    try {
        const { company_id } = req.query;
        let query = {};
        if (company_id && company_id !== 'all' && mongoose.Types.ObjectId.isValid(company_id)) {
            query.company_id = company_id;
        }

        const [
            totalCompanies,
            totalInterviewers,
            totalUsers,
            totalInvitations,
            recentInterviews,
        ] = await Promise.all([
            Company.countDocuments(query.company_id ? { _id: query.company_id } : {}),
            Interviewer.countDocuments(query),
            User.countDocuments(query),
            Invitation.countDocuments(query),
            Interview.find(query).sort({ date_time: -1 }).limit(5),
        ]);

        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const now = new Date();
        const currentMonth = now.getMonth();

        const monthlyTrends = months.slice(0, currentMonth + 1).map((month, idx) => ({
            month,
            interviews: idx === currentMonth ? totalInterviewers : Math.floor(totalInterviewers * (idx + 1) / (currentMonth + 1)),
            hired: 0
        }));

        return res.json({
            stats: {
                totalJobs: 0,
                totalClients: totalCompanies,
                totalVendors: 0,
                appliedCandidates: 0,
                selectedCandidates: 0,
                rejectedCandidates: 0,
                totalInterviewers,
                totalUsers,
                totalInvitations
            },
            monthlyTrends,
            candidateStatusData: [
                { name: 'Applied', value: 0 },
                { name: 'Scheduled', value: totalInterviewers },
                { name: 'Selected', value: 0 },
                { name: 'Rejected', value: 0 },
            ],
            recentInterviews: recentInterviews.map(i => ({
                id: i._id,
                candidateName: i.candidate_name,
                email: i.candidate_email,
                primaryContact: i.candidate_phone || "N/A",
                jobName: "Scheduled Interview", // Placeholder as jobName isn't in Interview model yet
                clientName: "Internal",
                vendorName: "Direct",
                dateISO: i.date_time,
                status: i.status
            }))
        });
    } catch (err) {
        next(err);
    }
});

export default router;
