import mongoose from "mongoose";
import fs from "fs";
import Interviewer from "../src/modals/interviewer.model.js";
import { Company } from "../src/modals/company.model.js";
import { Technology } from "../src/modals/technology.model.js";
import { User } from "../src/modals/user.model.js";

await mongoose.connect("mongodb://localhost:27017/rekrooot");

const interviewers = JSON.parse(
  fs.readFileSync("./src/datas/Interviewers.json", "utf-8")
);

// 🔥 Company Map
const companies = await Company.find({});
const companyMap = {};
companies.forEach(c => companyMap[c.name] = c._id);

// 🔥 Technology Map
const technologies = await Technology.find({});
const techMap = {};
technologies.forEach(t => techMap[t.name.toLowerCase()] = t._id);

// 🔥 User Map
const users = await User.find({});
const userMap = {};
users.forEach(u => userMap[u.firebase_uid] = u._id);

console.log("Maps Ready ✅");

for (const interviewer of interviewers) {
  const companyId = companyMap[interviewer.company];
  const createdById = userMap[interviewer.createdBy];

  // 🔥 Map Technologies
  const techIds = [];
  if (interviewer.technologies?.length > 0) {
    for (const tech of interviewer.technologies) {
      const techId = techMap[tech.toLowerCase()];
      if (techId) techIds.push(techId);
    }
  }

  try {
    await Interviewer.create({
      name: interviewer.name,
      email: interviewer.email,
      contact: interviewer.contact,
      logo: interviewer.photoURL || interviewer.logo,
      zoho_meet_uid: interviewer.zohoMeetId,
      technologies: techIds,
      company_id: companyId,
      created_by: createdById
    });

    console.log(`✅ Migrated interviewer: ${interviewer.name}`);
  } catch (err) {
    console.log(`⚠ Skipped interviewer: ${interviewer.name}`);
  }
}

console.log("All interviewers migrated successfully 🚀");
process.exit();
