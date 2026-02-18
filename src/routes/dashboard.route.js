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
                query.company_id = new mongoose.Types.ObjectId(company_id);
            }
            // If company_id is 'all' or not provided, query stays empty {} to fetch all
        } else {
            // Other roles: can only see their own company's data
            if (!req.user.company_id) {
                return res.status(400).json({ message: "User is not associated with any company" });
            }
            query.company_id = req.user.company_id;
        }

        // Candidate-specific query (exclude trashed)
        const candidateQuery = { ...query, trash: { $ne: true } };

        const [
            totalClients,
            totalVendors,
            totalJobs,
            totalCandidates,
            interviewedCandidates,
            recentInterviewDocs,
            monthlyInterviewAgg,
            candidatesByStatus
        ] = await Promise.all([
            Client.countDocuments(query),
            Vendor.countDocuments(query),
            Job.countDocuments(query), // Count all jobs, not just active
            Candidate.countDocuments(candidateQuery),
            Candidate.countDocuments({ ...candidateQuery, status: 4 }), // status 4 = interviewed
            // Recent interviews - populate candidate details
            Interview.find({ ...query, status: { $ne: 6 } }) // Exclude cancelled (status 6)
                .sort({ date_time: -1 })
                .limit(20)
                .populate({
                    path: 'candidate_id',
                    select: 'full_name email primary_contact job_id client_id vendor_id',
                    populate: [
                        { path: 'job_id', select: 'title' },
                        { path: 'client_id', select: 'name' },
                        { path: 'vendor_id', select: 'name' }
                    ]
                })
                .lean(),
            // Monthly interview trends - aggregate by month from date_time
            Interview.aggregate([
                { $match: { ...query, date_time: { $exists: true }, status: { $ne: 6 } } },
                {
                    $group: {
                        _id: {
                            year: { $year: "$date_time" },
                            month: { $month: "$date_time" }
                        },
                        totalInterviews: { $sum: 1 },
                        // Count selected (interview status 3 = selected)
                        selected: {
                            $sum: { $cond: [{ $eq: ["$status", 3] }, 1, 0] }
                        }
                    }
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } }
            ]),
            // Candidate status distribution
            Candidate.aggregate([
                { $match: candidateQuery },
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ])
        ]);

        // Build candidate status counts
        const candidateStatusCounts = candidatesByStatus.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
        }, {});

        // Build monthly trends for the current year
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // 0-indexed

        // Create a map from aggregation results
        const monthlyMap = {};
        for (const item of monthlyInterviewAgg) {
            const key = `${item._id.year}-${item._id.month}`;
            monthlyMap[key] = item;
        }

        const monthlyTrends = months.slice(0, currentMonth + 1).map((month, idx) => {
            const key = `${currentYear}-${idx + 1}`; // MongoDB $month is 1-indexed
            const data = monthlyMap[key] || {};
            return {
                month,
                interviews: data.totalInterviews || 0,
                selected: data.selected || 0
            };
        });

        // Interview status labels for display
        const interviewStatusLabels = {
            0: 'Scheduled',
            1: 'Rescheduled',
            2: 'In Review',
            3: 'Selected',
            4: 'Rejected',
            5: 'No Show',
            6: 'Cancelled',
            7: 'Proxy',
            8: 'Technical Issue'
        };

        // Build recent interviews with populated data
        const recentInterviews = recentInterviewDocs.map(i => {
            const candidate = i.candidate_id;
            return {
                id: i._id,
                candidateName: candidate?.full_name || i.candidate_name || 'N/A',
                email: candidate?.email || i.candidate_email || 'N/A',
                primaryContact: candidate?.primary_contact || i.candidate_phone || 'N/A',
                jobName: candidate?.job_id?.title || 'N/A',
                clientName: candidate?.client_id?.name || 'N/A',
                vendorName: candidate?.vendor_id?.name || 'N/A',
                dateISO: i.date_time,
                status: interviewStatusLabels[i.status] || 'Scheduled'
            };
        });

        return res.json({
            stats: {
                totalJobs,
                totalClients,
                totalVendors,
                appliedCandidates: totalCandidates,
                selectedCandidates: interviewedCandidates,
            },
            monthlyTrends,
            candidateStatusData: [
                { name: 'Waiting', value: candidateStatusCounts[0] || 0 },
                { name: 'Scheduled', value: (candidateStatusCounts[1] || 0) + (candidateStatusCounts[2] || 0) },
                { name: 'In Review', value: candidateStatusCounts[3] || 0 },
                { name: 'Interviewed', value: candidateStatusCounts[4] || 0 },
                { name: 'Cancelled', value: candidateStatusCounts[5] || 0 },
            ],
            recentInterviews
        });
    } catch (err) {
        next(err);
    }
});

export default router;
