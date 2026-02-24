import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const ENV = {
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
  MONGO_URI: process.env.MONGO_URI,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  FRONTEND_BASE_URL: process.env.FRONTEND_BASE_URL,

  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 465,
  SMTP_SECURE: process.env.SMTP_SECURE === "true",

  NEWUSER_SMTP_USER: process.env.NEWUSER_SMTP_USER,
  NEWUSER_SMTP_PASS: process.env.NEWUSER_SMTP_PASS,
  NEWUSER_MAIL_FROM: process.env.NEWUSER_MAIL_FROM,

  INTERVIEW_SMTP_USER: process.env.INTERVIEW_SMTP_USER,
  INTERVIEW_SMTP_PASS: process.env.INTERVIEW_SMTP_PASS,
  INTERVIEW_MAIL_FROM: process.env.INTERVIEW_MAIL_FROM,

  ZOHO_MEET_CLIENT_ID: process.env.ZOHO_MEET_CLIENT_ID,
  ZOHO_MEET_CLIENT_SECRET: process.env.ZOHO_MEET_CLIENT_SECRET,
  ZOHO_MEET_REFRESH_TOKEN: process.env.ZOHO_MEET_REFRESH_TOKEN,
  ZOHO_DEFAULT_PRESENTER_ID: process.env.ZOHO_DEFAULT_PRESENTER_ID,
};
