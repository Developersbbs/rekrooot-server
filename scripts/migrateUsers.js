import mongoose from "mongoose";
import fs from "fs";
import { User } from "../src/modals/user.model.js";
import { Company } from "../src/modals/company.model.js";

await mongoose.connect("mongodb://localhost:27017/rekrooot");

const users = JSON.parse(
  fs.readFileSync("./src/datas/Users.json", "utf-8")
);

// 🔥 Role Map
const roleMap = {
  SuperAdmin: 0,
  "Recruiter Admin": 1,
  "Lead Recruiter": 2,
  Recruiter: 3
};

// 🔥 Company Map
const companies = await Company.find({});
const companyMap = {};
companies.forEach(c => companyMap[c.name] = c._id);

console.log("Company Map Ready ✅");

// 🔥 PHASE 1 → Insert Basic Users
const firebaseToMongoMap = {};

for (const user of users) {

  try {
    const newUser = await User.create({
      username: user.display_name || user.name,
      email: user.email?.toLowerCase().trim(),
      contact: user.phone_number || "",
      firebase_uid: user.uid,
      company_id: companyMap[user.company_name] || null,
      role: roleMap[user.role] ?? 3,
      recruiter_region: user.lead_recruiter_region || "",
      is_active: true
    });

    firebaseToMongoMap[user.uid] = newUser._id;

    console.log(`✅ Inserted ${user.email}`);

  } catch (err) {
    console.log(`⚠ Skipped ${user.email}`);
  }
}

console.log("Phase 1 Completed 🚀");

// 🔥 PHASE 2 → Update References

for (const user of users) {

  const mongoId = firebaseToMongoMap[user.uid];

  if (!mongoId) continue;

  await User.findByIdAndUpdate(mongoId, {
    created_by: firebaseToMongoMap[user.created_by] || null,
    lead_recruiter_id: firebaseToMongoMap[user.lead_recruiter_id] || null
  });

  console.log(`🔁 Updated refs for ${user.email}`);
}

console.log("All users migrated successfully 🚀");
process.exit();