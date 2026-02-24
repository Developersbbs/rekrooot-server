import mongoose from "mongoose";
import fs from "fs";
import InterviewerAvailability from "../src/modals/interviewerAvailability.model.js";
import Interviewer from "../src/modals/interviewer.model.js";
import { User } from "../src/modals/user.model.js";

await mongoose.connect("mongodb://localhost:27017/rekrooot");

const interviewers = JSON.parse(
  fs.readFileSync("./src/datas/Interviewers.json", "utf-8")
);

// 🔥 Interviewer Map
const interviewersMongo = await Interviewer.find({});

const interviewerMap = {};
console.log("Maps Ready ✅");
console.log("Total interviewers in JSON:", interviewers.length);
console.log("Total interviewers in MongoDB:", interviewersMongo.length);

for (const interviewer of interviewers) {
  console.log(`Processing interviewer: ${interviewer.name} (${interviewer.email})`);
  
  const mongoInterviewer = interviewersMongo.find(i => {
    const mongoEmail = i.email ? i.email.trim().toLowerCase() : '';
    const firebaseEmail = interviewer.email ? interviewer.email.trim().toLowerCase() : '';
    return mongoEmail === firebaseEmail;
  });
  
  if (mongoInterviewer) {
    interviewerMap[interviewer.id] = mongoInterviewer._id;
    console.log(`✅ Found MongoDB interviewer: ${mongoInterviewer.name} (${mongoInterviewer.email})`);
  } else {
    console.log(`⚠ Interviewer not found in MongoDB: ${interviewer.name} (${interviewer.email})`);
    console.log(`Available MongoDB interviewers:`, interviewersMongo.map(i => ({ name: i.name, email: i.email })));
    continue;
  }

  // 🔥 User Map
  const users = await User.find({});
  const userMap = {};
  users.forEach(u => userMap[u.firebase_uid] = u._id);

  const createdById = userMap[interviewer.createdBy];

  if (!interviewer.availabilitySlots) {
    console.log(`⚠ No availability slots for ${interviewer.name}`);
    continue;
  }

  for (const [dateStr, slots] of Object.entries(interviewer.availabilitySlots)) {
    for (const [timeStr, status] of Object.entries(slots)) {
      if (status === 'available') {
        try {
          // Parse date and time
          const date = new Date(dateStr);
          const [hours, minutes] = timeStr.split(':').map(Number);
          const startTime = new Date(date);
          startTime.setHours(hours, minutes, 0, 0);

          const endTime = new Date(startTime);
          endTime.setHours(hours + 1, minutes, 0, 0); // Assume 1 hour slots

          await InterviewerAvailability.create({
            interviewer: mongoInterviewer._id,
            start_time: startTime,
            end_time: endTime,
            created_by: createdById,
            status: 1 // available
          });

          console.log(`✅ Created availability for ${interviewer.name} on ${dateStr} at ${timeStr}`);
        } catch (err) {
          console.log(`⚠ Error creating availability for ${interviewer.name}:`, err.message);
        }
      }
    }
  }
}

console.log("All interviewer availabilities migrated successfully 🚀");
process.exit();