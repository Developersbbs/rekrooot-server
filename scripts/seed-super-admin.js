import { connectDB } from "../src/config/db.js";
import { getAdminAuth } from "../src/config/firebaseAdmin.js";
import { User } from "../src/modals/user.model.js";

async function run() {
  await connectDB();

  const email = "admin@rekrooot.com";
  const password = "rekrooot@2025";
  const username = "Rekrooot Admin";

  if (!email || !password) {
    throw new Error("Missing SEED_SUPERADMIN_EMAIL or SEED_SUPERADMIN_PASSWORD");
  }

  const adminAuth = getAdminAuth();

  let fbUser;
  try {
    fbUser = await adminAuth.getUserByEmail(email);
  } catch {
    fbUser = await adminAuth.createUser({ email, password, displayName: username });
  }

  await adminAuth.setCustomUserClaims(fbUser.uid, {
    role: 0,
    roleName: "SUPER_ADMIN",
  });

  const doc = await User.findOneAndUpdate(
    { firebase_uid: fbUser.uid },
    {
      firebase_uid: fbUser.uid,
      email,
      username,
      role: 0,
      is_active: true,
    },
    { upsert: true, new: true },
  );

  console.log("Seeded SUPER_ADMIN:", { firebase_uid: doc.firebase_uid, email: doc.email, role: doc.role });
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});