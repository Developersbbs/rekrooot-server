import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import Interviewer from "../modals/interviewer.model.js";
import { Interview } from "../modals/interview.model.js";

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
      skills,
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

    if (Array.isArray(skills)) {
      payload.skills = skills.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
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
router.get("/", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { company_id } = req.query;
    let query = {};
    if (company_id && company_id !== "all" && mongoose.Types.ObjectId.isValid(company_id)) {
      query.company_id = company_id;
    }

    const interviewers = await Interviewer.find(query).sort({ created_at: -1 });
    return res.json({ interviewers });
  } catch (err) {
    return next(err);
  }
});

// Get single interviewer by id
router.get("/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
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
      skills,
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

    if (skills !== undefined) {
      if (Array.isArray(skills)) {
        update.skills = skills
          .filter((s) => typeof s === "string" && s.trim())
          .map((s) => s.trim());
      } else {
        update.skills = [];
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

router.get("/all-interviews", requireAuth, async (req, res, next) => {
  try {
    const { company_id } = req.query;
    let query = {};
    if (company_id && company_id !== "all" && mongoose.Types.ObjectId.isValid(company_id)) {
      query.company_id = company_id;
    }

    const interviews = await Interview.find(query)
      .populate("interviewer_id", "name email")
      .sort({ date_time: -1 });

    return res.json({ interviews });
  } catch (err) {
    next(err);
  }
});

export default router;
