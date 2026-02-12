import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import InterviewerAvailability from "../modals/interviewerAvailability.model.js";

const router = Router();

async function requireSuperAdmin(req, res, next) {
  try {
    const { uid } = req.auth;

    const user = await User.findOne({ firebase_uid: uid });
    if (!user) {
      return res
        .status(403)
        .json({ message: "User is not provisioned in app database" });
    }

    if (user.role !== 0) {
      return res
        .status(403)
        .json({ message: "Only SUPER_ADMIN can perform this action" });
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

router.get(
  "/:id/availability",
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { from, to } = req.query ?? {};

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid interviewer id" });
      }

      if (!from || !to) {
        return res
          .status(400)
          .json({ message: "Query parameters 'from' and 'to' are required" });
      }

      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
        return res
          .status(400)
          .json({ message: "Invalid 'from' or 'to' datetime format" });
      }

      if (fromDate >= toDate) {
        return res
          .status(400)
          .json({ message: "'from' must be before 'to'" });
      }

      const availability = await InterviewerAvailability.find({
        interviewer: id,
        start_time: { $lt: toDate },
        end_time: { $gt: fromDate },
      }).sort({ start_time: 1 });

      return res.json({ availability });
    } catch (err) {
      return next(err);
    }
  }
);

router.put(
  "/:id/availability",
  requireAuth,
  requireSuperAdmin,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { intervals } = req.body ?? {};

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid interviewer id" });
      }

      if (!Array.isArray(intervals) || intervals.length === 0) {
        return res.status(400).json({ message: "'intervals' array is required" });
      }

      const parsed = intervals.map((interval, index) => {
        const { start_time, end_time } = interval ?? {};

        const start = new Date(start_time);
        const end = new Date(end_time);

        if (
          !start_time ||
          !end_time ||
          Number.isNaN(start.getTime()) ||
          Number.isNaN(end.getTime())
        ) {
          throw Object.assign(new Error(`Invalid interval at index ${index}`), {
            statusCode: 400,
          });
        }

        if (start >= end) {
          throw Object.assign(
            new Error(
              `start_time must be before end_time for interval at index ${index}`
            ),
            { statusCode: 400 }
          );
        }

        return { start, end };
      });

      const minStart = parsed.reduce(
        (min, p) => (p.start < min ? p.start : min),
        parsed[0].start
      );
      const maxEnd = parsed.reduce(
        (max, p) => (p.end > max ? p.end : max),
        parsed[0].end
      );

      await InterviewerAvailability.deleteMany({
        interviewer: id,
        start_time: { $lt: maxEnd },
        end_time: { $gt: minStart },
      });

      const docs = parsed.map(({ start, end }) => ({
        interviewer: id,
        start_time: start,
        end_time: end,
        created_by: req.user?._id,
      }));

      const created = await InterviewerAvailability.insertMany(docs);

      return res.status(200).json({ availability: created });
    } catch (err) {
      if (err && err.statusCode) {
        return res.status(err.statusCode).json({ message: err.message });
      }
      return next(err);
    }
  }
);

export default router;
