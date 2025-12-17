import mongoose from "mongoose";
import { ENV } from "./env.js";

export async function connectDB() {
  try {
    await mongoose.connect(ENV.MONGO_URI, {
      // You can add options here if needed
    });
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    // Re-throw so server.js can decide whether to exit
    throw err;
  }
}
