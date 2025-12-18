import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import { Company } from "../modals/company.model.js";

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

router.post("/", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name, recruiter_admin_id, subscription_status } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Company name is required" });
    }

    const payload = {
      name: name.trim(),
      created_by: req.auth.uid,
    };

    if (typeof subscription_status === "boolean") {
      payload.subscription_status = subscription_status;
    }

    if (recruiter_admin_id !== undefined && recruiter_admin_id !== null) {
      if (!mongoose.Types.ObjectId.isValid(recruiter_admin_id)) {
        return res.status(400).json({ message: "Invalid recruiter_admin_id" });
      }
      payload.recruiter_admin_id = recruiter_admin_id;
    }

    const company = await Company.create(payload);
    return res.status(201).json({ company });
  } catch (err) {
    if (err?.code === 11000) {
      const key = err?.keyPattern ? Object.keys(err.keyPattern)[0] : undefined;
      if (key === "name") {
        return res.status(409).json({ message: "Company name already exists" });
      }
      if (key === "recruiter_admin_id") {
        return res.status(409).json({ message: "Recruiter admin already assigned to a company" });
      }
      return res.status(409).json({ message: "Duplicate key error" });
    }
    return next(err);
  }
});

router.get("/", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const companies = await Company.find({}).sort({ created_at: -1 });
    return res.json({ companies });
  } catch (err) {
    return next(err);
  }
});

export default router;
