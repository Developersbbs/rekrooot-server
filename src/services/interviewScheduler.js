import { Interview } from "../modals/interview.model.js";
import { Job } from "../modals/job.model.js";
import { Candidate } from "../modals/candidate.model.js";
import { updateJobCandidateCounts } from "./jobService.js";

// Function to update interviews that have ended and move them to review status
const updateInterviewStatuses = async () => {
    try {
        const now = new Date();
        const istTime = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
        console.log('Running interview status update scheduler...');
        console.log('Current time (IST):', istTime);

        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); // Current time minus 1 hour
        const bufferTime = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes ago

        const thresholdIST = oneHourAgo.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
        console.log('Time threshold (1 hour ago IST):', thresholdIST);

        // Find all interviews that have ended (start time + 1 hour <= now) and are still scheduled or rescheduled
        // AND were created at least 10 minutes ago (to prevent race conditions with newly created past-dated interviews)
        const endedInterviews = await Interview.find({
            date_time: { $lte: oneHourAgo },
            created_at: { $lte: bufferTime },
            status: { $in: [0, 1] } // scheduled or rescheduled status
        }).populate('candidate_id', '_id job_id')
            .populate('job_id', '_id');

        console.log(`Found ${endedInterviews.length} interviews to update to review status`);

        // Update each interview to status 2 (interview_in_review)
        for (const interview of endedInterviews) {
            // Update interview status
            await Interview.findByIdAndUpdate(interview._id, { status: 2 });
            console.log(`Updated interview ${interview._id} to status 2 (interview_in_review)`);

            // Update candidate status to 3 (review)
            if (interview.candidate_id) {
                await Candidate.findByIdAndUpdate(interview.candidate_id._id, { status: 3 });
                console.log(`Updated candidate ${interview.candidate_id._id} to status 3 (review)`);
            }

            // Update job candidate counts: decrement old status, increment interview_in_review
            if (interview.job_id && interview.candidate_id) {
                const oldStatusField = interview.status === 1 ? 'rescheduled' : 'scheduled';
                await updateJobCandidateCounts(interview.job_id._id, oldStatusField, 'interview_in_review');
                console.log(`Updated job ${interview.job_id._id} candidate counts via jobService`);
            }
        }

        if (endedInterviews.length > 0) {
            console.log(`Successfully updated ${endedInterviews.length} interviews to review status`);
        } else {
            console.log('No interviews found to update');
        }
    } catch (error) {
        console.error('Error updating interview statuses:', error);
    }
};

export { updateInterviewStatuses };
