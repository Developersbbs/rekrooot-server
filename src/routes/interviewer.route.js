import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import Interviewer from "../modals/interviewer.model.js";
import { Interview } from "../modals/interview.model.js";
import InterviewerAvailability from "../modals/interviewerAvailability.model.js";

const router = Router();

async function requireSuperAdmin(req, res, next) {
  try {
    const { uid } = req.auth;

    const user = await User.findOne({ firebase_uid: uid });
    if (!user) {
      return res.status(403).json({ message: "User is not provisioned in app database" });
    }

    if (user.role !== 0) {
      return res.status(403).json({ message: "Only SUPER_ADMIN can perform this action" });
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Create interviewer
router.post("/", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const {
      name,
      email,
      contact,
      logo,
      zoho_meet_uid,
      technologies,
    } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Interviewer name is required" });
    }

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ message: "Interviewer email is required" });
    }

    const payload = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      created_by: req.user?._id,
    };

    if (contact && typeof contact === "string") {
      payload.contact = contact.trim();
    }

    if (logo && typeof logo === "string") {
      payload.logo = logo.trim();
    }

    if (zoho_meet_uid && typeof zoho_meet_uid === "string") {
      payload.zoho_meet_uid = zoho_meet_uid.trim();
    }

    if (Array.isArray(technologies)) {
      const validTechIds = technologies.filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (validTechIds.length) {
        payload.technologies = validTechIds;
      }
    }

    const interviewer = await Interviewer.create(payload);
    return res.status(201).json({ interviewer });
  } catch (err) {
    if (err?.code === 11000) {
      const key = err?.keyPattern ? Object.keys(err.keyPattern)[0] : undefined;
      if (key === "email") {
        return res.status(409).json({ message: "Interviewer email already exists" });
      }
      return res.status(409).json({ message: "Duplicate key error" });
    }
    return next(err);
  }
});

// List interviewers (SuperAdmin managed global resource)
router.get("/", requireAuth, async (req, res, next) => {
  try {
    let query = {};

    const interviewers = await Interviewer.find(query).populate("technologies", "name").sort({ created_at: -1 });
    return res.json({ interviewers });
  } catch (err) {
    return next(err);
  }
});

// List all interviewers (public basic info with availability)
router.get("/public/list", async (req, res, next) => {
  try {
    const interviewers = await Interviewer.find().select("name email zoho_meet_uid technologies").populate("technologies", "name").lean();

    // Fetch availabilities
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const availabilities = await InterviewerAvailability.find({
      start_time: { $gte: now },
      status: 1 // Only available slots
    }).lean();

    // Map availabilities
    const slotsMap = {};
    availabilities.forEach(slot => {
      const intId = slot.interviewer.toString();
      if (!slotsMap[intId]) slotsMap[intId] = {};

      const date = new Date(slot.start_time);
      const dateStr = date.toDateString();

      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;

      if (!slotsMap[intId][dateStr]) {
        slotsMap[intId][dateStr] = {};
      }

      // If status is 2 (booked), store the candidate_id string, else store 'available'
      // Since we filtered for status 1, it should always be available.
      slotsMap[intId][dateStr][timeStr] = 'available';
    });

    // Add slots to interviewers
    interviewers.forEach(int => {
      int.availability_slots = slotsMap[int._id.toString()] || {};
    });

    return res.json({ interviewers });
  } catch (err) {
    return next(err);
  }
});

// Get single interviewer (public basic info)
router.get("/:id/public", async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid interviewer id" });
    }

    const interviewer = await Interviewer.findById(id).select("name email zoho_meet_uid technologies");

    if (!interviewer) {
      return res.status(404).json({ message: "Interviewer not found" });
    }

    return res.json({ interviewer });
  } catch (err) {
    return next(err);
  }
});

// List all interviews
router.get("/all-interviews", requireAuth, async (req, res, next) => {
  try {
    const { company_id, created_by } = req.query;
    let query = {};
    if (company_id && company_id !== "all" && mongoose.Types.ObjectId.isValid(company_id)) {
      query.company_id = company_id;
    }
    if (created_by && mongoose.Types.ObjectId.isValid(created_by)) {
      query.created_by = created_by;
    }

    const interviews = await Interview.find(query)
      .populate("interviewer_id", "name email")
      .sort({ date_time: -1 });

    return res.json({ interviews });
  } catch (err) {
    next(err);
  }
});

// Get single interviewer by id
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid interviewer id" });
    }

    const interviewer = await Interviewer.findById(id)
      .populate("technologies", "name")
      .exec();

    if (!interviewer) {
      return res.status(404).json({ message: "Interviewer not found" });
    }

    return res.json({ interviewer });
  } catch (err) {
    return next(err);
  }
});

// Update interviewer
router.put("/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid interviewer id" });
    }

    const {
      name,
      email,
      contact,
      logo,
      zoho_meet_uid,
      technologies,
    } = req.body || {};

    const update = {};

    if (name !== undefined) {
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "Interviewer name is required" });
      }
      update.name = name.trim();
    }

    if (email !== undefined) {
      if (!email || typeof email !== "string" || !email.trim()) {
        return res.status(400).json({ message: "Interviewer email is required" });
      }
      update.email = email.trim().toLowerCase();
    }

    if (contact !== undefined) {
      if (contact && typeof contact === "string") {
        update.contact = contact.trim();
      } else {
        update.contact = undefined;
      }
    }

    if (logo !== undefined) {
      if (logo && typeof logo === "string") {
        update.logo = logo.trim();
      } else {
        update.logo = undefined;
      }
    }

    if (zoho_meet_uid !== undefined) {
      if (zoho_meet_uid && typeof zoho_meet_uid === "string") {
        update.zoho_meet_uid = zoho_meet_uid.trim();
      } else {
        update.zoho_meet_uid = undefined;
      }
    }

    if (technologies !== undefined) {
      if (Array.isArray(technologies)) {
        const validTechIds = technologies.filter((tid) => mongoose.Types.ObjectId.isValid(tid));
        update.technologies = validTechIds;
      } else {
        update.technologies = [];
      }
    }

    if (req.body.availability_slots !== undefined) {
      update.availability_slots = req.body.availability_slots;
    }

    if (req.body.assigned_candidates !== undefined) {
      update.assigned_candidates = req.body.assigned_candidates;
    }

    const interviewer = await Interviewer.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    });

    if (!interviewer) {
      return res.status(404).json({ message: "Interviewer not found" });
    }

    return res.json({ interviewer });
  } catch (err) {
    if (err?.code === 11000) {
      const key = err?.keyPattern ? Object.keys(err.keyPattern)[0] : undefined;
      if (key === "email") {
        return res.status(409).json({ message: "Interviewer email already exists" });
      }
      return res.status(409).json({ message: "Duplicate key error" });
    }
    return next(err);
  }
});

// Delete interviewer
router.delete("/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid interviewer id" });
    }

    const result = await Interviewer.findByIdAndDelete(id);
    if (!result) {
      return res.status(404).json({ message: "Interviewer not found" });
    }

    return res.status(200).json({ message: "Interviewer deleted" });
  } catch (err) {
    return next(err);
  }
});

// List interviews for an interviewer
router.get("/:id/interviews", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid interviewer id" });
    }
    const interviews = await Interview.find({ interviewer_id: id }).sort({ date_time: 1 });
    return res.json({ interviews });
  } catch (err) {
    next(err);
  }
});



// Helper function to calculate GCD
function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

// GET /:id/timeslots - Fetch and process availability intervals into slots
router.get("/:id/timeslots", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { days = 31, duration = 30 } = req.query;

    // Convert duration to milliseconds (minutes -> ms)
    const slotDuration = parseInt(duration) * 60 * 1000;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid interviewer id" });
    }

    // Use local time calculation for proper slot alignment
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
    const toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + parseInt(days), 0, 0, 0);
    const to = toDate.toISOString();

    const availability = await InterviewerAvailability.find({
      interviewer: id,
      start_time: { $lt: to },
      end_time: { $gt: from },
      status: 1 // Only available slots
    }).sort({ start_time: 1 });

    console.log(`[timeslots] Request: interviewer=${id}, duration=${duration}ms (${parseInt(duration)}min), days=${days}`);
    console.log(`[timeslots] Date range: ${from} to ${to}`);
    console.log(`[timeslots] Found ${availability.length} availability ranges`);

    const timeSlots = [];
    const nowLocal = new Date();

    // Use the actual duration as the base interval for slot generation
    const durationMinutes = parseInt(duration);
    const baseIntervalMinutes = durationMinutes;
    const baseInterval = baseIntervalMinutes * 60 * 1000;

    console.log(`[timeslots] Calculated baseInterval: ${baseIntervalMinutes} minutes (${baseInterval}ms)`);

    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);
    const dayMs = 24 * 60 * 60 * 1000;

    // Generate slots starting from the beginning of each day at the base interval
    for (let dayMsStart = rangeStart.getTime(); dayMsStart < rangeEnd.getTime(); dayMsStart += dayMs) {
      for (let ms = dayMsStart; ms < dayMsStart + dayMs; ms += baseInterval) {
        const slotStart = new Date(ms);
        const slotEnd = new Date(ms + slotDuration);

          // Skip slots that have already passed
          if (slotStart <= nowLocal) continue;

          // Check if this candidate slot fits entirely inside any availability range
          const fits = availability.some(range => {
            const rangeStart = new Date(range.start_time);
            const rangeEnd = new Date(range.end_time);
            return slotStart >= rangeStart && slotEnd <= rangeEnd;
          });

          if (!fits) continue;

        const slotDate = slotStart.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
        const slotTime12 = slotStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

        const hh = slotStart.getHours().toString().padStart(2, '0');
        const mm = slotStart.getMinutes().toString().padStart(2, '0');
        const slotTime24 = `${hh}:${mm}`;

        const endTime = slotEnd;
        const endTime12 = endTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

        timeSlots.push({
          date: slotDate,
          time: slotTime12,
          time24: slotTime24,
          endTime: endTime12,
          duration: `${duration} mins`,
          iso: slotStart.toISOString()
        });
      }
    }

    console.log(`[timeslots] Generated ${timeSlots.length} slots`);

    // Already sorted by the loop; just filter unique
    const uniqueSlots = timeSlots.filter((slot, index, self) =>
      index === self.findIndex((t) => (
        t.date === slot.date && t.time24 === slot.time24
      ))
    );

    return res.json({ success: true, timeSlots: uniqueSlots });
  } catch (err) {
    next(err);
  }
});

export default router;
