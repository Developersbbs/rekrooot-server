import mongoose from "mongoose";
import fs from "fs";
import { Job } from "../src/modals/job.model.js";
import { Company } from "../src/modals/company.model.js";
import { Client } from "../src/modals/client.model.js";
import { Technology } from "../src/modals/technology.model.js";

await mongoose.connect("mongodb://localhost:27017/rekrooot");

// 🔥 Load Files
const jobs = JSON.parse(
    fs.readFileSync("../src/datas/jobs.json", "utf-8")
);

const clientsFirebase = JSON.parse(
    fs.readFileSync("../src/datas/Clients.json", "utf-8")
);

// 🔥 Create Company Map
const companies = await Company.find({});
const companyMap = {};
companies.forEach(c => {
    companyMap[c.name] = c._id;
});

// 🔥 Create Client Map (firebase id → mongo id)
const mongoClients = await Client.find({});
const clientMap = {};

clientsFirebase.forEach(fbClient => {
    const mongoClient = mongoClients.find(mc => mc.name === fbClient.name);
    if (mongoClient) {
        clientMap[fbClient.id] = mongoClient._id;
    }
});

// 🔥 Create Technology Map
const technologies = await Technology.find({});
const techMap = {};
technologies.forEach(t => {
    techMap[t.name.trim().toLowerCase()] = t._id;
});

// 🔥 Status Map
const statusMap = {
    active: "0",
    inactive: "1",
    onhold: "2"
};

console.log("Maps Ready ✅");

// 🔥 Insert Jobs
for (const job of jobs) {
    const companyId = companyMap[job.company];
    const clientId = clientMap[job.clientId] || null; // if client not exists → null

    if (!companyId) {
        console.log(`❌ Missing mapping for job: ${job.jobTitle} (company "${job.company}")`);
        continue;
    }

    // 🔥 Map Technologies
    let techIds = [];

    if (job.requiredSkills?.length > 0) {
        techIds = job.requiredSkills
            .map(skill => skill.trim().toLowerCase())
            .map(skill => techMap[skill])
            .filter(Boolean);
    }

    try {
        await Job.create({
            company_id: companyId,
            client_id: clientId, // will be null if client not found
            title: job.jobTitle.trim(),
            description: job.description || "No Description",
            experience_required: job.experience || "Not specified",
            location: job.jobLocation || "Not specified",
            category: job.jobCategory || "Hybrid",
            type: job.jobType || "Full Time",
            status: statusMap[job.status] || "0",
            technologies: techIds,
            created_by: "69984a1c08be8718396455a2", // super admin id
            candidate_counts: {
                waiting: job.candidateCounts?.waiting || 0,
                scheduled: job.candidateCounts?.scheduled || 0,
                selected: job.candidateCounts?.selected || 0,
                rejected: job.candidateCounts?.rejected || 0,
                no_show: job.candidateCounts?.noShow || 0,
                cancelled: job.candidateCounts?.cancelled || 0,
                technical_issue: job.candidateCounts?.technicalIssue || 0,
                proxy: job.candidateCounts?.proxy || 0,
                on_hold: job.status === "onhold" ? 1 : 0
            }
        });

        if (!clientId) {
            console.log(`⚠ ${job.jobTitle} migrated with client NA`);
        } else {
            console.log(`✅ ${job.jobTitle} migrated`);
        }

    } catch (err) {
        console.log(`⚠ Failed: ${job.jobTitle}`, err.message);
    }
}

console.log("All jobs migrated 🚀");
process.exit();