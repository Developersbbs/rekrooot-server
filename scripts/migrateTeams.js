import mongoose from "mongoose";
import { Team } from "../src/modals/team.model.js";
import { User } from "../src/modals/user.model.js";

await mongoose.connect("mongodb://localhost:27017/rekrooot");

console.log("Creating Teams...");

// 🔥 Get all lead recruiters
const leadRecruiters = await User.find({ role: 2 });

for (const lead of leadRecruiters) {

  // Find all recruiters under this lead
  const members = await User.find({
    lead_recruiter_id: lead._id
  });

  const memberIds = members.map(m => m._id);

  // Create team
  const team = await Team.create({
    name: `${lead.username} Team`,
    company_id: lead.company_id,
    team_lead: lead._id,
    members: memberIds,
    is_active: true
  });

  console.log(`✅ Team created for ${lead.username}`);

  // 🔥 Update users with team_id
  await User.updateMany(
    { _id: { $in: [lead._id, ...memberIds] } },
    { team_id: team._id }
  );

  console.log(`🔁 Users updated with team_id`);
}

console.log("All teams created successfully 🚀");