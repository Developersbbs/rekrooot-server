import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { attachUser } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import { Company } from "../modals/company.model.js";
import { Client } from "../modals/client.model.js";
import Vendor from "../modals/vendor.model.js";
import Interviewer from "../modals/interviewer.model.js";
import { Invitation } from "../modals/invitation.model.js";
import { Interview } from "../modals/interview.model.js";
import { Candidate } from "../modals/candidate.model.js";
import { Job } from "../modals/job.model.js";

const router = Router();

router.get("/stats", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { company_id } = req.query;
        let query = {};

        // Role-based access control
        if (req.user.role === 0) {
            // SuperAdmin: can query any company or all companies
            if (company_id && company_id !== 'all' && mongoose.Types.ObjectId.isValid(company_id)) {
                query.company_id = company_id;
            }
        } else {
            // Other roles: can only see their own company's data
            if (!req.user.company_id) {
                return res.status(400).json({ message: "User is not associated with any company" });
            }
            query.company_id = req.user.company_id;
        }

        const [
            totalClients,
            totalVendors,
            totalInterviewers,
            totalUsers,
            totalInvitations,
            totalJobs,
            recentInterviews,
            interviewsByStatus,
            candidatesByStatus
        ] = await Promise.all([
            Client.countDocuments(query),
            Vendor.countDocuments(query),
            Interviewer.countDocuments(query),
            User.countDocuments(query),
            Invitation.countDocuments(query),
            Job.countDocuments({ ...query, status: '3' }), // Count only active jobs
            Interview.find(query).sort({ date_time: -1 }).limit(5),
            Interview.aggregate([
                { $match: query },
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ]),
            Candidate.aggregate([
                { $match: query },
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ])
        ]);

        const statusCounts = interviewsByStatus.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
        }, {});

        const candidateStatusCounts = candidatesByStatus.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
        }, {});

        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const now = new Date();
        const currentMonth = now.getMonth();

        const monthlyTrends = months.slice(0, currentMonth + 1).map((month, idx) => ({
            month,
            interviews: idx === currentMonth ? (statusCounts[1] || statusCounts.scheduled || 0) + (statusCounts[2] || statusCounts.rescheduled || 0) : 0,
            hired: (statusCounts.completed || 0) // Keeping completed for now if it exists in older data
        }));

        return res.json({
            stats: {
                totalJobs,
                totalClients,
                totalVendors,
                appliedCandidates: candidateStatusCounts['0'] || 0,
                selectedCandidates: candidateStatusCounts['3'] || 0,
                rejectedCandidates: candidateStatusCounts['4'] || 0,
                totalInterviewers,
                totalUsers,
                totalInvitations
            },
            monthlyTrends,
            candidateStatusData: [
                { name: 'Applied', value: candidateStatusCounts['0'] || 0 },
                { name: 'Waiting', value: candidateStatusCounts['1'] || 0 },
                { name: 'Scheduled', value: candidateStatusCounts['2'] || 0 },
                { name: 'Selected', value: candidateStatusCounts['3'] || 0 },
                { name: 'Rejected', value: candidateStatusCounts['4'] || 0 },
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
