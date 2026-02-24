import mongoose from "mongoose";
import fs from "fs";
import { Interview } from "../src/modals/interview.model.js";
import { Candidate } from "../src/modals/candidate.model.js";
import Interviewer from "../src/modals/interviewer.model.js";
import { Job } from "../src/modals/job.model.js";
import { Client } from "../src/modals/client.model.js";
import { Company } from "../src/modals/company.model.js";
import { User } from "../src/modals/user.model.js";

await mongoose.connect("mongodb://localhost:27017/rekrooot");

const candidates = JSON.parse(
  fs.readFileSync("./src/datas/candidates.json", "utf-8")
);

// Read source JSON files to map firebase ids
const jobsJson = JSON.parse(fs.readFileSync("./src/datas/jobs.json", "utf-8"));
const clientsJson = JSON.parse(fs.readFileSync("./src/datas/Clients.json", "utf-8"));
const interviewersJson = JSON.parse(fs.readFileSync("./src/datas/Interviewers.json", "utf-8"));

const normalize = (str) => str ? str.trim().toLowerCase().replace(/\s+/g, ' ') : '';

// 🔥 Maps
const interviewersMongo = await Interviewer.find({});
const interviewerEmailMap = {};
interviewersMongo.forEach(i => {
  interviewerEmailMap[normalize(i.email)] = i._id;
});

// Create Firebase ID to Email map for interviewers
const fbInterviewerIdToEmail = {};
interviewersJson.forEach(i => {
  fbInterviewerIdToEmail[i.id] = normalize(i.email);
});

const jobsMongo = await Job.find({});
const clientsMongo = await Client.find({});
const companiesMongo = await Company.find({});
const usersMongo = await User.find({});

const firebaseJobMap = {};
jobsJson.forEach(job => {
  const normTitle = normalize(job.jobTitle);
  const mongoJob = jobsMongo.find(j => normalize(j.title) === normTitle);
  if (mongoJob) {
    firebaseJobMap[job.id] = mongoJob._id;
  }
});

const firebaseClientMap = {};
clientsJson.forEach(client => {
  const normName = normalize(client.name);
  const mongoClient = clientsMongo.find(c => normalize(c.name) === normName);
  if (mongoClient) {
    firebaseClientMap[client.id] = mongoClient._id;
  }
});

const companyMap = {};
companiesMongo.forEach(c => {
  companyMap[normalize(c.name)] = c._id;
});

const userMap = {};
usersMongo.forEach(u => {
  userMap[u.firebase_uid] = u._id;
});

// 🔥 Status Map
const interviewStatusMap = {
  'waiting': 0,
  'scheduled': 1,
  'rescheduled': 2,
  'InterviewInReview': 2,
  'interviewed': 3, // Inferred from result "Selected"/"Rejected"
  'selected': 3,
  'rejected': 4,
  'no show': 5,
  'cancelled': 6,
  'proxy': 7,
  'technical issue': 8
};

console.log("Maps Ready ✅");

let successCount = 0;
let failCount = 0;

for (const candidate of candidates) {
  // Skip if no interview data
  const hasInterview = candidate.interviewDate && (candidate.interviewerId || candidate.presenterId);
  if (!hasInterview) {
    if (candidate.status?.toLowerCase() !== 'cancelled' && candidate.status?.toLowerCase() !== 'waiting') {
      // Only log if it seems like it should have had an interview
      // console.log(`⚠ Skipping candidate ${candidate.name} - no substantial interview data`);
    }
    continue;
  }

  // Get Interviewer ID
  let interviewerId = null;
  const fbInterviewerId = candidate.interviewerId;
  const email = fbInterviewerIdToEmail[fbInterviewerId];
  if (email) {
    interviewerId = interviewerEmailMap[email];
  }

  // Fallback: try mapping by presenterId (zoho_meet_uid)
  if (!interviewerId && candidate.presenterId) {
    const interByPresenter = interviewersMongo.find(i => i.zoho_meet_uid === candidate.presenterId);
    if (interByPresenter) {
      interviewerId = interByPresenter._id;
    }
  }

  const jobId = firebaseJobMap[candidate.jobId];
  const clientId = firebaseClientMap[candidate.clientId];
  const companyId = companyMap[normalize(candidate.company)];
  const createdById = userMap[candidate.createdBy] || null;

  if (!interviewerId || !jobId || !clientId || !companyId) {
    console.log(`⚠ Missing mappings for candidate ${candidate.name} interview`);
    if (!interviewerId) console.log(`  - interviewerId: ${candidate.interviewerId} (Email: ${email}) -> undefined`);
    if (!jobId) console.log(`  - jobId: ${candidate.jobId} -> undefined`);
    if (!clientId) console.log(`  - clientId: ${candidate.clientId} -> undefined`);
    if (!companyId) console.log(`  - companyId: ${candidate.company} -> undefined`);
    continue;
  }

  try {
    // Parse date and time
    // candidate.interviewDate can be "Fri Feb 13 2026" or "2026-02-06"
    const dateStr = candidate.interviewDate;
    const timeStr = candidate.interviewTime || '00:00';
    const dateTime = new Date(`${dateStr} ${timeStr}`);

    // Determine status from candidate status and result
    let status = interviewStatusMap[candidate.status] || 0;
    if (candidate.result === 'Selected') status = 3;
    if (candidate.result === 'Rejected') status = 4;
    if (candidate.status === 'Interviewed' && !candidate.result) status = 3; // Default to Selected? or keep at some intermediate?

    await Interview.create({
      interviewer_id: interviewerId,
      candidate_id: null, // Will set after candidate migration if needed, or link via email
      candidate_name: candidate.name,
      candidate_email: candidate.email,
      candidate_phone: candidate.primaryContact || '',
      date_time: isNaN(dateTime.getTime()) ? new Date() : dateTime,
      interviewer_name: '', // Will update later if needed
      status: status,
      company_id: companyId,
      client_id: clientId,
      job_id: jobId,
      created_by: createdById,
      meeting_link: candidate.meetingLink || '',
      session_id: candidate.sessionId || '',
      presenter_id: candidate.presenterId || '',
      zsoid: candidate.zsoid || ''
    });

    successCount++;
    // console.log(`✅ Created interview for ${candidate.name}`);
  } catch (err) {
    failCount++;
    console.log(`⚠ Error creating interview for ${candidate.name}: ${err.message}`);
  }
}

console.log(`\nMigration Summary:`);
console.log(`- Successfully migrated: ${successCount}`);
console.log(`- Failed: ${failCount}`);
console.log("\nAll interviews migration phase finished 🚀");
process.exit();
