import mongoose from "mongoose";
import { Interview } from "../modals/interview.model.js";
import { Candidate } from "../modals/candidate.model.js";
import { updateJobCandidateCounts } from "./jobService.js";

const updateInterviewStatuses = async () => {
  try {
    console.log("Running interview status update scheduler...");

    const now = new Date();

    // Step 1: Get interviews whose start time has passed, then filter by end time
    // (date_time + duration_ms <= now means the meeting is actually over)
    const candidates_for_review = await Interview.find({
      date_time: { $lte: now },
      status: { $in: [0, 1] } // scheduled or rescheduled
    }).select("_id candidate_id job_id status date_time duration_ms");

    const endedInterviews = candidates_for_review.filter(i => {
      const endTime = new Date(i.date_time).getTime() + (i.duration_ms || 3600000);
      return endTime <= now.getTime();
    });

    if (endedInterviews.length === 0) {
      console.log("No interviews found to update");
      return;
    }

    console.log(`Found ${endedInterviews.length} interviews to update`);

    const interviewIds = endedInterviews.map(i => i._id);
    const candidateIds = endedInterviews
      .filter(i => i.candidate_id)
      .map(i => i.candidate_id);

    // Step 2: Bulk update interview status → 2 (interview_in_review)
    await Interview.updateMany(
      { _id: { $in: interviewIds } },
      { $set: { status: 2 } }
    );

    console.log("Updated interviews to status 2 (interview_in_review)");

    // Step 3: Bulk update candidate status → 3 (review)
    if (candidateIds.length > 0) {
      await Candidate.updateMany(
        { _id: { $in: candidateIds } },
        { $set: { status: 3 } }
      );
      console.log("Updated candidates to status 3 (review)");
    }

    // Step 4: Update job candidate counts properly
    for (const interview of endedInterviews) {
      if (interview.job_id && interview.candidate_id) {
        const oldStatusField =
          interview.status === 1 ? "rescheduled" : "scheduled";

        await updateJobCandidateCounts(
          interview.job_id,
          oldStatusField,
          "interview_in_review"
        );

        console.log(
          `Updated job ${interview.job_id} candidate counts`
        );
      }
    }

    console.log(
      `Successfully processed ${endedInterviews.length} interviews`
    );

  } catch (error) {
    console.error("Error updating interview statuses:", error);
  }
};

export { updateInterviewStatuses };