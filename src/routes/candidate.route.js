import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, attachUser } from "../middlewares/auth.middleware.js";
import { Candidate } from "../modals/candidate.model.js";
import { Job } from "../modals/job.model.js";
import { Interview } from "../modals/interview.model.js";
import Interviewer from "../modals/interviewer.model.js";
import InterviewerAvailability from "../modals/interviewerAvailability.model.js";
import axios from "axios";
import nodemailer from "nodemailer";
import { ENV } from "../config/env.js";
import multiparty from "multiparty";
import fs from "fs";
import { extractTextFromFile, parseResumeText } from "../services/resumeParser.js";

const router = Router();

// Helper function to update job candidate counts
const updateJobCandidateCounts = async (jobId, oldStatus = null, newStatus = null) => {
    if (!jobId) return;

    const updateQuery = { $inc: {} };

    // Decrement old status count
    if (oldStatus) {
        updateQuery.$inc[`candidate_counts.${oldStatus}`] = -1;
    }

    // Increment new status count
    if (newStatus) {
        updateQuery.$inc[`candidate_counts.${newStatus}`] = 1;
    }

    if (Object.keys(updateQuery.$inc).length > 0) {
        await Job.findByIdAndUpdate(jobId, updateQuery);
    }
};

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

        const trashFilter = req.query.trash === 'true';
        query.trash = trashFilter;

        const candidates = await Candidate.find(query)
            .populate('job_id', 'title')
            .populate('client_id', 'name')
            .populate('vendor_id', 'name')
            .populate('company_id', 'name')
            .populate({
                path: 'interview_id',
                populate: {
                    path: 'interviewer_id',
                    select: 'name'
                }
            })
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
            .populate('interview_id')
            .select('full_name email job_id client_id company_id interview_id created_by vendor_id experience_years');

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
            .populate('company_id')
            .populate('created_by', 'username email')
            .populate({
                path: 'interview_id',
                populate: {
                    path: 'interviewer_id',
                    select: 'name'
                }
            });

        if (!candidate) {
            return res.status(404).json({ message: "Candidate not found or unauthorized" });
        }

        return res.json({ candidate });
    } catch (err) {
        next(err);
    }
});

router.post("/parse", requireAuth, attachUser, async (req, res, next) => {
    const form = new multiparty.Form();

    form.parse(req, async (err, fields, files) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Error parsing form: " + err.message
            });
        }

        const file = files?.file?.[0];
        if (!file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }

        const filePath = file.path;
        try {
            console.log("Processing resume upload:", file.originalFilename);
            const text = await extractTextFromFile(filePath, file.originalFilename, file.size);
            const parsedData = parseResumeText(text);

            // Cleanup temp file
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.warn("Failed to cleanup temp file:", unlinkErr.message);
            });

            return res.json({
                success: true,
                data: parsedData,
            });
        } catch (error) {
            console.error("Resume parsing error:", error);
            if (filePath) {
                fs.unlink(filePath, () => { });
            }
            return res.status(500).json({
                success: false,
                message: "Error extracting text: " + error.message,
            });
        }
    });
});

const FINAL_STATUS_MAP = {
    '0': null,
    '1': 'SELECTED',
    '2': 'REJECTED'
};

const RESULT_TO_JOB_FIELD = {
    '1': 'selected',
    '2': 'rejected',
    '3': 'no_show',
    '4': 'cancelled',
    '5': 'technical_issue',
    '6': 'proxy'
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
            interview_id
        } = req.body;

        const target_company_id = req.user.role === 0 ? company_id : req.user.company_id;

        if (!target_company_id) {
            return res.status(400).json({ message: "Company ID is required" });
        }

        const finalStatus = FINAL_STATUS_MAP[status] || null;
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
            final_status: finalStatus,
            is_active: finalStatus === null,
            profile_pic,
            resumes,
            supporting_documents,
            created_by: req.user._id,
            interview_id
        });

        // ✅ FIXED: Actually pass the update object to Job.findByIdAndUpdate
        if (job_id) {
            const jobUpdate = { $inc: {} };

            if (!interview_id) {
                jobUpdate.$inc["candidate_counts.waiting"] = 1;
                jobUpdate.$inc["candidate_counts.applied"] = 1;
                candidate.status = 0;
            } else {
                jobUpdate.$inc["candidate_counts.scheduled"] = 1;
                jobUpdate.$inc["candidate_counts.applied"] = 1;
                candidate.status = 1;
            }

            await candidate.save();
            await Job.findByIdAndUpdate(job_id, jobUpdate)  // ✅ jobUpdate passed here
                .catch(e => console.error("Failed to update job counts:", e));
        }

        console.log("Created Candidate:", candidate);
        return res.status(201).json({ candidate });
    } catch (err) {
        next(err);
    }
});

router.put("/:id/migrate", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { new_job_id, new_interview_id, new_client_id, new_vendor_id } = req.body;

        const candidate = await Candidate.findById(id);
        if (!candidate) {
            return res.status(404).json({
                status: "error",
                message: "Candidate not found"
            });
        }

        // ✅ STEP 1: Snapshot candidate status (THIS is what we store)
        const previousJobRole = candidate.job_id;
        const previousClient = candidate.client_id;
        const previousVendor = candidate.vendor_id;
        const previousCandidateStatus = candidate.status; // 🔥 IMPORTANT

        let previousInterviewTime = null;
        let previousInterview = null;

        // ✅ STEP 2: Handle existing interview (if any)
        if (candidate.interview_id) {
            const interview = await Interview.findById(candidate.interview_id).lean();

            if (interview) {
                previousInterviewTime = interview.date_time;
                previousInterview = interview._id;

                // ✅ Cancel Zoho Meeting FIRST
                if (interview.session_id && interview.presenter_id) {
                    try {
                        const tokenUrl = `https://accounts.zoho.in/oauth/v2/token?refresh_token=${ENV.ZOHO_MEET_REFRESH_TOKEN}&client_id=${ENV.ZOHO_MEET_CLIENT_ID}&client_secret=${ENV.ZOHO_MEET_CLIENT_SECRET}&grant_type=refresh_token`;

                        const tokenResponse = await axios.post(tokenUrl);
                        const accessToken = tokenResponse.data.access_token;

                        if (accessToken) {
                            const zsoid = interview.zsoid || interview.presenter_id;
                            const cancelUrl = `https://meeting.zoho.in/api/v2/${zsoid}/sessions/${interview.session_id}.json`;

                            await axios.delete(cancelUrl, {
                                headers: {
                                    Authorization: `Zoho-oauthtoken ${accessToken}`
                                }
                            }).catch(e =>
                                console.warn("Zoho cancel failed or already cancelled:", e.message)
                            );
                        }
                    } catch (e) {
                        console.warn("Zoho cancellation failed:", e.message);
                    }
                }

                // ✅ Mark interview as cancelled (DB update)
                await Interview.findByIdAndUpdate(candidate.interview_id, {
                    status: 6 // cancelled
                });

                // ✅ Free interviewer availability
                if (previousInterview && previousInterviewTime) {
                    await InterviewerAvailability.findOneAndUpdate(
                        {
                            interviewer: previousInterview,
                            start_time: previousInterviewTime
                        },
                        {
                            status: 1,
                            $unset: { candidate_id: "" }
                        }
                    ).catch(e =>
                        console.error("Failed to free availability:", e)
                    );
                }
            }
        }

        // ✅ STEP 3: Build candidate update fields
        const updateFields = { isMigrated: true };

        if (new_job_id) updateFields.job_id = new_job_id;
        if (new_client_id) updateFields.client_id = new_client_id;
        if (new_vendor_id) updateFields.vendor_id = new_vendor_id;

        // New status after migration
        if (new_interview_id) {
            updateFields.interview_id = new_interview_id;
            updateFields.status = 1; // rescheduled
        } else {
            updateFields.status = 0; // waiting
        }

        // ✅ STEP 4: Push migration history (STORE ONLY CANDIDATE STATUS)
        const updatedCandidate = await Candidate.findByIdAndUpdate(
            id,
            {
                $push: {
                    migrationHistory: {
                        previous_job_role: previousJobRole,
                        previous_Status: previousCandidateStatus, // 🔥 FIXED HERE
                        previous_Interview: previousInterview,
                        previous_Client: previousClient,
                        previous_Vendor: previousVendor,
                        previous_interview_AttendBy: previousInterviewTime,
                        migratedAt: new Date()
                    }
                },
                $set: updateFields,
                ...(new_interview_id ? {} : { $unset: { interview_id: "" } })
            },
            { new: true }
        );

        return res.status(200).json({
            status: "success",
            message: "Candidate Migrated Successfully",
            data: updatedCandidate
        });

    } catch (error) {
        console.error("Migration error:", error);
        return res.status(500).json({
            status: "error",
            message: "An error occurred during migration",
            error: error.message
        });
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

        const oldCandidate = await Candidate.findById(id);
        if (!oldCandidate) return res.status(404).json({ message: "Candidate not found" });

        const isReschedule = !!oldCandidate.interview_id;
        const updates = {
            final_status: null,
            is_active: true,
            interview_id: req.body.interviewId || req.body.interview_id,
            status: isReschedule ? 2 : 1 // 1: scheduled, 2: rescheduled for Candidate
        };

        // If it's a reschedule, clean up old interview
        if (isReschedule) {
            const oldInterview = await Interview.findById(oldCandidate.interview_id);
            if (oldInterview) {
                // Cancel old interview
                await Interview.findByIdAndUpdate(oldCandidate.interview_id, { status: 6 });

                // Free availability
                await InterviewerAvailability.find({
                    interviewer: oldInterview.interviewer_id,
                    start_time: oldInterview.date_time
                }).updateMany({ status: 1, $unset: { candidate_id: "" } });

                // Increment cancelled count for stats
                if (oldInterview.job_id) {
                    await Job.findByIdAndUpdate(oldInterview.job_id, {
                        $inc: { "candidate_counts.cancelled": 1 }
                    });
                }
            }
        }

        // Update new interview status
        const interviewId = updates.interview_id;
        if (interviewId) {
            const interviewUpdate = {
                status: isReschedule ? 1 : 0 // 0: scheduled, 1: rescheduled for Interview
            };

            // Calculate date_time if provided
            if (interviewDate && interviewTime) {
                try {
                    const [timePart, periodPart] = interviewTime.split(' ');
                    if (timePart) {
                        let [hourStr, minuteStr] = timePart.split(':');
                        let hour = parseInt(hourStr);

                        if (periodPart === 'PM' && hour !== 12) hour += 12;
                        else if (periodPart === 'AM' && hour === 12) hour = 0;

                        const dt = new Date(interviewDate);
                        if (!isNaN(dt.getTime())) {
                            dt.setHours(hour, parseInt(minuteStr || '0'), 0, 0);
                            interviewUpdate.date_time = dt;
                        }
                    }
                } catch (dateErr) {
                    console.error("Error parsing date/time for interview update:", dateErr);
                }
            }

            await Interview.findByIdAndUpdate(interviewId, interviewUpdate)
                .catch(e => console.error("Failed to update interview status:", e));
        }

        // Unset result if exists (matching frontend logic)
        const candidate = await Candidate.findByIdAndUpdate(
            id,
            { $set: updates, $unset: { result: "" } },
            { new: true }
        );

        // Update Job Counts for candidate status transition
        if (candidate.job_id) {
            const oldStatus = oldCandidate.status === 1 ? 'scheduled' : (oldCandidate.status === 2 ? 'rescheduled' : 'waiting');
            const newStatus = isReschedule ? 'rescheduled' : 'scheduled';
            if (oldStatus !== newStatus) {
                await updateJobCandidateCounts(candidate.job_id, oldStatus, newStatus);
            }
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

        const oldCandidate = await Candidate.findOne(query).populate('interview_id');
        if (!oldCandidate) return res.status(404).json({ message: "Candidate not found or unauthorized" });

        if (updates.status) {
            updates.final_status = FINAL_STATUS_MAP[updates.status];
            delete updates.status;
        }

        // Automatically manage is_active based on final_status
        if (updates.final_status !== undefined) {
            updates.is_active = (updates.final_status === null);
        }

        // Handle result updates - set candidate status to 4 (INTERVIEWED) and update interview status
        if (updates.result && updates.result !== oldCandidate.result) {
            // Update interview status to match candidate result
            const RESULT_TO_INTERVIEW_STATUS = {
                'Selected': 3,
                'Rejected': 4,
                'No Show': 5,
                'Cancelled': 6,
                'Proxy': 7,
                'Technical Issue': 8
            };
            const RESULT_TO_INTERVIEW_STATUS_Ids = {
                '1': 3, // selected
                '2': 4, // rejected
                '3': 5, // no_show
                '4': 6, // cancelled
                '5': 8, // technical_issue
                '6': 7  // proxy
            };

            const newInterviewStatus = RESULT_TO_INTERVIEW_STATUS_Ids[updates.result];
            if (newInterviewStatus !== undefined && oldCandidate.interview_id) {
                await Interview.findByIdAndUpdate(oldCandidate.interview_id, { status: newInterviewStatus })
                    .catch(e => console.error("Failed to update interview status on result change:", e));
            }

            // Update candidate status to interviewed (4)
            updates.status = 4;
        }

        const candidate = await Candidate.findByIdAndUpdate(oldCandidate._id, updates, { new: true });

        // Update Job counts if result changed
        if (updates.result && updates.result !== oldCandidate.result) {
            const newJobField = RESULT_TO_JOB_FIELD[updates.result];


            if (newJobField && candidate.job_id) {
                const updateQuery = { $inc: {} };

                // Increment new status count
                updateQuery.$inc[`candidate_counts.${newJobField}`] = 1;

                // Decrement old status count or scheduled count
                if (oldCandidate.result) {
                    const oldJobField = RESULT_TO_JOB_FIELD[oldCandidate.result];
                    if (oldJobField) {
                        updateQuery.$inc[`candidate_counts.${oldJobField}`] = -1;
                    }
                } else if (oldCandidate.interview_id) {
                    const status = oldCandidate.interview_id.status;
                    if (status === 2) { // 2: interview_in_review
                        updateQuery.$inc["candidate_counts.interview_in_review"] = -1;
                    } else {
                        updateQuery.$inc["candidate_counts.scheduled"] = -1;
                    }
                }

                if (Object.keys(updateQuery.$inc).length > 0) {
                    await Job.findByIdAndUpdate(candidate.job_id, updateQuery)
                        .catch(e => console.error("Failed to update job counts on result change:", e));
                }
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

        const candidate = await Candidate.findOne(query)
            .populate('interview_id')
            .populate('job_id', 'title jobTitle')
            .populate('client_id', 'name');
        if (!candidate) return res.status(404).json({ message: "Candidate not found or unauthorized" });

        // If candidate has an active/pending interview, cancel it
        if (candidate.interview_id && [0, 1, 2].includes(candidate.interview_id.status)) {
            const interview = candidate.interview_id;

            try {
                // 1. Get Zoho Token
                const tokenUrl = `https://accounts.zoho.in/oauth/v2/token?refresh_token=${ENV.ZOHO_MEET_REFRESH_TOKEN}&client_id=${ENV.ZOHO_MEET_CLIENT_ID}&client_secret=${ENV.ZOHO_MEET_CLIENT_SECRET}&grant_type=refresh_token`;
                const tokenResponse = await axios.post(tokenUrl);
                const accessToken = tokenResponse.data.access_token;

                if (accessToken && interview.session_id) {
                    const zsoid = interview.zsoid || interview.presenter_id;
                    const cancelUrl = `https://meeting.zoho.in/api/v2/${zsoid}/sessions/${interview.session_id}.json`;

                    await axios.delete(cancelUrl, {
                        headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
                    }).catch(e => console.log("Zoho cancel failed or already cancelled:", e.message));
                }

                // 2. Update Interview status (6: cancelled)
                await Interview.findByIdAndUpdate(interview._id, { status: 6 });

                // 3. Free up interviewer availability
                await InterviewerAvailability.findOneAndUpdate(
                    { interviewer: interview.interviewer_id, start_time: interview.date_time },
                    { status: 1, $unset: { candidate_id: "" } }
                );

                // 4. Send Cancellation Email to Candidate
                try {
                    const transporter = nodemailer.createTransport({
                        host: ENV.SMTP_HOST,
                        port: ENV.SMTP_PORT,
                        secure: ENV.SMTP_SECURE,
                        auth: {
                            user: ENV.INTERVIEW_SMTP_USER,
                            pass: ENV.INTERVIEW_SMTP_PASS
                        }
                    });

                    const candidateName = candidate.full_name;
                    const jobTitle = candidate.job_id?.jobTitle || candidate.job_id?.title || "Position";
                    const clientName = candidate.client_id?.name || "Company";

                    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interview Cancelled</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background-color:#f4f4f4}.container{background-color:#fff;margin:0 auto;padding:20px;max-width:600px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1)}.header{background-color:#d32f2f;color:#fff;padding:20px;text-align:center;border-top-left-radius:8px;border-top-right-radius:8px}.header h1{margin:0;font-size:24px}.content{padding:20px;color:#333;line-height:1.6}.content p{margin:0 0 10px}.footer{text-align:center;color:#777;font-size:12px;margin-top:20px}h2{color:#333;margin-top:20px}.cancel-box{background-color:#fffef0;border-left:4px solid #d32f2f;padding:15px;margin:20px 0;border-radius:4px}</style></head><body><div class="container"><div class="header"><img width="100" src="https://firebasestorage.googleapis.com/v0/b/x-talento-new.appspot.com/o/assets%2Flogo.png?alt=media&token=0e681b04-04b6-4ebc-855e-dfcc3f9acabe" alt="rekrooot-img"><h1>Interview Cancelled</h1></div><div class="content"><h2>Dear <strong>${candidateName}</strong>,</h2><p>This is to inform you that your interview for the <strong>${jobTitle}</strong> position with <strong>${clientName}</strong> has been <strong>cancelled</strong> because your profile has been withdrawn or archived.</p><div class="cancel-box"><strong>Position:</strong> ${jobTitle}<br><strong>Company:</strong> ${clientName}</div><p>We apologize for any inconvenience this may have caused. If you have any questions, please contact us at <a href="mailto:hr@rekrooot.com">hr@rekrooot.com</a>.</p><p>Best regards,<br>The Rekrooot Interview Panel</p></div><div class="footer"><p> © 2026 <a href="#">Rekrooot</a> | All rights reserved.</p></div></div></body></html>`;

                    await transporter.sendMail({
                        from: ENV.INTERVIEW_MAIL_FROM,
                        to: candidate.email,
                        subject: `Interview Cancelled - ${candidateName} for ${jobTitle}`,
                        html
                    });
                } catch (mailErr) {
                    console.error("Failed to send cancellation email from backend:", mailErr.message);
                }

            } catch (error) {
                console.error("Error during automatic interview cancellation:", error.message);
                // We continue with candidate deletion even if Zoho cancellation fails
            }
        }
        let currentStatus = 'waiting';
        if (candidate.interview_id && [0, 1, 2].includes(candidate.interview_id.status)) {
            if (candidate.interview_id.status === 2) currentStatus = 'interview_in_review';
            else if (candidate.interview_id.status === 1) currentStatus = 'rescheduled';
            else currentStatus = 'scheduled';
        } else if (candidate.result) {
            currentStatus = RESULT_TO_JOB_FIELD[candidate.result] || 'waiting';
        }

        // Move candidate to trash
        await Candidate.findByIdAndUpdate(
            candidate._id,
            { trash: true, is_active: false, $unset: { interview_id: "" } }
        );

        // Update job candidate counts: decrement old status, increment trash
        await updateJobCandidateCounts(candidate.job_id, currentStatus, 'trash');

        return res.json({ message: "Candidate moved to trash and associated interview cancelled (if any)" });
    } catch (err) {
        next(err);
    }
});

router.post("/:id/restore", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;
        const query = { _id: id };

        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        }

        // Get the candidate before updating to determine their status
        const candidate = await Candidate.findOne(query).populate('interview_id');
        if (!candidate) return res.status(404).json({ message: "Candidate not found or unauthorized" });

        // Determine what status the candidate should have after restore
        let newStatus = 'waiting'; // default status
        if (candidate.interview_id && [0, 1, 2].includes(candidate.interview_id.status)) {
            if (candidate.interview_id.status === 2) newStatus = 'interview_in_review';
            else if (candidate.interview_id.status === 1) newStatus = 'rescheduled';
            else newStatus = 'scheduled';
        } else if (candidate.result) {
            newStatus = RESULT_TO_JOB_FIELD[candidate.result] || 'waiting';
        }

        // Restore the candidate
        const restoredCandidate = await Candidate.findOneAndUpdate(
            query,
            { trash: false, is_active: true },
            { new: true }
        );

        // Update job candidate counts: decrement trash, increment new status
        await updateJobCandidateCounts(candidate.job_id, 'trash', newStatus);

        return res.json({ message: "Candidate restored successfully", candidate: restoredCandidate });
    } catch (err) {
        next(err);
    }
});

router.delete("/:id/permanent", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;
        const query = { _id: id };

        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        }

        const candidate = await Candidate.findOneAndDelete(query);
        if (!candidate) return res.status(404).json({ message: "Candidate not found or unauthorized" });

        // Update job candidate counts: decrement trash count since candidate is permanently deleted
        await updateJobCandidateCounts(candidate.job_id, 'trash', null);

        return res.json({ message: "Candidate permanently deleted" });
    } catch (err) {
        next(err);
    }
});



export default router;
