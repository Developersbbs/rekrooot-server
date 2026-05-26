import { Router } from "express";
import axios from "axios";
import nodemailer from "nodemailer";
import { ENV } from "../config/env.js";
import mongoose from "mongoose";
import Interviewer from "../modals/interviewer.model.js";
import { Interview } from "../modals/interview.model.js";
import { Candidate } from "../modals/candidate.model.js";
import InterviewerAvailability from "../modals/interviewerAvailability.model.js";
import { Job } from "../modals/job.model.js";
import { updateJobCandidateCounts } from "../services/jobService.js";

const router = Router();

// POST /create - Create a Zoho meeting
router.post("/create", async (req, res, next) => {
    try {
        const {
            authToken,
            topic,
            agenda,
            presenter,
            startTime,
            duration,
            timezone,
            participants,
            interviewerId,
            candidateId
        } = req.body;

        if (startTime) {
            const parsedDate = new Date(startTime);
            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({ error: 'Invalid startTime format' });
            }
        }

        // 1. Get Access Token
        let accessToken = authToken;

        if (!accessToken) {
            const tokenUrl = `https://accounts.zoho.in/oauth/v2/token?refresh_token=${ENV.ZOHO_MEET_REFRESH_TOKEN}&client_id=${ENV.ZOHO_MEET_CLIENT_ID}&client_secret=${ENV.ZOHO_MEET_CLIENT_SECRET}&grant_type=refresh_token`;

            try {
                const tokenResponse = await axios.post(tokenUrl);
                accessToken = tokenResponse.data.access_token;
            } catch (tokenErr) {
                console.error("Failed to get Zoho access token:", tokenErr.message);
                return res.status(500).json({
                    message: "Failed to get Zoho access token",
                    error: tokenErr.response?.data || tokenErr.message
                });
            }
        }

        // 2. Fetch Candidate and Interviewer
        let candidate = null;
        if (candidateId) {
            candidate = await Candidate.findById(candidateId);
        }

        let interviewer = null;
        if (interviewerId) {
            interviewer = await Interviewer.findById(interviewerId);
        }

        // 3. Conflict check: reject if this slot is already booked by another candidate
        const slotToCheck = req.body.startTimeIso ? new Date(req.body.startTimeIso) : (startTime ? new Date(startTime) : null);
        if (interviewerId && mongoose.Types.ObjectId.isValid(interviewerId) && slotToCheck && !isNaN(slotToCheck.getTime())) {
            const excludeCandidate = candidateId && mongoose.Types.ObjectId.isValid(candidateId)
                ? { candidate_id: { $ne: new mongoose.Types.ObjectId(candidateId) } }
                : {};
            const conflict = await Interview.findOne({
                interviewer_id: interviewerId,
                date_time: slotToCheck,
                status: { $in: [0, 1] }, // scheduled or rescheduled
                ...excludeCandidate
            });
            if (conflict) {
                return res.status(409).json({
                    message: "This time slot is already booked by another candidate. Please select a different slot."
                });
            }
        }

        // 4. Determine Context ID (Presenter ZUID)
        let contextId = presenter;

        if (!contextId && interviewer) {
            contextId = interviewer.zoho_meet_uid;
        }

        if (!contextId) {
            contextId = ENV.ZOHO_DEFAULT_PRESENTER_ID || '60058686791';
        }

        const url = `https://meeting.zoho.in/api/v2/${contextId}/sessions.json`;

        const missingFields = [];
        if (!accessToken) missingFields.push('authToken');
        if (!topic) missingFields.push('topic');
        if (!startTime) missingFields.push('startTime');
        if (!participants) missingFields.push('participants');

        if (missingFields.length > 0) {
            return res.status(400).json({ error: 'Missing required fields', fields: missingFields });
        }

        const payload = {
            session: {
                topic,
                agenda,
                presenter: contextId,
                startTime,
                duration: duration || 3600000,
                timezone: timezone || "Asia/Kolkata",
                participants: (participants || []).filter(p => p.email)
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'Authorization': `Zoho-oauthtoken ${accessToken}`
            }
        });

        const meetData = response.data;
        console.log('Meeting creation response:', meetData);

        if (meetData && meetData.session) {
            const session = meetData.session;
            const meetingLink = session.joinLink || session.join_url || session.meetingLink || session.url;
            const sessionId = session.meetingKey || session.meeting_key || session.id;
            const zsoid = session.zsoid || (session.meeting && session.meeting.zsoid);

            const interviewData = {
                interviewer_id: interviewerId,
                candidate_id: candidateId,
                candidate_name: candidate?.full_name || "N/A",
                candidate_email: candidate?.email || "N/A",
                // Prefer startTimeIso (raw UTC ISO string from client) to avoid timezone parse issues.
                // Fallback to parsing startTime for backwards compatibility.
                date_time: req.body.startTimeIso ? new Date(req.body.startTimeIso) : new Date(startTime),
                duration_ms: duration || 3600000,
                interviewer_name: interviewer?.name || "N/A",
                meeting_link: meetingLink,
                session_id: sessionId,
                presenter_id: contextId,
                zsoid: zsoid,
                company_id: candidate?.company_id,
                client_id: candidate?.client_id,
                job_id: candidate?.job_id,
                created_by: candidate?.created_by,
                status: 0
            };

            const newInterview = await Interview.create(interviewData);

            if (candidate) {
                await Candidate.findByIdAndUpdate(candidateId, {
                    interview_id: newInterview._id,
                    status: 1 // scheduled
                });
            }

            if (interviewer && startTime) {
                const startDate = new Date(startTime);
                try {
                    const availability = await InterviewerAvailability.findOneAndUpdate(
                        { interviewer: interviewerId, start_time: startDate },
                        { status: 2, candidate_id: candidateId },
                        { new: true }
                    );

                    if (!availability) {
                        console.warn("No InterviewerAvailability slot found to book for:", { interviewerId, startTime });
                    }
                } catch (availErr) {
                    console.error("Failed to update InterviewerAvailability status:", availErr.message);
                }
            }

            // ✅ FIXED: Decrement actual previous status, not always waiting
            if (candidate?.job_id) {
                try {
                    // Use the status from the candidate object we fetched at the beginning of the request
                    // to determine the CORRECT previous status field to decrement.
                    const prevStatusField =
                        candidate.status === 1 ? "scheduled" :
                            candidate.status === 2 ? "rescheduled" :
                                candidate.interview_id ? "scheduled" :
                                    "waiting";

                    await updateJobCandidateCounts(candidate.job_id, prevStatusField, "scheduled");
                } catch (jobErr) {
                    console.error("Failed to update Job candidate counts:", jobErr.message);
                }
            }

            // ✅ Send slot booking confirmation email to candidate (non-blocking)
            if (candidate?.email) {
                (async () => {
                    try {
                        let jobTitle = 'the position';
                        if (candidate.job_id) {
                            const job = await Job.findById(candidate.job_id).select('title').lean().catch(() => null);
                            jobTitle = job?.title || 'the position';
                        }

                        const interviewerName = interviewer?.name || 'Interviewer';
                        const slotDate = new Date(newInterview.date_time);
                        const scheduledDateTime = slotDate.toLocaleString('en-US', {
                            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                            hour: 'numeric', minute: '2-digit', hour12: true,
                            timeZone: 'Asia/Kolkata',
                        });

                        const bookingTransporter = nodemailer.createTransport({
                            host: ENV.SMTP_HOST,
                            port: ENV.SMTP_PORT,
                            secure: ENV.SMTP_SECURE,
                            auth: { user: ENV.INTERVIEW_SMTP_USER, pass: ENV.INTERVIEW_SMTP_PASS },
                        });

                        const confirmationHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interview Confirmed</title></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f4f4f4;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1);overflow:hidden;">
  <div style="background:#2f4858;padding:24px;text-align:center;">
    <img width="100" src="https://firebasestorage.googleapis.com/v0/b/x-talento-new.appspot.com/o/assets%2Flogo.png?alt=media&token=0e681b04-04b6-4ebc-855e-dfcc3f9acabe" alt="Rekrooot">
    <h1 style="color:#fff;margin:12px 0 0;font-size:22px;">Interview Slot Confirmed!</h1>
  </div>
  <div style="padding:24px;color:#333;">
    <h2 style="color:#111827;">Hi <strong>${candidate.full_name}</strong>,</h2>
    <p>Great news! Your interview for the <strong>${jobTitle}</strong> position has been successfully scheduled.</p>
    <div style="background:#f0f9ff;border-left:4px solid #2f4858;padding:16px;margin:16px 0;border-radius:6px;">
      <p style="margin:0 0 8px;font-size:14px;"><strong>📅 Date &amp; Time:</strong> ${scheduledDateTime}</p>
      <p style="margin:0 0 8px;font-size:14px;"><strong>👤 Interviewer:</strong> ${interviewerName}</p>
      <p style="margin:0;font-size:14px;"><strong>💻 Format:</strong> Virtual (Zoho Meeting)</p>
    </div>
    ${meetingLink ? `<div style="text-align:center;margin:24px 0;"><a href="${meetingLink}" style="background:#fb8404;color:#fff;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;display:inline-block;">Join Interview</a></div>` : ''}
    <h3 style="color:#111827;margin-top:20px;">Interview Guidelines</h3>
    <ul style="margin:10px 0;padding-left:20px;font-size:14px;line-height:1.9;">
      <li>Make sure you have a <strong>laptop with a working camera</strong>.</li>
      <li>Set up in a <strong>well-lit</strong> space for clear visibility.</li>
      <li><strong>Share your desktop</strong> during the interview and avoid external assistance.</li>
      <li>Close all background applications; using <strong>remote connections</strong> or dual monitors is not allowed.</li>
      <li>Ensure you have a <strong>strong internet connection</strong> and a webcam.</li>
      <li>The interview will be <strong>recorded</strong> and will include coding and theoretical questions.</li>
      <li>Please connect using a <strong>laptop or desktop</strong> — handheld devices are not allowed.</li>
    </ul>
    <p style="font-size:13px;color:#6b7280;">If you have any questions, contact us at <a href="mailto:hr@rekrooot.com">hr@rekrooot.com</a>.</p>
    <p>Best regards,<br><strong>The Rekrooot Recruitment Team</strong></p>
  </div>
  <div style="text-align:center;color:#9ca3af;font-size:12px;padding:16px;">© 2026 <a href="#">Rekrooot</a> | All rights reserved.</div>
</div>
</body></html>`;

                        await bookingTransporter.sendMail({
                            from: ENV.INTERVIEW_MAIL_FROM,
                            to: candidate.email,
                            subject: `Interview Confirmed – ${jobTitle}`,
                            html: confirmationHtml,
                        });

                        console.log(`[meeting] Slot booking confirmation email sent to ${candidate.email} for job: ${jobTitle}`);
                    } catch (mailErr) {
                        console.error("[meeting] Failed to send slot booking confirmation email:", mailErr.message);
                    }
                })();
            }

            return res.status(200).json({
                ...meetData,
                interviewId: newInterview._id
            });
        }

        res.status(200).json(meetData);
    } catch (error) {
        console.error('Zoho Creation error details:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message,
            url: error.config?.url,
            payload: error.config?.data
        });
        if (error.response) {
            return res.status(error.response.status).json(error.response.data);
        }
        res.status(500).json({ error: 'Error creating meeting', message: error.message });
    }
});

// POST /cancel - Cancel a Zoho meeting
router.post("/cancel", async (req, res, next) => {
    try {
        const { authToken, sessionId, presenterId } = req.body;

        let accessToken = authToken;

        if (!accessToken) {
            const tokenUrl = `https://accounts.zoho.in/oauth/v2/token?refresh_token=${ENV.ZOHO_MEET_REFRESH_TOKEN}&client_id=${ENV.ZOHO_MEET_CLIENT_ID}&client_secret=${ENV.ZOHO_MEET_CLIENT_SECRET}&grant_type=refresh_token`;
            try {
                const tokenResponse = await axios.post(tokenUrl);
                accessToken = tokenResponse.data.access_token;
            } catch (tokenErr) {
                console.error("Failed to get Zoho access token for cancellation:", tokenErr.message);
                return res.status(500).json({ message: "Failed to get access token" });
            }
        }

        if (!sessionId || !presenterId) {
            return res.status(400).json({ message: "Missing sessionId or presenterId" });
        }

        const interview = await Interview.findOne({ session_id: sessionId });
        const finalZsoid = req.body.zsoid || interview?.zsoid || presenterId;

        const url = `https://meeting.zoho.in/api/v2/${finalZsoid}/sessions/${sessionId}.json`;

        // Helper to run DB cleanup after cancellation
        const runCancelCleanup = async () => {
            if (!interview) return;

            await Interview.findByIdAndUpdate(interview._id, { status: 6 });

            await InterviewerAvailability.findOneAndUpdate(
                { interviewer: interview.interviewer_id, start_time: interview.date_time },
                { status: 1, $unset: { candidate_id: "" } }
            );

            if (interview.candidate_id) {
                await Candidate.findByIdAndUpdate(interview.candidate_id, {
                    final_status: null,
                    is_active: true,
                    status: 5, // cancelled
                    $unset: { interview_id: "" }
                });
            }

            if (interview.job_id) {
                const oldStatusField =
                    interview.status === 2 ? "interview_in_review" :
                        interview.status === 1 ? "rescheduled" :
                            "scheduled";

                await updateJobCandidateCounts(interview.job_id, oldStatusField, "cancelled");
            }
        };

        try {
            const response = await axios.delete(url, {
                headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
            });

            if (response.status === 204 || response.status === 200) {
                await runCancelCleanup();
                return res.json({ success: true, message: "Meeting cancelled and status updated" });
            }

            return res.status(response.status).json(response.data);

        } catch (error) {
            console.error('Zoho Cancellation error details:', {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message,
                url: error.config?.url
            });

            try {
                await runCancelCleanup();
            } catch (cleanupErr) {
                console.error("Failed forced state update:", cleanupErr.message);
            }

            if (error.response?.status === 404) {
                return res.json({ success: true, message: "Meeting already cancelled in Zoho, DB updated" });
            }

            return res.json({
                success: true,
                message: "Meeting cancelled locally, Zoho error reported",
                zohoError: error.response?.data || error.message
            });
        }

    } catch (error) {
        next(error);
    }
});

export default router;