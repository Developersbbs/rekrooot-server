import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";

const router = Router();

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { uid, email } = req.auth;

    const user = await User.findOne({ firebase_uid: uid });

    if (!user) {
      // Option A (strict): deny until seeded/provisioned
      return res.status(403).json({ message: "User is not provisioned in app database" });

      // Option B (auto-provision): create a recruiter by default (not recommended for admin apps)
      // const created = await User.create({ firebase_uid: uid, email, username: email.split("@")[0], role: 3 });
      // return res.json({ user: created });
    }

    return res.json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;