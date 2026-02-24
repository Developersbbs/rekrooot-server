import mongoose from "mongoose";
import fs from "fs";
import Vendor from "../src/modals/vendor.model.js";
import { Company } from "../src/modals/company.model.js";

await mongoose.connect("mongodb://localhost:27017/rekrooot");

const vendors = JSON.parse(
  fs.readFileSync("./src/datas/Vendor.json", "utf-8")
);

// 🔥 Step 1: Create company name → ObjectId map
const companies = await Company.find({});
const companyMap = {};

companies.forEach((comp) => {
  companyMap[comp.name] = comp._id;
});

console.log("Company Map Ready ✅");

// 🔥 Step 2: Insert Vendors
for (const vendor of vendors) {

  const companyId = companyMap[vendor.company];

  if (!companyId) {
    console.log(`❌ Company not found for vendor: ${vendor.vendorName}`);
    continue;
  }

  try {
    await Vendor.create({
      name: vendor.vendorName,
      email: vendor.email?.toLowerCase().trim(),
      contact: vendor.contactNumber,
      status: vendor.status === "Active" ? "1" : "0",
      company_id: companyId,
      created_by: "69984a1c08be8718396455a2", // your super admin id
      created_at: new Date(vendor.createdAt._seconds * 1000),
      updated_at: new Date(vendor.createdAt._seconds * 1000),
    });

    console.log(`✅ ${vendor.vendorName} migrated`);
  } catch (err) {
    console.log(`⚠ Skipped (maybe duplicate email): ${vendor.vendorName}`);
  }
}

console.log("All vendors migrated 🚀");
process.exit();