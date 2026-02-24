import mongoose from "mongoose";
import fs from "fs";
import { Company } from "../src/modals/company.model.js"; // adjust path

await mongoose.connect("mongodb://localhost:27017/rekrooot");

const companies = JSON.parse(
  fs.readFileSync("./src/datas/Company.json", "utf-8")
);

for (const comp of companies) {
  const companyDoc = {
    name: comp.name,
    subscription_status: true,
    created_at: comp.createdAt ? new Date(comp.createdAt._seconds * 1000) : new Date(),
    updated_at: comp.updatedAt ? new Date(comp.updatedAt._seconds * 1000) : new Date(),
  };

  await Company.updateOne(
    { name: comp.name },
    { $set: companyDoc },
    { upsert: true }
  );

  console.log(`${comp.name} migrated`);
}

console.log("All companies migrated ✅");
process.exit();