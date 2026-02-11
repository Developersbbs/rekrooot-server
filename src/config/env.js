import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const ENV = {
  PORT: process.env.PORT || 5001,
  NODE_ENV: process.env.NODE_ENV || "development",
  MONGO_URI: process.env.MONGO_URI || "mongodb://localhost:27017/rekrooot",
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  FRONTEND_BASE_URL: process.env.FRONTEND_BASE_URL || "http://localhost:3000",

  NEWUSER_SMTP_HOST: process.env.NEWUSER_SMTP_HOST,
  NEWUSER_SMTP_PORT: process.env.NEWUSER_SMTP_PORT ? Number(process.env.NEWUSER_SMTP_PORT) : undefined,
  NEWUSER_SMTP_SECURE: process.env.NEWUSER_SMTP_SECURE === "true",
  NEWUSER_SMTP_USER: process.env.NEWUSER_SMTP_USER,
  NEWUSER_SMTP_PASS: process.env.NEWUSER_SMTP_PASS,
  NEWUSER_MAIL_FROM: process.env.NEWUSER_MAIL_FROM,
};
