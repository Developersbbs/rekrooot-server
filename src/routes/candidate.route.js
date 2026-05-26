import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth, attachUser } from "../middlewares/auth.middleware.js";
import { Candidate } from "../modals/candidate.model.js";
import { Job } from "../modals/job.model.js";
import { Interview } from "../modals/interview.model.js";
import InterviewerAvailability from "../modals/interviewerAvailability.model.js";
import Interviewer from "../modals/interviewer.model.js";
import axios from "axios";
import nodemailer from "nodemailer";
import { ENV } from "../config/env.js";
import multiparty from "multiparty";
import fs from "fs";
import { extractTextFromFile, parseResumeText } from "../services/resumeParser.js";
import { updateJobCandidateCounts } from "../services/jobService.js";

const router = Router();

async function getInterviewerAvailableSlots(interviewer, now, rangeEnd, slotMs, maxSlots = 3) {
    const [availability, bookedInterviews] = await Promise.all([
        InterviewerAvailability.find({
            interviewer: interviewer._id,
            start_time: { $lt: rangeEnd },
            end_time: { $gt: now },
            status: 1,
        }).sort({ start_time: 1 }).lean(),
        Interview.find({
            interviewer_id: interviewer._id,
            status: { $in: [0, 1] },
            date_time: { $gte: now, $lt: rangeEnd },
        }).select('date_time').lean(),
    ]);

    const slots = [];
    for (const range of availability) {
        const rs = new Date(range.start_time).getTime();
        const re = new Date(range.end_time).getTime();
        for (let ms = Math.max(rs, now.getTime()); ms + slotMs <= re && slots.length < maxSlots; ms += slotMs) {
            const slotEnd = ms + slotMs;
            const overlaps = bookedInterviews.some(i => {
                const iStart = new Date(i.date_time).getTime();
                return ms < iStart + slotMs && slotEnd > iStart;
            });
            if (!overlaps) {
                const d = new Date(ms);
                slots.push(
                    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' }) +
                    ' at ' +
                    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
                );
            }
        }
        if (slots.length >= maxSlots) break;
    }
    return slots;
}

async function sendSkillMatchEmail(candidate, jobId, slotDuration = 30) {
    try {
        const job = await Job.findById(jobId).populate('technologies', 'name');
        if (!job) {
            console.warn("sendSkillMatchEmail: job not found", jobId);
            return;
        }

        const jobTitle = job.title || 'the position';
        const candidateName = candidate.full_name;

        const duration = Number(slotDuration) || 30;
        const slotMs = duration * 60 * 1000;
        const now = new Date();
        const rangeEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

        let autoInterviewer = null;
        let autoSlots = [];
        let isSkillMatch = false;

        // If candidate already has an assigned interviewer, use them
        if (candidate.interviewer_id) {
            autoInterviewer = await Interviewer.findById(candidate.interviewer_id).populate('technologies', 'name').lean();
            if (autoInterviewer) {
                autoSlots = await getInterviewerAvailableSlots(autoInterviewer, now, rangeEnd, slotMs);
            }
        }

        if (!autoInterviewer) {
            // Safely extract technology IDs — filter out any nulls from broken populate refs
            const jobTechIds = (job.technologies || [])
                .filter(t => t && t._id)
                .map(t => t._id.toString());

            console.log(`sendSkillMatchEmail: job="${job.title}" jobTechIds=${JSON.stringify(jobTechIds)}`);

            // Step 1: Skill-matched interviewers (same technology as the job)
            if (jobTechIds.length) {
                const skillMatched = await Interviewer
                    .find({ technologies: { $in: jobTechIds } })
                    .populate('technologies', 'name')
                    .lean();

                console.log(`sendSkillMatchEmail: skill-matched count=${skillMatched.length} names=[${skillMatched.map(i => i.name).join(', ')}]`);

                // 1a: prefer skill-matched WITH available slots
                for (const interviewer of skillMatched) {
                    const slots = await getInterviewerAvailableSlots(interviewer, now, rangeEnd, slotMs);
                    if (slots.length > 0) {
                        autoInterviewer = interviewer;
                        autoSlots = slots;
                        isSkillMatch = true;
                        console.log(`sendSkillMatchEmail: selected skill-match WITH slots: ${interviewer.name}`);
                        break;
                    }
                }

                // 1b: accept skill-matched even WITHOUT slots
                if (!autoInterviewer && skillMatched.length > 0) {
                    autoInterviewer = skillMatched[0];
                    isSkillMatch = true;
                    console.log(`sendSkillMatchEmail: selected skill-match (no slots yet): ${autoInterviewer.name}`);
                }
            }

            // Step 2: No skill match found — any interviewer with open slots
            if (!autoInterviewer) {
                console.log(`sendSkillMatchEmail: no skill match, falling back to any interviewer with slots`);
                const availableIds = await InterviewerAvailability.find({
                    start_time: { $lt: rangeEnd },
                    end_time: { $gt: now },
                    status: 1,
                }).distinct('interviewer');

                if (availableIds.length) {
                    const fallbacks = await Interviewer
                        .find({ _id: { $in: availableIds } })
                        .populate('technologies', 'name')
                        .lean();

                    for (const interviewer of fallbacks) {
                        const slots = await getInterviewerAvailableSlots(interviewer, now, rangeEnd, slotMs);
                        if (slots.length > 0) {
                            autoInterviewer = interviewer;
                            autoSlots = slots;
                            console.log(`sendSkillMatchEmail: selected fallback WITH slots: ${interviewer.name}`);
                            break;
                        }
                    }
                }
            }

            // Step 3: Last resort — any interviewer in the system
            if (!autoInterviewer) {
                autoInterviewer = await Interviewer.findOne().populate('technologies', 'name').lean();
                console.log(`sendSkillMatchEmail: last-resort interviewer: ${autoInterviewer?.name || 'none'}`);
            }
        }

        // No interviewers exist in the system at all — skip
        if (!autoInterviewer) {
            console.log(`sendSkillMatchEmail: no interviewers in system, skipping email to ${candidate.email}`);
            return;
        }

        const bookingUrl = `${ENV.FRONTEND_BASE_URL}/timeslots?candidateId=${candidate._id}&interviewerId=${autoInterviewer._id}&duration=${slotDuration}`;

        const techList = autoInterviewer.technologies?.map(t => t.name).join(', ') || 'General';
        const slotListHtml = autoSlots.length
            ? autoSlots.map(s => `<li style="margin:4px 0;color:#374151;">${s}</li>`).join('')
            : `<li style="margin:4px 0;color:#374151;">Please visit the booking page to see available slots.</li>`;

        const interviewerSection = `
            <p>${isSkillMatch
                ? 'Based on your profile, we have assigned an interviewer who matches your skills:'
                : 'We have assigned an interviewer for your <strong>' + jobTitle + '</strong> interview:'
            }</p>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:12px 0;">
                <p style="margin:0 0 4px;font-weight:600;color:#111827;">${autoInterviewer.name}</p>
                <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Skills: ${techList}</p>
                <p style="margin:6px 0 4px;font-size:13px;font-weight:500;color:#374151;">Available slots:</p>
                <ul style="margin:0;padding-left:18px;font-size:13px;">
                    ${slotListHtml}
                </ul>
            </div>
            <p style="margin-top:12px;font-size:13px;color:#6b7280;">More slots are available on the booking page. Click below to pick the time that works best for you.</p>`;

        const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book Your Interview</title></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f4f4f4;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1);overflow:hidden;">
  <div style="background:#2f4858;padding:24px;text-align:center;">
    <img width="100" src="https://firebasestorage.googleapis.com/v0/b/x-talento-new.appspot.com/o/assets%2Flogo.png?alt=media&token=0e681b04-04b6-4ebc-855e-dfcc3f9acabe" alt="Rekrooot">
    <h1 style="color:#fff;margin:12px 0 0;font-size:22px;">Book Your Interview Slot</h1>
  </div>
  <div style="padding:24px;color:#333;">
    <h2 style="color:#111827;">Hi <strong>${candidateName}</strong>,</h2>
    <p>Thank you for applying for the <strong>${jobTitle}</strong> position.</p>
    ${interviewerSection}
    <div style="text-align:center;margin:28px 0;">
      <a href="${bookingUrl}" style="background:#fb8404;color:#fff;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;display:inline-block;">Book Your Interview Slot</a>
    </div>
    <p style="font-size:13px;color:#6b7280;">If you have any questions, contact us at <a href="mailto:hr@rekrooot.com">hr@rekrooot.com</a>.</p>
    <p>Best regards,<br><strong>The Rekrooot Recruitment Team</strong></p>
  </div>
  <div style="text-align:center;color:#9ca3af;font-size:12px;padding:16px;">© 2026 <a href="#">Rekrooot</a> | All rights reserved.</div>
</div>
</body></html>`;

        const transporter = nodemailer.createTransport({
            host: ENV.SMTP_HOST,
            port: ENV.SMTP_PORT,
            secure: ENV.SMTP_SECURE,
            auth: { user: ENV.INTERVIEW_SMTP_USER, pass: ENV.INTERVIEW_SMTP_PASS },
        });

        await transporter.sendMail({
            from: ENV.INTERVIEW_MAIL_FROM,
            to: candidate.email,
            subject: `Book Your Interview Slot – ${jobTitle}`,
            html,
        });

        console.log(`Auto-assign email sent to ${candidate.email} for job: ${jobTitle}, interviewer: ${autoInterviewer?.name || 'none'}`);
    } catch (err) {
        console.error("sendSkillMatchEmail error:", err.message, err.stack);
    }
}

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
            .populate('job_id', 'title jobTitle description')
            .populate('client_id', 'name')
            .populate('vendor_id', 'name')
            .populate('company_id', 'name')
            .populate('interviewer_id', 'name')
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
            .populate('job_id', 'title jobTitle description')
            .populate('client_id', 'name logo')
            .populate('company_id', 'name')
            .populate('interview_id')
            .select('full_name email job_id client_id company_id interview_id interviewer_id created_by vendor_id experience_years resumes');

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

        if (req.user.role === 4) {
            // Interviewers can only view candidates assigned to them via an interview
            const interviewer = await Interviewer.findOne({ email: req.user.email });
            if (!interviewer) {
                return res.status(403).json({ message: "Interviewer profile not found" });
            }
            const interview = await Interview.findOne({ interviewer_id: interviewer._id, candidate_id: id });
            if (!interview) {
                return res.status(403).json({ message: "Access denied: candidate not assigned to you" });
            }
        } else if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        }

        const candidate = await Candidate.findOne(query)
            .populate('job_id')
            .populate('client_id')
            .populate('vendor_id')
            .populate('company_id')
            .populate('interviewer_id', 'name')
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

        // ✅ FALLBACK: If interview_id is missing (e.g. from previous soft-deletes), find it via candidate_id
        if (!candidate.interview_id) {
            const lastInterview = await Interview.findOne({ candidate_id: candidate._id })
                .sort({ created_at: -1 })
                .populate('interviewer_id', 'name');

            if (lastInterview) {
                const candidateObj = candidate.toObject();
                candidateObj.interview_id = lastInterview;
                return res.json({ candidate: candidateObj });
            }
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
            interview_id,
            skip_invitation_email,
            slot_duration,
            interviewer_id
        } = req.body;

        const target_company_id = req.user.role === 0 ? company_id : req.user.company_id;

        if (!target_company_id) {
            return res.status(400).json({ message: "Company ID is required" });
        }

        // ✅ HANDLE DUPLICATE APPLICATION FOR DIFFERENT ROLE
        const existingCandidate = await Candidate.findOne({
            email: email.toLowerCase(),
            company_id: target_company_id,
            trash: false
        }).populate('interview_id job_id client_id vendor_id');

        if (existingCandidate && existingCandidate.job_id?._id?.toString() !== job_id?.toString()) {
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

                const candidateName = existingCandidate.full_name;
                const oldJobTitle = existingCandidate.job_id?.title || existingCandidate.job_id?.jobTitle || 'the current position';
                const oldClientName = existingCandidate.client_id?.name || 'our client';

                // Case 1: Waiting for previous role
                if (existingCandidate.status === 0) {
                    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Application Update</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background-color:#f4f4f4}.container{background-color:#fff;margin:0 auto;padding:20px;max-width:600px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1)}.header{background-color:#2f4858;color:#fff;padding:20px;text-align:center;border-top-left-radius:8px;border-top-right-radius:8px}.header h1{margin:0;font-size:24px}.content{padding:20px;color:#333;line-height:1.6}.content p{margin:0 0 10px}.footer{text-align:center;color:#777;font-size:12px;margin-top:20px}h2{color:#333;margin-top:20px}.info-box{background-color:#f0f9ff;border-left:4px solid #2f4858;padding:15px;margin:20px 0;border-radius:4px}</style></head><body><div class="container"><div class="header"><img width="100" src="https://firebasestorage.googleapis.com/v0/b/x-talento-new.appspot.com/o/assets%2Flogo.png?alt=media&token=0e681b04-04b6-4ebc-855e-dfcc3f9acabe" alt="rekrooot-img"><h1>Application Update</h1></div><div class="content"><h2>Dear <strong>${candidateName}</strong>,</h2><p>Thank you for your interest in the <strong>${oldJobTitle}</strong> position with <strong>${oldClientName}</strong>.</p><p>We would like to inform you that your application for this specific role has been <strong>declined</strong> as you have recently applied for a different position within our recruitment portal.</p><div class="info-box"><strong>Previous Role:</strong> ${oldJobTitle}<br><strong>Status:</strong> Discontinued in favor of new application</div><p>We will proceed with your most recent application and will keep you updated on its progress.</p><p>If you have any questions, please contact us at <a href="mailto:hr@rekrooot.com">hr@rekrooot.com</a>.</p><p>Best regards,<br>The Rekrooot Recruitment Team</p></div><div class="footer"><p> © 2026 <a href="#">Rekrooot</a> | All rights reserved.</p></div></div></body></html>`;

                    await transporter.sendMail({
                        from: ENV.INTERVIEW_MAIL_FROM,
                        to: email,
                        subject: `Application Update - ${candidateName} for ${oldJobTitle}`,
                        html
                    }).catch(e => console.error("Failed to send decline mail:", e.message));
                }
                // Case 2: Scheduled/Rescheduled for previous role
                else if ([1, 2].includes(existingCandidate.status)) {
                    if (existingCandidate.interview_id) {
                        const interview = existingCandidate.interview_id;
                        if (interview.session_id && interview.presenter_id) {
                            try {
                                const tokenUrl = `https://accounts.zoho.in/oauth/v2/token?refresh_token=${ENV.ZOHO_MEET_REFRESH_TOKEN}&client_id=${ENV.ZOHO_MEET_CLIENT_ID}&client_secret=${ENV.ZOHO_MEET_CLIENT_SECRET}&grant_type=refresh_token`;
                                const tokenResponse = await axios.post(tokenUrl);
                                const accessToken = tokenResponse.data.access_token;
                                if (accessToken) {
                                    const zsoid = interview.zsoid || interview.presenter_id;
                                    const cancelUrl = `https://meeting.zoho.in/api/v2/${zsoid}/sessions/${interview.session_id}.json`;
                                    await axios.delete(cancelUrl, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
                                }
                            } catch (e) {
                                console.warn("Zoho cancellation failed for old application:", e.message);
                            }
                        }
                        // await Interview.findByIdAndUpdate(interview._id, { status: 6 }); // Removed as per request: don't update interview status on soft delete
                        await InterviewerAvailability.findOneAndUpdate(
                            {
                                $or: [
                                    { interviewer: interview.interviewer_id, start_time: interview.date_time },
                                    { candidate_id: existingCandidate._id }
                                ]
                            },
                            { status: 1, $unset: { candidate_id: "" } }
                        ).catch(e => console.error("Failed to free availability for old application:", e));
                    }

                    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interview Cancelled</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background-color:#f4f4f4}.container{background-color:#fff;margin:0 auto;padding:20px;max-width:600px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1)}.header{background-color:#d32f2f;color:#fff;padding:20px;text-align:center;border-top-left-radius:8px;border-top-right-radius:8px}.header h1{margin:0;font-size:24px}.content{padding:20px;color:#333;line-height:1.6}.content p{margin:0 0 10px}.footer{text-align:center;color:#777;font-size:12px;margin-top:20px}h2{color:#333;margin-top:20px}.cancel-box{background-color:#fffef0;border-left:4px solid #d32f2f;padding:15px;margin:20px 0;border-radius:4px}</style></head><body><div class="container"><div class="header"><img width="100" src="https://firebasestorage.googleapis.com/v0/b/x-talento-new.appspot.com/o/assets%2Flogo.png?alt=media&token=0e681b04-04b6-4ebc-855e-dfcc3f9acabe" alt="rekrooot-img"><h1>Interview Cancelled</h1></div><div class="content"><h2>Dear <strong>${candidateName}</strong>,</h2><p>This is to inform you that your interview for the <strong>${oldJobTitle}</strong> position with <strong>${oldClientName}</strong> has been <strong>cancelled</strong> as you have recently applied for a different position within our recruitment portal.</p><div class="cancel-box"><strong>Position:</strong> ${oldJobTitle}<br><strong>Company:</strong> ${oldClientName}</div><p>We apologize for any inconvenience this may have caused. If you have any questions, please contact us at <a href="mailto:hr@rekrooot.com">hr@rekrooot.com</a>.</p><p>Best regards,<br>The Rekrooot Interview Panel</p></div><div class="footer"><p> © 2026 <a href="#">Rekrooot</a> | All rights reserved.</p></div></div></body></html>`;

                    await transporter.sendMail({
                        from: ENV.INTERVIEW_MAIL_FROM,
                        to: email,
                        subject: `Interview Cancelled - ${candidateName} for ${oldJobTitle}`,
                        html
                    }).catch(e => console.error("Failed to send cancellation mail:", e.message));
                }

                // Update old job counts
                let oldStatusField = 'waiting';
                if (existingCandidate.status === 1) oldStatusField = 'scheduled';
                else if (existingCandidate.status === 2) oldStatusField = 'rescheduled';
                else if (existingCandidate.status === 3) oldStatusField = 'interview_in_review';
                else if (existingCandidate.status === 5) oldStatusField = 'cancelled';

                await Job.findByIdAndUpdate(existingCandidate.job_id?._id, {
                    $inc: {
                        [`candidate_counts.${oldStatusField}`]: -1,
                        'candidate_counts.trash': 1
                    }
                }).catch(e => console.error("Failed to update old job counts:", e.message));

                // Move to trash
                existingCandidate.trash = true;
                await existingCandidate.save();

            } catch (err) {
                console.error("Error handling existing candidate during new application:", err.message);
            }
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
            interview_id,
            slot_duration: slot_duration || 30,
            interviewer_id
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

        // If no slot was assigned AND recruiter hasn't taken over email, send candidate booking link
        if (!interview_id && !skip_invitation_email && candidate.email && job_id) {
            sendSkillMatchEmail(candidate, job_id, candidate.slot_duration).catch(e =>
                console.error("Skill-match email failed:", e.message)
            );
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
        let previousInterviewStatus = null;

        // ✅ STEP 2: Handle existing interview (if any)
        if (candidate.interview_id) {
            const interview = await Interview.findById(candidate.interview_id).lean();

            if (interview) {
                previousInterviewTime = interview.date_time;
                previousInterview = interview._id;
                previousInterviewStatus = interview.status;

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
                await InterviewerAvailability.findOneAndUpdate(
                    {
                        $or: [
                            { interviewer: interview.interviewer_id, start_time: previousInterviewTime },
                            { candidate_id: candidate._id }
                        ]
                    },
                    {
                        status: 1,
                        $unset: { candidate_id: "" }
                    }
                ).catch(e =>
                    console.error("Failed to free availability during migration:", e)
                );
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

        // ✅ STEP 4: Update Job Counts if job changed
        if (new_job_id && previousJobRole && new_job_id.toString() !== previousJobRole.toString()) {
            try {
                // 1. Determine old status field
                let oldStatusField = 'waiting';
                if (candidate.result) {
                    oldStatusField = RESULT_TO_JOB_FIELD[candidate.result] || 'waiting';
                } else if (previousInterviewStatus !== null) {
                    const statusMap = {
                        0: 'scheduled',
                        1: 'rescheduled',
                        2: 'interview_in_review',
                        3: 'selected',
                        4: 'rejected',
                        5: 'no_show',
                        6: 'cancelled',
                        7: 'proxy',
                        8: 'technical_issue'
                    };
                    oldStatusField = statusMap[previousInterviewStatus] || 'waiting';
                } else {
                    if (previousCandidateStatus === 1) oldStatusField = 'scheduled';
                    else if (previousCandidateStatus === 2) oldStatusField = 'rescheduled';
                    else if (previousCandidateStatus === 3) oldStatusField = 'interview_in_review';
                    else if (previousCandidateStatus === 5) oldStatusField = 'cancelled';
                    else oldStatusField = 'waiting';
                }

                // 2. Determine new status field
                const newStatusField = new_interview_id ? 'scheduled' : 'waiting';

                // 3. Decrement old job counts
                await Job.findByIdAndUpdate(previousJobRole, {
                    $inc: {
                        [`candidate_counts.${oldStatusField}`]: -1,
                        'candidate_counts.applied': -1
                    }
                });

                // 4. Increment new job counts
                await Job.findByIdAndUpdate(new_job_id, {
                    $inc: {
                        [`candidate_counts.${newStatusField}`]: 1,
                        'candidate_counts.applied': 1
                    }
                });

                // 5. Unset obsoleted result data for the new job
                updateFields.result = undefined;
                updateFields.result_document_url = undefined;

            } catch (countError) {
                console.error("Failed to update job counts during migration:", countError.message);
            }
        }

        // ✅ STEP 5: Push migration history (STORE ONLY CANDIDATE STATUS)
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
                $unset: {
                    ...(new_interview_id ? {} : { interview_id: "", interviewer_id: "" }),
                    // If job changed, also unset result data
                    ...(new_job_id && previousJobRole && new_job_id.toString() !== previousJobRole.toString() ? { result: "", result_document_url: "" } : {})
                }
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
        const { interviewDate, interviewTime, interviewerId, meetingLink, sessionId, presenterId, zsoid, startTimeIso } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid candidate ID" });
        }

        const oldCandidate = await Candidate.findById(id);
        if (!oldCandidate) return res.status(404).json({ message: "Candidate not found" });

        // Conflict check: reject if the requested slot is already booked by another candidate
        let newSlotDate = null;
        if (startTimeIso) {
            newSlotDate = new Date(startTimeIso);
        } else if (interviewDate && interviewTime) {
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
                        newSlotDate = dt;
                    }
                }
            } catch (_) { /* ignore parse errors */ }
        }

        if (newSlotDate && interviewerId && mongoose.Types.ObjectId.isValid(interviewerId)) {
            const conflict = await Interview.findOne({
                interviewer_id: interviewerId,
                date_time: newSlotDate,
                status: { $in: [0, 1] }, // scheduled or rescheduled
                candidate_id: { $ne: new mongoose.Types.ObjectId(id) }
            });
            if (conflict) {
                return res.status(409).json({
                    message: "This time slot is already booked by another candidate. Please select a different slot."
                });
            }
        }

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

            // Prefer startTimeIso (UTC ISO string from client) to avoid server-side timezone parse issues.
            // Fall back to reconstructing from interviewDate + interviewTime for backwards compatibility.
            if (startTimeIso) {
                interviewUpdate.date_time = new Date(startTimeIso);
            } else if (interviewDate && interviewTime) {
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

        // Update Interviewer availability — use startTimeIso if available for exact match
        if (interviewerId && (startTimeIso || (interviewDate && interviewTime))) {
            try {
                let slotDate;

                if (startTimeIso) {
                    // Use the ISO timestamp directly — guaranteed correct UTC time
                    slotDate = new Date(startTimeIso);
                } else {
                    // Legacy: reconstruct from locale-formatted strings
                    const [timePart, periodPart] = interviewTime.split(' ');
                    let [hourStr, minuteStr] = timePart.split(':');
                    let hour = parseInt(hourStr);

                    if (periodPart === 'PM' && hour !== 12) hour += 12;
                    else if (periodPart === 'AM' && hour === 12) hour = 0;

                    slotDate = new Date(interviewDate);
                    slotDate.setHours(hour, parseInt(minuteStr), 0, 0);
                }

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

        if ([1, 2].includes(candidate.status) || (candidate.interview_id && [0, 1, 2].includes(candidate.interview_id.status))) {
            // Existing cancellation logic (already there, but wrapped for clarity)
            const interview = candidate.interview_id;
            try {
                // 1. Get Zoho Token
                if (interview?.session_id) {
                    const tokenUrl = `https://accounts.zoho.in/oauth/v2/token?refresh_token=${ENV.ZOHO_MEET_REFRESH_TOKEN}&client_id=${ENV.ZOHO_MEET_CLIENT_ID}&client_secret=${ENV.ZOHO_MEET_CLIENT_SECRET}&grant_type=refresh_token`;
                    const tokenResponse = await axios.post(tokenUrl);
                    const accessToken = tokenResponse.data.access_token;

                    if (accessToken) {
                        const zsoid = interview.zsoid || interview.presenter_id;
                        const cancelUrl = `https://meeting.zoho.in/api/v2/${zsoid}/sessions/${interview.session_id}.json`;

                        await axios.delete(cancelUrl, {
                            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
                        }).catch(e => console.log("Zoho cancel failed or already cancelled:", e.message));
                    }
                }

                // 2. Free up interviewer availability
                await InterviewerAvailability.findOneAndUpdate(
                    {
                        $or: [
                            { interviewer: interview?.interviewer_id, start_time: interview?.date_time },
                            { candidate_id: candidate._id }
                        ]
                    },
                    { status: 1, $unset: { candidate_id: "" } }
                ).catch(e => console.error("Failed to free availability during delete:", e));

            } catch (error) {
                console.error("Error during automatic interview cancellation:", error.message);
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
            { trash: true, is_active: false }
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
        const candidate = await Candidate.findOne(query)
            .populate({
                path: 'interview_id',
                populate: { path: 'interviewer_id', select: 'name email' }
            })
            .populate('job_id', 'title jobTitle')
            .populate('client_id', 'name');

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

        // ✅ HANDLE EMAIL FOR SCHEDULED/RESCHEDULED CANDIDATES
        if (newStatus === 'scheduled' || newStatus === 'rescheduled') {
            const interview = candidate.interview_id;
            if (interview) {
                try {
                    // Try to re-book the availability slot
                    await InterviewerAvailability.findOneAndUpdate(
                        { interviewer: interview.interviewer_id, start_time: interview.date_time, status: 1 },
                        { status: 2, candidate_id: candidate._id }
                    ).catch(e => console.warn("Failed to re-book slot during restore:", e.message));

                    // Send Invitation Email
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
                    const interviewerName = interview.interviewer_id?.name || "Interviewer";
                    const selectedTimeSlot = new Date(interview.date_time).toLocaleString('en-US', {
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                        hour: 'numeric', minute: '2-digit', hour12: true,
                        timeZone: 'Asia/Kolkata'
                    });
                    const link = interview.meeting_link;

                    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interview Invitation</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background-color:#f4f4f4}.container{background-color:#fff;margin:0 auto;padding:20px;max-width:600px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1)}.header{background-color:#2f4858;color:#fff;padding:20px;text-align:center;border-top-left-radius:8px;border-top-right-radius:8px}.header h1{margin:0;font-size:24px}.content{padding:20px;color:#333;line-height:1.6}.content p{margin:0 0 10px}.button{text-align:center;margin:20px 0}.button a{background-color:#2f4858;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-size:16px}.button a:hover{color:#2f4858;background-color:#fb8404}.footer{text-align:center;color:#777;font-size:12px;margin-top:20px}h2{color:#333;margin-top:20px}ul{margin:10px 0;padding-left:20px}li{margin-bottom:5px}.highlight-box{background-color:#f0f9ff;border-left:4px solid:#2f4858;padding:15px;margin:20px 0;border-radius:4px}</style></head><body><div class="container"><div class="header"><img width="100" src="https://firebasestorage.googleapis.com/v0/b/x-talento-new.appspot.com/o/assets%2Flogo.png?alt=media&token=0e681b04-04b6-4ebc-855e-dfcc3f9acabe" alt="rekrooot-img"><h1>Interview Invitation</h1></div><div class="content"><h2>Dear <strong>${candidateName}</strong>,</h2><p>We hope you're doing great! Your application for the <strong>${jobTitle}</strong> position with <strong>${clientName}</strong>.</p><p>We are pleased to confirm that your interview is still <strong>scheduled</strong> for the following time:</p><div class="highlight-box"><strong>Interview Time:</strong> ${selectedTimeSlot}<br><strong>Interviewer:</strong> ${interviewerName}</div>${link ? `<p>Please join the interview using the link below at the scheduled time:</p><div class="button"><a href="${link}" target="_blank">Join Interview</a></div>` : ''}<h2>Interview Guidelines</h2><ul><li>Make sure you have a <strong>laptop with a working camera</strong>.</li><li>Set up in a <strong>well-lit</strong> space for clear visibility.</li><li><strong>Share your desktop</strong> during the interview and avoid external assistance.</li><li>Close all background applications; using <strong>remote connections</strong> or dual monitors is not allowed.</li><li>Ensure you have a <strong>strong internet connection</strong> and a webcam.</li><li>The interview will be <strong>recorded</strong> and will include coding and theoretical questions.</li><li>Please connect using a <strong>laptop or desktop</strong>—handheld devices aren't allowed.</li></ul><p>If you have any questions, feel free to reach out to us at <a href="mailto:hr@rekrooot.com">hr@rekrooot.com</a>.</p><p>Best regards,<br>The Rekrooot Interview Panel</p></div><div class="footer"><p> © 2026 <a href="#">Rekrooot</a> | All rights reserved.</p></div></div></body></html>`;

                    await transporter.sendMail({
                        from: ENV.INTERVIEW_MAIL_FROM,
                        to: candidate.email,
                        subject: `Interview Invitation - ${candidateName} for ${jobTitle}`,
                        html
                    }).catch(e => console.error("Failed to send restore invitation email:", e.message));

                } catch (err) {
                    console.error("Error handling interview restore logic:", err.message);
                }
            }
        }
        // ✅ HANDLE EMAIL FOR WAITING CANDIDATES
        else if (newStatus === 'waiting') {
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
                const link = `https://rekrooot.com/candidate/interview-slot/${candidate._id}`;

                const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email Invitation</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background-color:#f4f4f4}.container{background-color:#fff;margin:0 auto;padding:20px;max-width:600px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1)}.header{background-color:#2f4858;color:#fff;padding:20px;text-align:center;border-top-left-radius:8px;border-top-right-radius:8px}.header h1{margin:0;font-size:24px}.content{padding:20px;color:#333;line-height:1.6}.content p{margin:0 0 10px}.button{text-align:center;margin:20px 0}.button a{background-color:#2f4858;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-size:16px}.button a:hover{color:#2f4858;background-color:#fb8404}.footer{text-align:center;color:#777;font-size:12px;margin-top:20px}h2{color:#333;margin-top:20px}ul{margin:10px 0;padding-left:20px}li{margin-bottom:5px}</style></head><body><div class="container"><div class="header"><img width="100" src="https://firebasestorage.googleapis.com/v0/b/x-talento-new.appspot.com/o/assets%2Flogo.png?alt=media&token=0e681b04-04b6-4ebc-855e-dfcc3f9acabe" alt="rekrooot-img"><h1>Interview Invitation</h1></div><div class="content"><h2>Dear <strong>${candidateName}</strong>,</h2><p>We hope you're doing great! Your application for the <strong>${jobTitle}</strong> position with <strong>${clientName}</strong>.</p><p>Please select your preferred interview time slot using the link below to proceed with the next step of the hiring process – <strong>congratulations</strong> on your achievement!</p><div class="button"><a href="${link}" target="_blank">Select Your Interview Timeslot</a></div><h2>Interview Guidelines</h2><ul><li>Make sure you have a <strong>laptop with a working camera</strong>.</li><li>Set up in a <strong>well-lit</strong> space for clear visibility.</li><li><strong>Share your desktop</strong> during the interview and avoid external assistance.</li><li>Close all background applications; using <strong>remote connections</strong> or dual monitors is not allowed.</li><li>Ensure you have a <strong>strong internet connection</strong> and a webcam.</li><li>The interview will be <strong>recorded</strong> and will include coding and theoretical questions.</li><li>Please connect using a <strong>laptop or desktop</strong>—handheld devices aren't allowed.</li></ul><p>If you have any questions or need clarification before the interview, feel free to reach out to us at <a href="mailto:hr@rekrooot.com">hr@rekrooot.com</a>.</p><p>We're looking forward to seeing you in the Interview. Best of luck in your preparations!</p><p>Best regards,<br>The Rekrooot Interview Panel</p></div><div class="footer"><p> © 2026 <a href="#">Rekrooot</a> | All rights reserved.</p></div></div></body></html>`;

                await transporter.sendMail({
                    from: ENV.INTERVIEW_MAIL_FROM,
                    to: candidate.email,
                    subject: `Interview Scheduling - ${candidateName} for ${jobTitle}`,
                    html
                }).catch(e => console.error("Failed to send restore scheduling email:", e.message));

            } catch (err) {
                console.error("Error handling waiting restore logic:", err.message);
            }
        }

        return res.json({ message: "Candidate restored successfully and invitation re-sent if applicable", candidate: restoredCandidate });
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
