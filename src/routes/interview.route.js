import { Router } from "express";
import { requireAuth, attachUser } from "../middlewares/auth.middleware.js";
import { updateInterviewStatuses } from "../services/interviewScheduler.js";

const router = Router();

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
