import { getAdminAuth } from "../config/firebaseAdmin.js";

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