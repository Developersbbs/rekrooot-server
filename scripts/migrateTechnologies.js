import mongoose from "mongoose";
import fs from "fs";
import { Technology } from "../src/modals/technology.model.js";

await mongoose.connect("mongodb://localhost:27017/rekrooot");

const data = JSON.parse(
  fs.readFileSync("./src/datas/technologies.json", "utf-8")
);

const techArray = data[0].tech;

// 🔥 Clean + Normalize
const cleanedTechs = [
  ...new Set(
    techArray
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0)
  ),
];

console.log("Cleaned Technologies:", cleanedTechs);

for (const tech of cleanedTechs) {
  try {
    await Technology.create({ name: tech });
    console.log(`✅ ${tech} inserted`);
  } catch (err) {
    console.log(`⚠ Skipped duplicate: ${tech}`);
  }
}

console.log("All technologies migrated 🚀");
process.exit();