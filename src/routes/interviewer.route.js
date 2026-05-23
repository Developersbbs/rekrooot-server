import { Router } from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import Interviewer from "../modals/interviewer.model.js";
import { Interview } from "../modals/interview.model.js";
import InterviewerAvailability from "../modals/interviewerAvailability.model.js";
import { sendInterviewerWelcomeEmail } from "../services/mailer.js";
import { ENV } from "../config/env.js";

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

    payload.signup_token = crypto.randomBytes(32).toString("hex");

    const interviewer = await Interviewer.create(payload);

    // Send welcome email with signup link (token locks email on signup page)
    const signupUrl = `${ENV.FRONTEND_BASE_URL.replace(/\/$/, "")}/interviewer/signup?token=${payload.signup_token}`;
    let mail_sent = false;
    let mail_error = null;
    try {
      await sendInterviewerWelcomeEmail({ to: payload.email, name: payload.name, signupUrl });
      mail_sent = true;
    } catch (mailErr) {
      mail_error = mailErr instanceof Error ? mailErr.message : "Failed to send email";
      console.error("[interviewer] Failed to send welcome email", { to: payload.email, error: mail_error });
    }

    return res.status(201).json({ interviewer, mail_sent, mail_error });
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

    const now = new Date();
    const rangeEnd = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    const slotDuration = 30 * 60 * 1000; // 30 minutes in ms

    // Fetch available ranges and already-booked interviews in one go
    const [availabilities, bookedInterviews] = await Promise.all([
      InterviewerAvailability.find({
        start_time: { $lt: rangeEnd },
        end_time: { $gt: now },
        status: 1,
      }).lean(),
      Interview.find({
        status: { $in: [0, 1] },
        date_time: { $gte: now, $lt: rangeEnd },
      }).select("interviewer_id date_time").lean(),
    ]);

    // Build a per-interviewer set of booked start-times (ms) for O(1) lookup
    const bookedByInterviewer = {};
    bookedInterviews.forEach(iv => {
      const id = iv.interviewer_id.toString();
      if (!bookedByInterviewer[id]) bookedByInterviewer[id] = new Set();
      bookedByInterviewer[id].add(new Date(iv.date_time).getTime());
    });

    // Merge ranges per interviewer, then expand into 30-min ISO-keyed slots.
    // Using ISO keys lets the browser render times in the user's local timezone
    // regardless of what timezone the server runs in.
    const mergedByInterviewer = {};
    availabilities.forEach(range => {
      const intId = range.interviewer.toString();
      if (!mergedByInterviewer[intId]) mergedByInterviewer[intId] = [];
      mergedByInterviewer[intId].push({
        start: new Date(range.start_time).getTime(),
        end: new Date(range.end_time).getTime(),
      });
    });

    const slotsMap = {};
    const nowMs = now.getTime();

    Object.entries(mergedByInterviewer).forEach(([intId, ranges]) => {
      slotsMap[intId] = {};
      const booked = bookedByInterviewer[intId] || new Set();

      // Merge overlapping/adjacent ranges
      const merged = [];
      for (const r of ranges.sort((a, b) => a.start - b.start)) {
        const last = merged[merged.length - 1];
        if (last && r.start <= last.end) {
          last.end = Math.max(last.end, r.end);
        } else {
          merged.push({ ...r });
        }
      }

      merged.forEach(({ start, end }) => {
        for (let ms = start; ms + slotDuration <= end; ms += slotDuration) {
          if (ms + slotDuration <= nowMs) continue; // skip past slots, keep boundary-aligned
          const overlaps = [...booked].some(iStart => ms < iStart + slotDuration && ms + slotDuration > iStart);
          if (overlaps) continue;
          // ISO key — the client converts to its local timezone for display
          slotsMap[intId][new Date(ms).toISOString()] = 'available';
        }
      });
    });

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

// GET /by-token/:token - Resolve signup token to email (public, no auth)
router.get("/by-token/:token", async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "Invalid token" });
    }
    const interviewer = await Interviewer.findOne({ signup_token: token }).select("email").lean();
    if (!interviewer) {
      return res.status(404).json({ message: "Invalid or expired signup link" });
    }
    return res.json({ email: interviewer.email });
  } catch (err) {
    return next(err);
  }
});

// POST /signup - Interviewer signup (provision User record if email exists in Interviewer collection)
router.post("/signup", requireAuth, async (req, res, next) => {
  try {
    const { name, contact } = req.body;
    const { uid, email } = req.auth;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const emailNormalized = email.toLowerCase().trim();

    // 1. Check if interviewer exists
    const interviewer = await Interviewer.findOne({ email: emailNormalized });
    if (!interviewer) {
      return res.status(403).json({ message: "Your email is not authorized as an interviewer. Please contact your administrator." });
    }

    // 2. Check if user already provisioned
    let user = await User.findOne({ 
      $or: [
        { email: emailNormalized },
        { firebase_uid: uid }
      ]
    });

    if (user) {
      if (!user.firebase_uid) {
        user.firebase_uid = uid;
        await user.save();
      }
      return res.status(200).json({ user });
    }

    // 3. Provision new user with role 4 (Interviewer)
    user = await User.create({
      username: name || interviewer.name,
      email: emailNormalized,
      contact: contact || interviewer.contact,
      firebase_uid: uid,
      company_id: interviewer.company_id,
      role: 4, // Interviewer
      is_active: true
    });

    return res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

// GET /me/scheduled - Fetch scheduled and rescheduled interviews for the logged-in interviewer
router.get("/me/scheduled", requireAuth, async (req, res, next) => {
  try {
    const { uid } = req.auth;
    const user = await User.findOne({ firebase_uid: uid });
    if (!user || user.role !== 4) {
      return res.status(403).json({ message: "Access denied" });
    }

    const interviewer = await Interviewer.findOne({ email: user.email });
    if (!interviewer) {
      return res.status(404).json({ message: "Interviewer profile not found" });
    }

    const interviews = await Interview.find({
      interviewer_id: interviewer._id,
      status: { $in: [0, 1] } // 0: scheduled, 1: rescheduled
    })
    .populate("candidate_id", "full_name email primary_contact")
    .populate("job_id", "title")
    .sort({ date_time: 1 });

    return res.json({ interviews });
  } catch (err) {
    next(err);
  }
});

// GET /me/stats - Summary counts for the logged-in interviewer
router.get("/me/stats", requireAuth, async (req, res, next) => {
  try {
    const { uid } = req.auth;
    const user = await User.findOne({ firebase_uid: uid });
    if (!user || user.role !== 4) {
      return res.status(403).json({ message: "Access denied" });
    }

    const interviewer = await Interviewer.findOne({ email: user.email });
    if (!interviewer) {
      return res.status(404).json({ message: "Interviewer profile not found" });
    }

    const all = await Interview.find({ interviewer_id: interviewer._id });
    const now = new Date();

    const stats = {
      total: all.length,
      upcoming: all.filter(i => (i.status === 0 || i.status === 1) && new Date(i.date_time) >= now).length,
      in_review: all.filter(i => i.status === 2).length,
      selected: all.filter(i => i.status === 3).length,
      rejected: all.filter(i => i.status === 4).length,
      no_show: all.filter(i => i.status === 5).length,
      cancelled: all.filter(i => i.status === 6).length,
    };

    return res.json({ stats });
  } catch (err) {
    next(err);
  }
});

// GET /me/availability - Fetch upcoming availability for the logged-in interviewer
router.get("/me/availability", requireAuth, async (req, res, next) => {
  try {
    const { uid } = req.auth;
    const user = await User.findOne({ firebase_uid: uid });
    if (!user || user.role !== 4) {
      return res.status(403).json({ message: "Access denied" });
    }

    const interviewer = await Interviewer.findOne({ email: user.email });
    if (!interviewer) {
      return res.status(404).json({ message: "Interviewer profile not found" });
    }

    const now = new Date();
    const { from, to } = req.query;
    const fromDate = from ? new Date(from) : now;
    const toDate = to ? new Date(to) : new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days ahead

    const availability = await InterviewerAvailability.find({
      interviewer: interviewer._id,
      start_time: { $lt: toDate },
      end_time: { $gt: fromDate },
      status: 1,
    }).sort({ start_time: 1 });

    return res.json({ availability });
  } catch (err) {
    next(err);
  }
});

// PUT /me/availability - Bulk replace availability for the logged-in interviewer (same as admin PUT but self-service)
router.put("/me/availability", requireAuth, async (req, res, next) => {
  try {
    const { uid } = req.auth;
    const user = await User.findOne({ firebase_uid: uid });
    if (!user || user.role !== 4) {
      return res.status(403).json({ message: "Access denied" });
    }

    const interviewer = await Interviewer.findOne({ email: user.email });
    if (!interviewer) {
      return res.status(404).json({ message: "Interviewer profile not found" });
    }

    const { intervals } = req.body ?? {};

    if (!Array.isArray(intervals) || intervals.length === 0) {
      // No available slots — delete all available slots for the day range provided via query
      const { from, to } = req.query ?? {};
      if (from && to) {
        await InterviewerAvailability.deleteMany({
          interviewer: interviewer._id,
          start_time: { $lt: new Date(to) },
          end_time: { $gt: new Date(from) },
          status: 1,
        });
      }
      return res.status(200).json({ availability: [] });
    }

    const parsed = intervals.map((interval, index) => {
      const { start_time, end_time } = interval ?? {};
      const start = new Date(start_time);
      const end = new Date(end_time);
      if (!start_time || !end_time || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw Object.assign(new Error(`Invalid interval at index ${index}`), { statusCode: 400 });
      }
      if (start >= end) {
        throw Object.assign(new Error(`start_time must be before end_time at index ${index}`), { statusCode: 400 });
      }
      return { start, end };
    });

    const minStart = parsed.reduce((min, p) => (p.start < min ? p.start : min), parsed[0].start);
    const maxEnd = parsed.reduce((max, p) => (p.end > max ? p.end : max), parsed[0].end);

    await InterviewerAvailability.deleteMany({
      interviewer: interviewer._id,
      start_time: { $lt: maxEnd },
      end_time: { $gt: minStart },
      status: 1,
    });

    const docs = parsed.map(({ start, end }) => ({
      interviewer: interviewer._id,
      start_time: start,
      end_time: end,
    }));

    const created = await InterviewerAvailability.insertMany(docs);
    return res.status(200).json({ availability: created });
  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    return next(err);
  }
});

// POST /me/availability - Add a new availability slot for the logged-in interviewer
router.post("/me/availability", requireAuth, async (req, res, next) => {
  try {
    const { uid } = req.auth;
    const user = await User.findOne({ firebase_uid: uid });
    if (!user || user.role !== 4) {
      return res.status(403).json({ message: "Access denied" });
    }

    const interviewer = await Interviewer.findOne({ email: user.email });
    if (!interviewer) {
      return res.status(404).json({ message: "Interviewer profile not found" });
    }

    const { start_time, end_time } = req.body ?? {};
    if (!start_time || !end_time) {
      return res.status(400).json({ message: "start_time and end_time are required" });
    }

    const start = new Date(start_time);
    const end = new Date(end_time);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ message: "Invalid start_time or end_time" });
    }

    if (start >= end) {
      return res.status(400).json({ message: "start_time must be before end_time" });
    }

    if (start < new Date()) {
      return res.status(400).json({ message: "Cannot add availability in the past" });
    }

    const slot = await InterviewerAvailability.create({
      interviewer: interviewer._id,
      start_time: start,
      end_time: end,
      status: 1,
    });

    return res.status(201).json({ slot });
  } catch (err) {
    next(err);
  }
});

// DELETE /me/availability/:slotId - Remove an availability slot for the logged-in interviewer
router.delete("/me/availability/:slotId", requireAuth, async (req, res, next) => {
  try {
    const { uid } = req.auth;
    const user = await User.findOne({ firebase_uid: uid });
    if (!user || user.role !== 4) {
      return res.status(403).json({ message: "Access denied" });
    }

    const interviewer = await Interviewer.findOne({ email: user.email });
    if (!interviewer) {
      return res.status(404).json({ message: "Interviewer profile not found" });
    }

    const { slotId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(slotId)) {
      return res.status(400).json({ message: "Invalid slot id" });
    }

    const slot = await InterviewerAvailability.findOne({
      _id: slotId,
      interviewer: interviewer._id,
      status: 1,
    });

    if (!slot) {
      return res.status(404).json({ message: "Slot not found or already booked" });
    }

    await slot.deleteOne();

    return res.json({ message: "Slot removed" });
  } catch (err) {
    next(err);
  }
});

// GET /me/all - All interviews for the logged-in interviewer (for reports)
router.get("/me/all", requireAuth, async (req, res, next) => {
  try {
    const { uid } = req.auth;
    const user = await User.findOne({ firebase_uid: uid });
    if (!user || user.role !== 4) {
      return res.status(403).json({ message: "Access denied" });
    }

    const interviewer = await Interviewer.findOne({ email: user.email });
    if (!interviewer) {
      return res.status(404).json({ message: "Interviewer profile not found" });
    }

    const interviews = await Interview.find({ interviewer_id: interviewer._id })
      .populate("candidate_id", "full_name email primary_contact")
      .populate("job_id", "title")
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
    const interviews = await Interview.find({ interviewer_id: id })
      .populate('candidate_id', 'full_name email primary_contact')
      .sort({ date_time: 1 });
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

    const slotDuration = parseInt(duration) * 60 * 1000;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid interviewer id" });
    }

    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
    const toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + parseInt(days), 0, 0, 0);
    const to = toDate.toISOString();

    // Fetch available ranges and already-booked interviews in parallel
    const [availability, bookedInterviews] = await Promise.all([
      InterviewerAvailability.find({
        interviewer: id,
        start_time: { $lt: to },
        end_time: { $gt: from },
        status: 1,
      }).sort({ start_time: 1 }),

      // Interviews with status 0 (scheduled) or 1 (rescheduled) block their time slot
      Interview.find({
        interviewer_id: id,
        status: { $in: [0, 1] },
        date_time: { $gte: new Date(from), $lt: new Date(to) },
      }).select("date_time"),
    ]);

    const timeSlots = [];
    const nowMs = Date.now();
    const baseInterval = parseInt(duration) * 60 * 1000;
    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);
    const dayMs = 24 * 60 * 60 * 1000;

    // Merge adjacent/overlapping availability intervals so that slots spanning
    // multiple stored records (e.g., consecutive 30-min DB entries) still match
    // when a longer duration is requested.
    const mergedRanges = [];
    for (const range of availability) {
      const rs = new Date(range.start_time).getTime();
      const re = new Date(range.end_time).getTime();
      const last = mergedRanges[mergedRanges.length - 1];
      if (last && rs <= last.end) {
        last.end = Math.max(last.end, re);
      } else {
        mergedRanges.push({ start: rs, end: re });
      }
    }

    // Build a list of booked intervals for overlap checks
    const bookedIntervals = bookedInterviews.map((i) => {
      const iStart = new Date(i.date_time).getTime();
      return { start: iStart, end: iStart + slotDuration };
    });

    for (let dayMsStart = rangeStart.getTime(); dayMsStart < rangeEnd.getTime(); dayMsStart += dayMs) {
      for (let ms = dayMsStart; ms < dayMsStart + dayMs; ms += baseInterval) {
        if (ms <= nowMs) continue;

        // Must fit entirely inside a merged available range
        const fits = mergedRanges.some(({ start, end }) => ms >= start && ms + slotDuration <= end);
        if (!fits) continue;

        // Must not overlap with any booked interview
        const isBooked = bookedIntervals.some(({ start, end }) => ms < end && ms + slotDuration > start);
        if (isBooked) continue;

        // Emit the slot with an ISO timestamp so the client can render
        // times in the user's local timezone regardless of server timezone.
        timeSlots.push({
          iso: new Date(ms).toISOString(),
          isoEnd: new Date(ms + slotDuration).toISOString(),
          duration: `${duration} mins`,
        });
      }
    }

    const uniqueSlots = timeSlots.filter((slot, index, self) =>
      index === self.findIndex((t) => t.iso === slot.iso)
    );

    return res.json({ success: true, timeSlots: uniqueSlots });
  } catch (err) {
    next(err);
  }
});

export default router;

