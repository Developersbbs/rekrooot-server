import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import { Technology } from "../modals/technology.model.js";

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

// List technologies
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const technologies = await Technology.find({}).sort({ created_at: -1 });
    return res.json({ technologies });
  } catch (err) {
    return next(err);
  }
});

// Create technology
router.post("/", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { name } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Technology name is required" });
    }

    const technology = await Technology.create({ name: name.trim() });
    return res.status(201).json({ technology });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Technology name already exists" });
    }
    return next(err);
  }
});

// Update technology
router.put("/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid technology id" });
    }

    const { name } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Technology name is required" });
    }

    const technology = await Technology.findByIdAndUpdate(
      id,
      { name: name.trim() },
      { new: true, runValidators: true },
    );

    if (!technology) {
      return res.status(404).json({ message: "Technology not found" });
    }

    return res.json({ technology });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Technology name already exists" });
    }
    return next(err);
  }
});

// Delete technology
router.delete("/:id", requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid technology id" });
    }

    const result = await Technology.findByIdAndDelete(id);
    if (!result) {
      return res.status(404).json({ message: "Technology not found" });
    }

    return res.status(200).json({ message: "Technology deleted" });
  } catch (err) {
    return next(err);
  }
});

export default router;
