import { Job } from "../modals/job.model.js";

/**
 * Updates candidate counts for a job.
 * @param {string|ObjectId} jobId - The job ID to update.
 * @param {string} oldStatus - The status field to decrement (e.g., 'waiting', 'scheduled').
 * @param {string} newStatus - The status field to increment.
 */
export const updateJobCandidateCounts = async (jobId, oldStatus = null, newStatus = null) => {
    if (!jobId || oldStatus === newStatus) return;

    const updateQuery = { $inc: {} };

    // Decrement old status count
    if (oldStatus) {
        const key = `candidate_counts.${oldStatus}`;
        updateQuery.$inc[key] = (updateQuery.$inc[key] || 0) - 1;
    }

    // Increment new status count
    if (newStatus) {
        const key = `candidate_counts.${newStatus}`;
        updateQuery.$inc[key] = (updateQuery.$inc[key] || 0) + 1;
    }

    // Filter out net zero changes
    for (const key in updateQuery.$inc) {
        if (updateQuery.$inc[key] === 0) {
            delete updateQuery.$inc[key];
        }
    }

    if (Object.keys(updateQuery.$inc).length > 0) {
        try {
            await Job.findByIdAndUpdate(jobId, updateQuery);
        } catch (error) {
            console.error(`Failed to update candidate counts for job ${jobId}:`, error.message);
        }
    }
};
