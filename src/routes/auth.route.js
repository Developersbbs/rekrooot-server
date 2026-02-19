import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import { getAdminAuth } from "../config/firebaseAdmin.js";

const router = Router();

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const { uid, email } = req.auth;

    const user = await User.findOne({ firebase_uid: uid })
      .populate('company_id', 'name');

    if (!user) {
      return res.status(403).json({ message: "User is not provisioned in app database" });
    }

    return res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.post("/check-email", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "Account not found" });
    }

    return res.json({ exists: true });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const { uid } = req.auth;

    await getAdminAuth().revokeRefreshTokens(uid);

    return res.status(200).json({ message: "Logged out" });
  } catch (err) {
    next(err);
  }
});

export default router;