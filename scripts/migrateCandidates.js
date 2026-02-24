import mongoose from "mongoose";
import fs from "fs";
import { Candidate } from "../src/modals/candidate.model.js";
import { Job } from "../src/modals/job.model.js";
import { Client } from "../src/modals/client.model.js";
import Vendor from "../src/modals/vendor.model.js";
import { Company } from "../src/modals/company.model.js";
import { User } from "../src/modals/user.model.js";
import { Interview } from "../src/modals/interview.model.js";

await mongoose.connect("mongodb://localhost:27017/rekrooot");

const candidates = JSON.parse(
  fs.readFileSync("./src/datas/Candidates.json", "utf-8")
);

// Read source JSON files to map firebase ids
const jobsJson = JSON.parse(fs.readFileSync("./src/datas/jobs.json", "utf-8"));
const clientsJson = JSON.parse(fs.readFileSync("./src/datas/Clients.json", "utf-8"));
const vendorsJson = JSON.parse(fs.readFileSync("./src/datas/Vendor.json", "utf-8"));
const companiesJson = JSON.parse(fs.readFileSync("./src/datas/Company.json", "utf-8"));
const usersJson = JSON.parse(fs.readFileSync("./src/datas/Users.json", "utf-8"));

const companyFirebaseMap = {};
companiesJson.forEach(c => companyFirebaseMap[c.id] = c.name);

// Create firebase id to title/name maps
const jobFirebaseMap = {};
jobsJson.forEach(j => jobFirebaseMap[j.id] = j.jobTitle);

const clientFirebaseMap = {};
clientsJson.forEach(c => clientFirebaseMap[c.id] = c.name);

const vendorFirebaseMap = {};
vendorsJson.forEach(v => vendorFirebaseMap[v.id] = v.vendorName);

const userFirebaseMap = {};
usersJson.forEach(u => userFirebaseMap[u.uid] = u.uid);

// 🔥 Maps from mongo data
const jobsMongo = await Job.find({});
const jobMap = {};
jobsMongo.forEach(j => jobMap[j.title] = j._id);

const clientsMongo = await Client.find({});
const clientMap = {};
clientsMongo.forEach(c => clientMap[c.name] = c._id);

// const vendorsMongo = await Vendor.find({});
const vendorMap = {};

const companiesMongo = await Company.find({});
const companyMap = {};
companiesMongo.forEach(c => companyMap[c.name] = c._id);

console.log("Found companies:", Object.keys(companyMap));

const usersMongo = await User.find({});
const userMap = {};
usersMongo.forEach(u => userMap[u.firebase_uid] = u._id);

const interviewsMongo = await Interview.find({});
const interviewMap = {};
interviewsMongo.forEach(i => interviewMap[`${i.candidate_email}_${i.job_id}_${i.date_time.toISOString().split('T')[0]}`] = i._id);

// 🔥 Status Map
const candidateStatusMap = {
  'waiting': 0,
  'scheduled': 1,
  'rescheduled': 2,
  'in review': 3,
  'interviewed': 4,
  'cancelled': 5,
  'InterviewInReview': 3
};

console.log("Maps Ready ✅");

for (const candidate of candidates) {
  const jobTitle = jobFirebaseMap[candidate.jobId];
  const clientName = clientFirebaseMap[candidate.clientId];
  const vendorName = vendorFirebaseMap[candidate.vendorId];
  const companyName = candidate.company; // Already the name

  const jobId = jobTitle ? jobMap[jobTitle] : null;
  const clientId = clientName ? clientMap[clientName] : null;
  const vendorId = vendorName ? vendorMap[vendorName] : null;
  const companyId = companyName ? companyMap[companyName] : null;
  const createdByUid = userFirebaseMap[candidate.createdBy];

  const createdById = createdByUid ? userMap[createdByUid] : null;

  if (!companyId) {
    console.log(`⚠ Missing company for candidate ${candidate.name}`);
    continue;
  }

  // Use interviewId directly from candidate data
  const interviewId = null; // Will be set later if needed

  try {
    await Candidate.create({
      job_id: jobId,
      client_id: clientId,
      vendor_id: vendorId,
      company_id: companyId,
      full_name: candidate.name,
      email: candidate.email,
      primary_contact: candidate.primaryContact,
      secondary_contact: candidate.secondaryContact,
      experience_years: candidate.experience,
      location: candidate.location,
      profile_pic: '',
      resume_url: candidate.resume?.[0]?.url || '',
      resumes: candidate.resume || [],
      supporting_documents: candidate.supportingDocuments || [],
      created_by: createdById,
      trash: candidate.trash || false,
      interview_id: interviewId,
      status: candidateStatusMap[candidate.status] || 0,
      result_document_url: ''
    });

    console.log(`✅ Migrated candidate ${candidate.name}`);
  } catch (err) {
    console.log(`⚠ Error migrating candidate ${candidate.name}`);
  }
}

console.log("All candidates migrated successfully 🚀");
process.exit();
