import { Router } from "express";
import { requireAuth, attachUser } from "../middlewares/auth.middleware.js";
import { updateInterviewStatuses } from "../services/interviewScheduler.js";
import { Interview } from "../modals/interview.model.js";
import mongoose from "mongoose";

const router = Router();

// GET single interview by id
router.get("/:id", requireAuth, attachUser, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid interview ID" });
    }

    const interview = await Interview.findById(id)
      .populate("interviewer_id", "name email")
      .populate("candidate_id", "full_name email")
      .populate("job_id", "title");

    if (!interview) {
      return res.status(404).json({ message: "Interview not found" });
    }

    // Check if user has access to this interview (same company)
    if (req.user.role !== 0 && interview.company_id?.toString() !== req.user.company_id?.toString()) {
      return res.status(403).json({ message: "Access denied" });
    }

    return res.json({ interview });
  } catch (err) {
    return next(err);
  }
});

// Manual trigger endpoint for interview status updates (for testing)
router.post("/update-statuses", requireAuth, attachUser, async (req, res, next) => {
    try {
        await updateInterviewStatuses();
        res.json({ message: "Interview status update completed successfully" });
    } catch (error) {
        console.error('Error in manual interview status update:', error);
        res.status(500).json({ message: "Failed to update interview statuses" });
    }
});

export default router;
