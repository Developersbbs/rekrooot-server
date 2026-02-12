import { getAdminAuth } from "../config/firebaseAdmin.js";
import { User } from "../modals/user.model.js";

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({ message: "Missing Authorization Bearer token" });
    }

    const decoded = await getAdminAuth().verifyIdToken(token);

    req.auth = {
      uid: decoded.uid,
      email: decoded.email,
      claims: decoded,
    };

    return next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

export async function attachUser(req, res, next) {
  try {
    const { uid } = req.auth;
    const user = await User.findOne({ firebase_uid: uid });

    if (!user) {
      return res.status(403).json({ message: "User not found in database" });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}