import mongoose from "mongoose";
import fs from "fs";
import { Client } from "../src/modals/client.model.js";
import { Company } from "../src/modals/company.model.js";

await mongoose.connect("mongodb://localhost:27017/rekrooot");

const clients = JSON.parse(
  fs.readFileSync("./src/datas/Clients.json", "utf-8")
);

// 🔥 Step 1: Create company name → ObjectId map
const companies = await Company.find({});
const companyMap = {};

companies.forEach((comp) => {
  companyMap[comp.name] = comp._id;
});

console.log("Company Map:", companyMap);

// 🔥 Step 2: Insert clients
for (const client of clients) {

  const companyId = companyMap[client.company];

  if (!companyId) {
    console.log(`❌ Company not found for ${client.name}`);
    continue;
  }

  await Client.create({
    name: client.name,
    email: client.email || "",
    contact: client.contact || "",
    logo: client.logo || "",
    company_id: companyId,
    created_by: "69984a1c08be8718396455a2", // your super admin user id
    created_at: client.createdAt ? new Date(client.createdAt) : new Date(),
    updated_at: client.updatedAt ? new Date(client.updatedAt) : new Date(),
  });

  console.log(`✅ ${client.name} migrated`);
}

console.log("All clients migrated successfully 🚀");
process.exit();