import { Router } from "express";
import axios from "axios";
import { ENV } from "../config/env.js";
import mongoose from "mongoose";
import Interviewer from "../modals/interviewer.model.js";
import { Interview } from "../modals/interview.model.js";
import { Candidate } from "../modals/candidate.model.js";
import InterviewerAvailability from "../modals/interviewerAvailability.model.js";
import { Job } from "../modals/job.model.js";

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

        // 3. Determine Context ID (Presenter ZUID)
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
                date_time: new Date(startTime),
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
                    // Re-fetch to get latest status before this meeting was created
                    const freshCandidate = await Candidate.findById(candidateId);

                    const prevStatusField =
                        freshCandidate?.status === 1 ? "candidate_counts.scheduled" :
                        freshCandidate?.status === 2 ? "candidate_counts.rescheduled" :
                        freshCandidate?.interview_id ? "candidate_counts.scheduled" :
                        "candidate_counts.waiting"; // status 0 = truly waiting

                    await Job.findByIdAndUpdate(candidate.job_id, {
                        $inc: {
                            "candidate_counts.scheduled": 1,
                            [prevStatusField]: -1
                        }
                    });
                } catch (jobErr) {
                    console.error("Failed to update Job candidate counts:", jobErr.message);
                }
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
                // ✅ FIXED: Decrement correct field based on interview status
                const fieldToDecrement =
                    interview.status === 2 ? "candidate_counts.interview_in_review" :
                    interview.status === 1 ? "candidate_counts.rescheduled" :
                    "candidate_counts.scheduled";

                await Job.findByIdAndUpdate(interview.job_id, {
                    $inc: {
                        [fieldToDecrement]: -1,
                        "candidate_counts.cancelled": 1
                    }
                });
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