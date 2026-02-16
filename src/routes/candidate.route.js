import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, attachUser } from "../middlewares/auth.middleware.js";
import { Candidate } from "../modals/candidate.model.js";
import { Job } from "../modals/job.model.js";
import Interviewer from "../modals/interviewer.model.js";
import InterviewerAvailability from "../modals/interviewerAvailability.model.js";

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
            .populate('company_id', 'name')
            .sort({ createdAt: -1 });

        return res.json({ candidates });
    } catch (err) {
        next(err);
    }
});

// GET /candidates/:id/public (No auth required for scheduling page)
router.get("/:id/public", async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid candidate ID" });
        }

        const candidate = await Candidate.findById(id)
            .populate('job_id', 'title jobTitle')
            .populate('client_id', 'name logo')
            .populate('company_id', 'name')
            .select('full_name email job_id client_id company_id interviewer_id created_by vendor_id experience_years interview_date interview_time meeting_link');

        if (!candidate) {
            return res.status(404).json({ message: "Candidate not found" });
        }

        return res.json({ candidate });
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

const STATUS_FIELD_MAP = {
    '0': 'applied',
    '1': 'waiting',
    '2': 'scheduled',
    '3': 'selected',
    '4': 'rejected',
    '5': 'on_hold'
};

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
            company_id,
            interviewer_id,
            presenterId,
            zsoid,
            meeting_link,
            session_id
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
            created_by: req.user._id,
            interviewer_id,
            presenterId,
            zsoid,
            meeting_link,
            session_id
        });

        if (job_id && mongoose.Types.ObjectId.isValid(job_id)) {
            const statusField = STATUS_FIELD_MAP[status] || 'applied';
            await Job.findByIdAndUpdate(job_id, {
                $inc: { [`candidate_counts.${statusField}`]: 1 }
            });
        }

        return res.status(201).json({ candidate });
    } catch (err) {
        next(err);
    }
});

// POST /confirm-slot (Public, for candidate scheduling page)
router.post("/:id/confirm-slot", async (req, res, next) => {
    try {
        const { id } = req.params;
        const { interviewDate, interviewTime, interviewerId, meetingLink, sessionId, presenterId, zsoid } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid candidate ID" });
        }

        const updates = {
            status: '2', // Scheduled
            interviewDate,
            interviewTime,
            interviewerId
        };

        if (meetingLink) updates.meetingLink = meetingLink;
        if (sessionId) updates.sessionId = sessionId;
        if (presenterId) updates.presenterId = presenterId;
        if (zsoid) updates.zsoid = zsoid;

        const oldCandidate = await Candidate.findById(id);
        if (!oldCandidate) return res.status(404).json({ message: "Candidate not found" });

        // Unset result if exists (matching frontend logic)
        const candidate = await Candidate.findByIdAndUpdate(
            id,
            { $set: updates, $unset: { result: "" } },
            { new: true }
        );

        // Update Job counts if status changed
        if (oldCandidate.status !== '2' && oldCandidate.job_id) {
            const oldField = STATUS_FIELD_MAP[oldCandidate.status] || 'applied';
            const newField = 'scheduled'; // status '2'

            await Job.findByIdAndUpdate(oldCandidate.job_id, {
                $inc: {
                    [`candidate_counts.${oldField}`]: -1,
                    [`candidate_counts.${newField}`]: 1
                }
            });
        }

        // Update Interviewer availability
        if (interviewDate && interviewTime && interviewerId) {
            try {
                // Determine time slot key (e.g., "12:00" or "09:00")
                const [timePart, periodPart] = interviewTime.split(' ');
                let [hourStr, minuteStr] = timePart.split(':');
                let hour = parseInt(hourStr);

                if (periodPart === 'PM' && hour !== 12) hour += 12;
                else if (periodPart === 'AM' && hour === 12) hour = 0;

                const timeSlotKey = `${hour.toString().padStart(2, '0')}:${minuteStr}`;

                // Construct Date object to match InterviewerAvailability records
                const slotDate = new Date(interviewDate);
                slotDate.setHours(hour, parseInt(minuteStr), 0, 0);

                await InterviewerAvailability.findOneAndUpdate(
                    {
                        interviewer: interviewerId,
                        start_time: slotDate
                    },
                    {
                        status: 2,
                        candidate_id: id
                    }
                );
            } catch (updateErr) {
                console.error("Failed to update interviewer availability", updateErr);
                // Non-blocking error, but should be logged.
            }
        }

        return res.json({ candidate });
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

        const oldCandidate = await Candidate.findOne(query);
        if (!oldCandidate) return res.status(404).json({ message: "Candidate not found or unauthorized" });

        const candidate = await Candidate.findByIdAndUpdate(oldCandidate._id, updates, { new: true });

        // Handle Status Change
        if (updates.status && updates.status !== oldCandidate.status && candidate.job_id) {
            const oldStatus = oldCandidate.status;
            const newStatus = updates.status;

            const oldField = STATUS_FIELD_MAP[oldStatus] || 'applied';
            const newField = STATUS_FIELD_MAP[newStatus] || 'applied';

            if (oldField !== newField && mongoose.Types.ObjectId.isValid(candidate.job_id)) {
                await Job.findByIdAndUpdate(candidate.job_id, {
                    $inc: {
                        [`candidate_counts.${oldField}`]: -1,
                        [`candidate_counts.${newField}`]: 1
                    }
                });
            }
        }

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
            const statusField = STATUS_FIELD_MAP[candidate.status] || 'applied';
            await Job.findByIdAndUpdate(candidate.job_id, {
                $inc: { [`candidate_counts.${statusField}`]: -1 }
            });
        }

        return res.json({ message: "Candidate deleted successfully" });
    } catch (err) {
        next(err);
    }
});

export default router;
