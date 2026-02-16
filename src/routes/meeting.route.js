import { Router } from "express";
import axios from "axios";
import { ENV } from "../config/env.js";
import mongoose from "mongoose";
import Interviewer from "../modals/interviewer.model.js";
import { Interview } from "../modals/interview.model.js";
import { Candidate } from "../modals/candidate.model.js";
import InterviewerAvailability from "../modals/interviewerAvailability.model.js";

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

        // 2. Fetch Candidate and Interviewer for DB operations later
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

        // Fallback to default
        if (!contextId) {
            contextId = ENV.ZOHO_DEFAULT_PRESENTER_ID || '60058686791';
        }

        const url = `https://meeting.zoho.in/api/v2/${contextId}/sessions.json`;

        // Check for missing fields
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

        // 4. Save to DB Collections
        if (meetData && meetData.session) {
            const session = meetData.session;
            const meetingLink = session.joinLink || session.join_url || session.meetingLink || session.url;
            const sessionId = session.meetingKey || session.meeting_key || session.id;
            const zsoid = session.zsoid || (session.meeting && session.meeting.zsoid);

            // Create Interview Record
            const interviewData = {
                interviewer_id: interviewerId,
                candidate_id: candidateId,
                candidate_name: candidate?.full_name || "N/A",
                candidate_email: candidate?.email || "N/A",
                date_time: new Date(startTime),
                meeting_link: meetingLink,
                session_id: sessionId,
                presenter_id: contextId,
                zsoid: zsoid,
                company_id: candidate?.company_id,
                created_by: candidate?.created_by,
                status: 1
            };

            const newInterview = await Interview.create(interviewData);

            // Update Candidate Record
            if (candidate) {
                await Candidate.findByIdAndUpdate(candidateId, {
                    interviewer_id: interviewerId,
                    interview_date: startTime.split(' ')[0], // Simple date extraction
                    interview_time: startTime.split(' ').slice(1).join(' '),
                    meeting_link: meetingLink,
                    session_id: sessionId,
                    presenterId: contextId,
                    zsoid: zsoid
                });
            }

            // Update InterviewerAvailability Record
            if (interviewer && startTime) {
                const startDate = new Date(startTime);

                try {
                    const availability = await InterviewerAvailability.findOneAndUpdate(
                        {
                            interviewer: interviewerId,
                            start_time: startDate
                        },
                        {
                            status: 2,
                            candidate_id: candidateId
                        },
                        { new: true }
                    );

                    if (!availability) {
                        console.warn("No InterviewerAvailability slot found to book for:", { interviewerId, startTime });
                    }
                } catch (availErr) {
                    console.error("Failed to update InterviewerAvailability status:", availErr.message);
                }
            }

            return res.status(200).json({
                ...meetData,
                interviewId: newInterview._id
            });
        }

        res.status(200).json(meetData);
    } catch (error) {
        console.error('Error in meeting creation flow:', error.message);
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

        const url = `https://meeting.zoho.in/api/v2/${presenterId}/sessions/${sessionId}.json`;

        const response = await axios.delete(url, {
            headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`
            }
        });

        if (response.status === 204 || response.status === 200) {
            return res.json({ success: true, message: "Meeting cancelled" });
        }

        return res.status(response.status).json(response.data);
    } catch (error) {
        console.error('Error in meeting cancellation:', error.message);
        if (error.response) {
            return res.status(error.response.status).json(error.response.data);
        }
        res.status(500).json({ error: 'Error cancelling meeting', message: error.message });
    }
});

export default router;
